import * as DataStore from "@api/DataStore";

import { isInstallId, newInstallId, resolveLegacyInstallId } from "./taste";

/**
 * WHICH INSTALL ID EACH DISCORD ACCOUNT USES (0.2.8).
 *
 * A plan belongs to the ONE Discord account its buyer chooses, and the relay
 * links an install to the account that authorized it. Three rules decide which
 * install id a signed-in Discord account uses here (0.2.8 spec, "Existing
 * plans on update"):
 *
 *  1. UNTIL THE INSTALL ID FROM BEFORE IS LINKED, EVERY ACCOUNT USES IT. The
 *     installer's id (or the one older builds kept) is the install a plan
 *     from before 0.2.8 lives on. No account takes it over by signing in
 *     first: every local account sees that plan working, with the Link bar,
 *     and nothing binds until someone confirms a link (no takeover).
 *  2. A CONFIRMED LINK BINDS IT. When the relay answers a link on that id,
 *     the account that confirmed it keeps it (bindLegacyInstall), and every
 *     other local account gets a fresh id of its own from then on, its own
 *     stored answer and its own saved code. One account never inherits
 *     another's plan.
 *
 *  3. A LINK WHOSE ANSWER NEVER CAME STILL BINDS. Before a link (or a move)
 *     is sent on the unbound install id from before, the sending account is
 *     written down as a PENDING BIND (notePendingBind), in the same two
 *     places as the binding. The answer can be lost (a timeout, the network
 *     dropping after the relay committed, an account switch before it came
 *     back), and then only a later status answer says the id is linked. That
 *     answer carries no account, so settleLegacyLink decides: the one account
 *     that sent a link gets the binding; with none, or more than one (nobody
 *     can tell which link the relay kept), the binding goes to NOBODY and
 *     every local account gets an id of its own. That costs the real owner
 *     one re-link (silent when it approved Subline before), never a plan on
 *     the wrong account (no takeover).
 *
 * The binding is kept twice: in the accounts book (the DataStore, Discord's
 * own storage) and in Vencord's settings next to the installer's id
 * (`installBinding`, through BindingSetting). Clearing Discord's data (a
 * common fix) wipes the book and keeps the settings, so the book alone would
 * forget the binding and hand the linked plan to whichever account signs in
 * first. A binding counts only for the id it was made for: a reinstall seeds
 * a new id, which nobody has linked yet, so rule 1 applies to it again.
 *
 * The book uses a LOCAL key of the Discord user id (accountKeyFor): a hash,
 * never the id itself. It also remembers, for each account that linked here,
 * its Discord username and whether its plan was live when last seen, so an
 * account without a plan can be told "Your Subline plan is on @main on this
 * computer" (local names only). Nothing in the book is sent anywhere.
 *
 * The saved code is a Vencord setting, and there is one settings file for
 * every account. So the code fields (the code, the code cleared by hand, the
 * first dead answer) belong to a SLOT: "" for the install id from before,
 * and an account key for an account's own id. On a switch to another slot
 * the outgoing slot's fields go into a stash in the settings and the
 * incoming slot's come out; `codeAccount` names the slot they belong to, so
 * an interrupted swap is recognised on the next start and repaired from the
 * stash (see swapCodeFields).
 */

export const ACCOUNTS_KEY = "VcTranslate_accounts";

/** The account a confirmed link bound the install id from before to, and that id. */
export interface Binding {
    /** A local account key, or NOBODY. */
    account: string;
    id: string;
}

/**
 * The owner of a binding nobody here can name (header, rule 3): the relay
 * linked the id from before, and no single account here sent that link. It
 * is never any account's, so every account gets an id of its own.
 */
export const NOBODY = "nobody";

/** Links sent on the unbound install id `id`, by these local accounts, with no answer taken in yet (header, rule 3). */
export interface PendingBind {
    id: string;
    accounts: string[];
}

/** What this computer remembers about an account that linked here. Local only. */
export interface LocalAccount {
    /** Its Discord username, read from Discord's UserStore when it was signed in. */
    name: string;
    /** Whether its plan was live when it was last signed in here. */
    plan: boolean;
}

