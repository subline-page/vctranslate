/**
 * The surfaces' own daily ✦ allowance: 500 cost units a UTC day per install,
 * counted here on the device. A text costs 1 + one unit per started 1,000
 * characters (see surfaceCost in service.ts), so a status or a name costs 2
 * and a long embed description up to 5: about 250 texts a day.
 *
 * WHY A SEPARATE BUDGET. Surface requests are ordinary relay requests and
 * count against the same hidden daily ceiling as messages (1,000 a day, spec
 * decision 5). Without a ceiling of their own, an afternoon of scrolling
 * member lists could spend the day's ✦ on statuses and leave nothing for the
 * conversation. Messages always come first; this caps what surfaces may take.
 *
 * 500, was 200 (0.2.9). With Google gone, a surface shows ✦ or nothing, and
 * names and bios ask ✦ by themselves (spec decision 14), so 200 (about 100
 * texts) ran out in one busy server. 500 units is about 250 texts, at most a
 * quarter of the 1,000 daily messages, and every text is cached for 30 days,
 * so a status or a name seen again costs nothing.
 *
 * Persisted (the count survives a Discord restart) and keyed by UTC day, so a
 * new day starts at zero. A failed read starts at zero; a failed write keeps
 * the count for this session.
 */

export const SURFACE_DAILY_BUDGET = 500;
export const SURFACE_BUDGET_KEY = "VcTranslate_surfaceBudget";

export interface BudgetStorage {
    get(key: string): Promise<unknown>;
    set(key: string, value: unknown): Promise<void>;
}

export function utcDay(now: number): string {
    return new Date(now).toISOString().slice(0, 10);
}

export class SurfaceBudget {
    private day: string;
    private used = 0;

    constructor(
        private readonly storage: BudgetStorage,
        private readonly now: () => number,
        private readonly cap = SURFACE_DAILY_BUDGET
    ) {
        this.day = utcDay(now());
    }

    private roll(): void {
        const today = utcDay(this.now());
        if (today !== this.day) {
            this.day = today;
            this.used = 0;
        }
    }

    remaining(): number {
        this.roll();
        return Math.max(0, this.cap - this.used);
    }

    spend(units: number): void {
        this.roll();
        this.used = Math.min(this.cap, this.used + Math.max(0, units));
        void this.storage.set(SURFACE_BUDGET_KEY, { day: this.day, used: this.used }).catch(() => { });
    }

    async load(): Promise<void> {
        let stored: unknown;
        try {
            stored = await this.storage.get(SURFACE_BUDGET_KEY);
        } catch {
            return;
        }
        const s = stored as { day?: unknown; used?: unknown } | null;
        this.roll();
        if (s && s.day === this.day && typeof s.used === "number" && Number.isFinite(s.used)) {
            this.used = Math.max(this.used, Math.min(this.cap, Math.max(0, Math.floor(s.used))));
        }
    }
}