export interface AccountsBook {
    /** The confirmed link that bound the install id from before, or null while none has. */
    bound: Binding | null;
    /** Links sent on the unbound id from before whose answer was not taken in (rule 3), or null. */
    pending: PendingBind | null;
    /** Local account key -> its own install id (never the install id from before). */
    ids: Record<string, string>;
    /** Local account key -> what this computer remembers about it. */
    accounts: Record<string, LocalAccount>;
}

/** A local key for a Discord user id: "a" + 16 hex. Not the id, and not sent anywhere. */
export function accountKeyFor(userId: string): string {
    const input = "subline-local-account\n" + userId;
    const fnv = (seed: number) => {
        let h = seed >>> 0;
        for (let i = 0; i < input.length; i++) {
            h ^= input.charCodeAt(i);
            h = Math.imul(h, 16777619) >>> 0;
        }
        return h.toString(16).padStart(8, "0");
    };
    return "a" + fnv(2166136261) + fnv(84696351);
}

const ACCOUNT_KEY_RE = /^a[0-9a-f]{16}$/;
/** The longest Discord username kept (Discord allows 32). */
const NAME_MAX = 64;

/** A binding as stored (book or settings), checked field by field, or null. */
export function parseBinding(raw: unknown): Binding | null {
    if (!raw || typeof raw !== "object") return null;
    const o = raw as { account?: unknown; id?: unknown; };
    if (typeof o.account !== "string" || !(ACCOUNT_KEY_RE.test(o.account) || o.account === NOBODY) || !isInstallId(o.id)) return null;
    return { account: o.account, id: o.id };
}

/** More accounts than this sending links on one id is already "nobody can tell": the list stops growing. */
const PENDING_MAX = 8;

/** A pending bind as stored (book or settings), checked field by field, or null. Malformed accounts are dropped. */
export function parsePendingBind(raw: unknown): PendingBind | null {
    if (!raw || typeof raw !== "object") return null;
    const o = raw as { id?: unknown; accounts?: unknown; };
    if (!isInstallId(o.id) || !Array.isArray(o.accounts)) return null;
    const accounts = [...new Set(o.accounts.filter((a): a is string => typeof a === "string" && ACCOUNT_KEY_RE.test(a)))].slice(0, PENDING_MAX);
    return accounts.length > 0 ? { id: o.id, accounts } : null;
}

function parseLocalAccount(raw: unknown): LocalAccount | null {
    if (!raw || typeof raw !== "object") return null;
    const o = raw as { name?: unknown; plan?: unknown; };
    if (typeof o.name !== "string" || o.name === "" || o.name.length > NAME_MAX) return null;
    return { name: o.name, plan: o.plan === true };
}

/** The book as stored, checked entry by entry. Null when the store could not be read. */
async function readBook(): Promise<AccountsBook | null> {
    let raw: unknown;
    try {
        raw = await DataStore.get<unknown>(ACCOUNTS_KEY);
    } catch {
        return null;
    }
    const book: AccountsBook = { bound: null, pending: null, ids: {}, accounts: {} };
    if (!raw || typeof raw !== "object") return book;
    const o = raw as { bound?: unknown; pending?: unknown; ids?: unknown; accounts?: unknown; };
    book.bound = parseBinding(o.bound);
    book.pending = parsePendingBind(o.pending);
    if (o.ids && typeof o.ids === "object") {
        for (const [k, v] of Object.entries(o.ids as Record<string, unknown>)) {
            if (ACCOUNT_KEY_RE.test(k) && isInstallId(v)) book.ids[k] = v;
        }
    }
    if (o.accounts && typeof o.accounts === "object") {
        for (const [k, v] of Object.entries(o.accounts as Record<string, unknown>)) {
            const entry = parseLocalAccount(v);
            if (ACCOUNT_KEY_RE.test(k) && entry !== null) book.accounts[k] = entry;
        }
    }
    return book;
}

async function writeBook(book: AccountsBook): Promise<boolean> {
    try {
        await DataStore.set(ACCOUNTS_KEY, book);
        return true;
    } catch {
        return false;
    }
}

/** Where the settings copy of the binding lives (index.tsx connects `installBinding`). */
export interface BindingSetting {
    read(): unknown;
    write(binding: Binding): void;
    /** The pending bind (rule 3), kept next to the binding. */
    readPending?(): unknown;
    writePending?(pending: PendingBind | null): void;
}
let bindingSetting: BindingSetting | null = null;
/**
 * The binding this session made or settled, for when neither store could be
 * written: without it, every status answer would settle again, and the
 * accounts here would keep sharing a linked id for the session.
 */
let sessionBinding: Binding | null = null;

export function connectBindingSetting(setting: BindingSetting | null): void {
    bindingSetting = setting;
}

/** stop(): what the next start knows comes from the stores again. */
export function forgetSessionBinding(): void {
    sessionBinding = null;
}

function settingBinding(): Binding | null {
    try {
        return parseBinding(bindingSetting?.read());
    } catch {
        return null;
    }
}

function writeSettingBinding(binding: Binding): boolean {
    try {
        if (bindingSetting === null) return false;
        const now = settingBinding();
        if (now?.account !== binding.account || now.id !== binding.id) bindingSetting.write(binding);
        return true;
    } catch {
        return false;
    }
}

/**
 * The binding of `legacyId`, or null while it is unbound. The settings copy
 * wins (it survives Discord's data being cleared); the book's fills in when
 * the settings lost theirs. A binding made for another id is no binding.
 */
function bindingOf(book: AccountsBook | null, legacyId: string): Binding | null {
    const fromSettings = settingBinding();
    if (fromSettings !== null && fromSettings.id === legacyId) return fromSettings;
    const fromBook = book?.bound ?? null;
    if (fromBook !== null && fromBook.id === legacyId) return fromBook;
    return sessionBinding !== null && sessionBinding.id === legacyId ? sessionBinding : null;
}

/** Write a binding to both stores and the session, and end that id's pending bind. True when a store took it. */
async function writeBinding(book: AccountsBook | null, binding: Binding): Promise<boolean> {
    sessionBinding = binding;
    const inSettings = writeSettingBinding(binding);
    if (settingPending()?.id === binding.id) writeSettingPending(null);
    let inBook = false;
    if (book !== null) {
        book.bound = binding;
        // Should an older build have given this account an id of its own, it
        // is dropped: the account uses the id from before from now on.
        delete book.ids[binding.account];
        if (book.pending?.id === binding.id) book.pending = null;
        inBook = await writeBook(book);
    }
    return inSettings || inBook;
}

/* ------------------------------------------------------ pending binds -- */

function settingPending(): PendingBind | null {
    try {
        return parsePendingBind(bindingSetting?.readPending?.());
    } catch {
        return null;
    }
}

function writeSettingPending(pending: PendingBind | null): boolean {
    try {
        if (bindingSetting?.writePending === undefined) return false;
        bindingSetting.writePending(pending);
        return true;
    } catch {
        return false;
    }
}

/**
 * The accounts that sent a link on `legacyId` whose answer was not taken in:
 * both copies together (an account named in either counts, so a copy that
 * lost an entry can only make it "nobody can tell", never another account).
 */
function pendingOf(book: AccountsBook | null, legacyId: string): PendingBind | null {
    const accounts = new Set<string>();
    for (const p of [settingPending(), book?.pending ?? null]) {
        if (p !== null && p.id === legacyId) for (const a of p.accounts) accounts.add(a);
    }
    return accounts.size > 0 ? { id: legacyId, accounts: [...accounts].slice(0, PENDING_MAX) } : null;
}

async function writePending(book: AccountsBook | null, pending: PendingBind | null): Promise<boolean> {
    const inSettings = writeSettingPending(pending);
    let inBook = false;
    if (book !== null) {
        book.pending = pending;
        inBook = await writeBook(book);
    }
    return inSettings || inBook;
}

/**
 * `account` is about to send a link (or a move) on the install id from
 * before while it is unbound: write it down first (header, rule 3). Nothing
 * when the id is bound already. Never throws; false when no store took it.
 */
export async function notePendingBind(account: string, legacyId: string): Promise<boolean> {
    if (!ACCOUNT_KEY_RE.test(account) || !isInstallId(legacyId)) return false;
    const book = await readBook();
    // Bound already: nothing to write down (the binding decides).
    if (bindingOf(book, legacyId) !== null) return true;
    const now = pendingOf(book, legacyId);
    const accounts = now === null ? [account] : now.accounts.includes(account) ? now.accounts : [...now.accounts, account];
    return writePending(book, { id: legacyId, accounts: accounts.slice(0, PENDING_MAX) });
}

/**
 * The relay refused `account`'s link on `legacyId` with an answer that wrote
 * nothing (wrong_account, plan_held...): that send linked nothing, so it is
 * no longer a candidate. Never throws.
 */
export async function dropPendingBind(account: string, legacyId: string): Promise<void> {
    const book = await readBook();
    const now = pendingOf(book, legacyId);
    if (now === null || !now.accounts.includes(account)) return;
    const rest = now.accounts.filter(a => a !== account);
    await writePending(book, rest.length > 0 ? { id: legacyId, accounts: rest } : null);
}

/**
 * A status answer says the install id from before is linked, and the
 * account using it has not bound it here (header, rule 3). Returns whose it
 * is: the binding already made, else the one account that sent a link on it
 * (bound now), else NOBODY (bound now: no account here gets it). Never throws.
 */
export async function settleLegacyLink(legacyId: string): Promise<string> {
    const book = await readBook();
    const existing = bindingOf(book, legacyId);
    if (existing !== null) return existing.account;
    const pending = pendingOf(book, legacyId);
    const binding: Binding = { account: pending !== null && pending.accounts.length === 1 ? pending.accounts[0]! : NOBODY, id: legacyId };
    await writeBinding(book, binding);
    return binding.account;
}

export interface AccountInstall {
    installId: string;
    /**
     * It is the install id from before (the installer's): every account
     * uses it until a confirmed link binds it, then only the bound one. Its
     * stores are the ones older builds wrote (taste scope "", the plain
     * entitlement key, code slot "").
     */
    legacy: boolean;
    /** The accounts that linked on this computer, as the book remembers them (empty when unreadable). */
    accounts: Record<string, LocalAccount>;
}

/**
 * The install id for `account` (see the header).
 *
 * WORST CASE, an unreadable book: the settings copy of the binding still says
 * who holds the install id from before. That account gets it; any other gets
 * a fresh id for this session, written nowhere (at most a Link press), never
 * the bound account's. With no binding anywhere, everyone shares the id from
 * before, which is rule 1.
 */
export async function installForAccount(account: string): Promise<AccountInstall> {
    const legacyId = await resolveLegacyInstallId();
    const book = await readBook();
    const binding = bindingOf(book, legacyId);
    // The book lost its copy (Discord's data cleared): put it back.
    if (book !== null && binding !== null && (book.bound?.account !== binding.account || book.bound.id !== binding.id)) {
        book.bound = binding;
        await writeBook(book);
    }
    // ...and the settings lost theirs (settings.json replaced): put that back too.
    if (binding !== null) writeSettingBinding(binding);
    if (binding === null || binding.account === account) {
        return { installId: legacyId, legacy: true, accounts: book?.accounts ?? {} };
    }
    if (book === null) return { installId: newInstallId(), legacy: false, accounts: {} };
    let id = book.ids[account];
    if (id === undefined || id === legacyId) {
        id = newInstallId();
        book.ids[account] = id;
        // Used for this session all the same if the write fails; the next start makes it again.
        await writeBook(book);
    }
    return { installId: id, legacy: false, accounts: book.accounts };
}

/**
 * A confirmed link answered linked on the install id from before (`legacyId`)
 * for `account`: from now on it is that account's, and every other local
 * account gets an id of its own. A binding already there for that id is
 * never moved to another account (only a new install id starts over),
 * except by `relaySaid` (below). Returns whether the binding is now
 * `account`'s (a store took it).
 */
export async function bindLegacyInstall(account: string, legacyId: string, opts: { relaySaid?: boolean; } = {}): Promise<boolean> {
    if (!ACCOUNT_KEY_RE.test(account) || !isInstallId(legacyId)) return false;
    const book = await readBook();
    const existing = bindingOf(book, legacyId);
    // `relaySaid`: the relay has just answered THIS account's own confirmed
    // link on that id. The relay links an install to the last account that
    // linked it, so the binding here follows (a switch that raced a
    // binding); keeping the old one would hand this account's plan to the
    // other account.
    if (existing !== null && existing.account !== account && opts.relaySaid !== true) return false;
    return writeBinding(book, { account, id: legacyId });
}

/**
 * Remember what this computer knows about a linked account: its Discord
 * username (local) and whether its plan is live. Written only when something
 * changed. Returns the accounts as now remembered, or null when the book
 * could not be read or the entry is malformed. Never throws.
 */
export async function noteLocalAccount(account: string, entry: LocalAccount): Promise<Record<string, LocalAccount> | null> {
    if (!ACCOUNT_KEY_RE.test(account)) return null;
    const clean = parseLocalAccount(entry);
    if (clean === null) return null;
    const book = await readBook();
    if (book === null) return null;
    const now = book.accounts[account];
    if (now?.name === clean.name && now.plan === clean.plan) return book.accounts;
    book.accounts[account] = clean;
    await writeBook(book);
    return book.accounts;
}

/**
 * Another local account that linked here and had a live plan when last seen,
 * other than `account`: its name, for "Your Subline plan is on @main on this
 * computer". Null when there is none.
 */
export function planElsewhere(account: string | null, accounts: Record<string, LocalAccount>): string | null {
    for (const [key, entry] of Object.entries(accounts)) {
        if (key !== account && entry.plan) return entry.name;
    }
    return null;
}

/* ------------------------------------------------------ the code fields -- */

/** The fields that belong to one slot's code. */
export interface CodeFields {
    code: string;
    cleared: string;
    deadSeen: { code: string; at: number; };
}

/** Where the code fields live (the plugin's settings, index.tsx). */
export interface CodeFieldStore {
    read(): CodeFields;
    write(fields: CodeFields): void;
    /** Whose the fields are: "" (the install id from before), an account key, or SWITCHING. */
    holder(): string;
    setHolder(slot: string): void;
    stash(): Record<string, CodeFields>;
    setStash(stash: Record<string, CodeFields>): void;
}

/** `codeAccount` while a swap is half done. */
export const SWITCHING = "switching";

/** The code slot of an account: "" while it uses the install id from before, else its own key. */
export function codeSlotFor(account: string, legacy: boolean): string {
    return legacy ? "" : account;
}

export const EMPTY_CODE_FIELDS: CodeFields = { code: "", cleared: "", deadSeen: { code: "", at: 0 } };

/** A stashed entry, checked field by field. Anything malformed is empty. */
export function parseCodeFields(raw: unknown): CodeFields {
    if (!raw || typeof raw !== "object") return { ...EMPTY_CODE_FIELDS, deadSeen: { code: "", at: 0 } };
    const o = raw as Record<string, unknown>;
    const d = o.deadSeen as { code?: unknown; at?: unknown; } | undefined;
    return {
        code: typeof o.code === "string" ? o.code : "",
        cleared: typeof o.cleared === "string" ? o.cleared : "",
        deadSeen: typeof d?.code === "string" && typeof d?.at === "number" ? { code: d.code, at: d.at } : { code: "", at: 0 }
    };
}

/**
 * Make the code fields `slot`'s. Returns whether they changed.
 *
 *  - Already this slot's: nothing. Every account that shares the install id
 *    from before shares slot "", so a switch between them moves nothing.
 *  - Another slot's: those go into the stash, this slot's come out (empty
 *    the first time).
 *  - SWITCHING (a swap was cut short): the stash is complete (it is written
 *    first), so this slot's simply come out of it.
 *
 * Order matters for that last case: stash, then SWITCHING, then the fields,
 * then the holder. Whatever the interruption, the next start can tell.
 */
export function swapCodeFields(store: CodeFieldStore, slot: string): boolean {
    const holder = store.holder();
    if (holder === slot) return false;
    const stash = { ...store.stash() };
    if (holder !== SWITCHING) {
        stash[holder] = store.read();
        store.setStash(stash);
    }
    store.setHolder(SWITCHING);
    store.write(parseCodeFields(stash[slot]));
    store.setHolder(slot);
    return true;
}
