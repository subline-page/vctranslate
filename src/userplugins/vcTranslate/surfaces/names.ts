/**
 * NAMES AND PRONOUNS (0.2.8): which ones are worth a translation.
 *
 * A NAME IS NOT A SENTENCE. Google turns names into meanings ("Rose" becomes
 * "Rosa", "Luna" becomes "Moon"), so a name is only translated by itself when
 * the reader could not even read it: when it is written in a script the
 * reading language does not use (王小明, Дмитрий, 김민준 for an English
 * reader). LATIN IS READ BY EVERYONE: a Latin name ("surfer_05", "Carito")
 * is never sent for any reading language, Japanese or Russian included
 * (owner, 2026-10-16). A name in the reader's own script is never sent, and gets no
 * tooltip, no line and no ✦ on any plan (owner rule 3, 2026-10-16).
 *
 * PRONOUNS FOLLOW THE SAME RULE, on their own: "he/him" or "er/ihm" is
 * never sent, for any reader; "он/его" is, for a reader who does not read
 * Cyrillic (owner rule 3, 2026-10-16).
 *
 * ONLY REAL LETTERS COUNT. The text is NFKC-normalized first (𝓒𝓪𝓻𝓲𝓽𝓸,
 * fullwidth and circled letters are the letters they stand for), and
 * emoji, symbols, punctuation and digits are not letters. Letters of a
 * script no reading language uses (ꕤ, ᥫ, ꨄ, ᰔ, 𐙚, the modifier letters
 * ꜝˊˎ) are decoration too: nobody reads them as a name.
 *
 * FANCY FONTS FIRST. "𝓓𝓶𝓲𝓽𝓻𝔂" is the Latin "Dmitry" in a font: it is decoded
 * with the same decoders messages use (decode.ts, normalize.ts), and a decoded
 * name in the reader's script is not sent anywhere.
 *
 * LOOK-ALIKES AND DECORATION. "Lυηα", "ΛLΞX" and "xX_ѕℓαуєя_Xx" are Latin
 * names spelled with Greek and Cyrillic letters that look Latin; "Luna ツ" and
 * "彡Luna彡" are Latin names with a letter or two of decoration. A Latin
 * reader reads all of them, so none is sent by itself (see readAsLatin and
 * isDecoration). Both rules are about scripts, never about particular names.
 *
 * Never a server, channel or role name: callers only ever hand over a
 * person's display name, server nickname, username or pronouns.
 *
 * Pure and synchronous: safe on every render.
 */

import { translatableText } from "../decode";

/**
 * The scripts Subline tells apart. A letter in none of them is decoration
 * and is not counted (see letterScripts).
 */
const SCRIPTS = [
    "Latin", "Cyrillic", "Greek", "Armenian", "Georgian", "Hebrew", "Arabic", "Thaana",
    "Devanagari", "Bengali", "Gurmukhi", "Gujarati", "Oriya", "Tamil", "Telugu", "Kannada",
    "Malayalam", "Sinhala", "Thai", "Lao", "Tibetan", "Myanmar", "Khmer", "Ethiopic",
    "Hangul", "Hiragana", "Katakana", "Han", "Bopomofo", "Mongolian"
] as const;

const SCRIPT_RES: ReadonlyArray<[string, RegExp]> = SCRIPTS.map(s => [s, new RegExp(`\\p{Script=${s}}`, "u")]);
const LETTER = /\p{L}/u;

/**
 * The scripts each reading language is written in. A language missing here is
 * read as Latin, the script most of them use. Where a language is commonly
 * written in two scripts (Serbian, Uzbek, Kurdish), both count as the
 * reader's own, so neither is translated by itself.
 */
const LANGUAGE_SCRIPTS: Readonly<Record<string, readonly string[]>> = {
    am: ["Ethiopic"],
    ar: ["Arabic"], fa: ["Arabic"], ps: ["Arabic"], ur: ["Arabic"],
    be: ["Cyrillic"], bg: ["Cyrillic"], kk: ["Cyrillic"], ky: ["Cyrillic"], mk: ["Cyrillic"],
    mn: ["Cyrillic", "Mongolian"], ru: ["Cyrillic"], uk: ["Cyrillic"],
    sr: ["Cyrillic", "Latin"], uz: ["Latin", "Cyrillic"], ku: ["Latin", "Arabic"],
    bn: ["Bengali"], gu: ["Gujarati"], pa: ["Gurmukhi"],
    hi: ["Devanagari"], mr: ["Devanagari"], ne: ["Devanagari"],
    ta: ["Tamil"], te: ["Telugu"], kn: ["Kannada"], ml: ["Malayalam"], si: ["Sinhala"],
    el: ["Greek"], he: ["Hebrew"], hy: ["Armenian"], ka: ["Georgian"],
    th: ["Thai"], lo: ["Lao"], km: ["Khmer"], my: ["Myanmar"],
    ja: ["Han", "Hiragana", "Katakana"],
    ko: ["Hangul", "Han"],
    zh: ["Han", "Bopomofo"]
};

/** The scripts the reader reads, from the reading language's code ("pt-BR" reads as "pt"). */
export function readerScripts(targetLang: unknown): ReadonlySet<string> {
    const base = typeof targetLang === "string" ? targetLang.toLowerCase().split(/[-_]/)[0] : "";
    return new Set(LANGUAGE_SCRIPTS[base] ?? ["Latin"]);
}

/** The script of one letter, or "other". */
function scriptOf(ch: string): string {
    for (const [name, re] of SCRIPT_RES) if (re.test(ch)) return name;
    return "other";
}

/**
 * NFKC for every character that normalizes to letters (𝓒, Ｃ, Ⓒ, ㋚ become
 * C, C, C, サ). Symbols stay exactly as they are: NFKC would split "˙" into a
 * space and a combining mark, and a decoration is no business of ours.
 */
function nfkc(text: string): string {
    let out = "";
    for (const ch of text) {
        let n: string;
        try {
            n = ch.normalize("NFKC");
        } catch {
            n = ch;
        }
        out += n !== ch && LETTER.test(n) ? n : ch;
    }
    return out;
}

/** A letter of a script someone reads: what the script rule counts. */
function countedScript(ch: string): string | null {
    if (!LETTER.test(ch)) return null;
    const script = scriptOf(ch);
    return script === "other" ? null : script;
}

/**
 * The scripts of every counted LETTER in `text`, after NFKC. Digits, emoji,
 * symbols and marks are not letters; letters of no script a reading
 * language uses are decoration and are not counted.
 */
export function letterScripts(text: string): Set<string> {
    const out = new Set<string>();
    for (const ch of nfkc(text)) {
        const script = countedScript(ch);
        if (script !== null) out.add(script);
    }
    return out;
}

/** A display name, nickname or username is at most 32 characters; anything far longer is not a name. */
export const NAME_MAX_CHARS = 100;
/** Discord's pronouns field holds at most 40 characters. */
export const PRONOUNS_MAX_CHARS = 100;

/** Decoded (fancy fonts, codes), NFKC-normalized and trimmed; "" for anything that is not a usable string. */
function readable(text: unknown, max: number): string {
    if (typeof text !== "string") return "";
    const t = text.trim();
    if (t === "" || t.length > max) return "";
    let decoded: string;
    try {
        decoded = translatableText(t);
    } catch {
        decoded = t;
    }
    return typeof decoded === "string" ? nfkc(decoded).replace(/\s+/g, " ").trim() : "";
}

/**
 * Greek, Cyrillic and letterlike letters that name generators use as Latin
 * ones ("Lυηα", "ΛLΞX", "ѕℓαуєя", "ЯЦИ"). Each maps to the Latin letter it is
 * drawn as. Only ever applied inside a word that mixes scripts (readAsLatin).
 */
const LATIN_LOOKALIKES: Readonly<Record<string, string>> = {
    // Greek
    Α: "A", Β: "B", Ε: "E", Ζ: "Z", Η: "H", Ι: "I", Κ: "K", Μ: "M", Ν: "N", Ο: "O", Ρ: "P", Τ: "T",
    Υ: "Y", Χ: "X", Λ: "A", Ξ: "E", Σ: "E", Δ: "A", Θ: "O",
    α: "a", β: "b", γ: "y", δ: "d", ε: "e", ϵ: "e", η: "n", ι: "i", κ: "k", ν: "v", ο: "o", ρ: "p",
    τ: "t", υ: "u", χ: "x", ω: "w", ς: "c",
    // Cyrillic
    А: "A", Б: "B", В: "B", Д: "A", Е: "E", Ё: "E", Ї: "I", І: "I", Ј: "J", К: "K", М: "M", Н: "H",
    И: "N", О: "O", Р: "P", С: "C", Т: "T", У: "Y", Х: "X", Ц: "U", Ч: "Y", Ш: "W", Э: "E", Я: "R",
    Ѕ: "S", Ь: "B",
    а: "a", б: "b", в: "b", е: "e", ё: "e", є: "e", ї: "i", і: "i", ј: "j", к: "k", м: "m", н: "h",
    и: "n", о: "o", п: "n", р: "p", с: "c", т: "t", у: "y", х: "x", ц: "u", ш: "w", э: "e", я: "r",
    ѕ: "s", ь: "b", ԁ: "d", ѵ: "v", ѡ: "w",
    // Letterlike symbols left as they are by normalize.ts when only one is used
    ℓ: "l", ℯ: "e", ℴ: "o", ℊ: "g", ℎ: "h"
};

const WORD = /[\p{L}\p{M}]+/gu;

/**
 * The name with look-alike letters read as Latin, for a reader who does not
 * read their script. Only a word that MIXES scripts is touched ("Lυηα" is
 * Latin and Greek, "ѕℓαуєя" Cyrillic, Greek and a letterlike ℓ): real writing
 * never mixes scripts inside one word, so "ΚΑΤΙΑ", "Ваня" or "Дима" (one
 * script each) are never read as Latin, however Latin their letters look.
 * Japanese mixes Han and kana in a word, but neither looks Latin, so such a
 * word is left as written. A word is changed only when EVERY letter the
 * reader does not read, outside Latin, has a look-alike; otherwise it stays
 * exactly as written.
 */
function readAsLatin(text: string, own: ReadonlySet<string>): string {
    return text.replace(WORD, word => {
        const letters = [...word].filter(ch => LETTER.test(ch));
        if (new Set(letters.map(scriptOf)).size < 2) return word;
        let out = "";
        for (const ch of word) {
            if (!LETTER.test(ch)) { out += ch; continue; }
            const script = scriptOf(ch);
            if (script === "Latin" || own.has(script)) { out += ch; continue; }
            const latin = LATIN_LOOKALIKES[ch];
            if (latin === undefined) return word;
            out += latin;
        }
        return out;
    });
}

/** At most this many letters from scripts the reader does not read count as decoration. */
const DECORATION_MAX_LETTERS = 2;

/**
 * "Luna ツ", "メLuna", "彡Luna彡": a name the reader reads, with a letter or
 * two of another script as decoration. It is decoration when there are at
 * most two such letters, at least three letters the reader reads, and at
 * least twice as many of those. "Al ツ", "Kim 王明" and "Dima | Дима" are not:
 * there the other script is as much of the name as the reader's.
 */
function isDecoration(text: string, own: ReadonlySet<string>): boolean {
    let mine = 0;
    let other = 0;
    for (const ch of text) {
        const script = countedScript(ch);
        if (script === null) continue;
        if (own.has(script)) mine++;
        else other++;
    }
    return other <= DECORATION_MAX_LETTERS && mine >= 3 && mine >= 2 * other;
}

/**
 * The text to translate for a name automatically, or null when it must not
 * be sent by itself: no letters, every letter (once decoded, look-alikes
 * read as Latin) is in a script the reader reads, or the other script is only
 * decoration. When it is sent, it is sent decoded and read as Latin.
 */
export function nameToTranslate(name: unknown, targetLang: unknown): string | null {
    return foreignText(name, targetLang, NAME_MAX_CHARS);
}

/** Fewer letters than this of no counted script are decoration (one rune), not a name. */
export const AI_ONLY_MIN_LETTERS = 3;

/**
 * A name written ONLY in letters of a script no reading language uses
 * (runes, say: "ᚠᚩᚱᛗᚢᚾᛞ"), at least AI_ONLY_MIN_LETTERS of them, decoded;
 * null otherwise. Google cannot read it, so it is never sent by itself; on
 * an AI plan its tooltip offers ✦ alone (owner decision 2026-10-16). A name
 * with any letter of a counted script follows nameToTranslate instead.
 */
export function aiOnlyName(name: unknown): string | null {
    const text = readable(name, NAME_MAX_CHARS);
    if (text === "") return null;
    let letters = 0;
    for (const ch of text) {
        if (!LETTER.test(ch)) continue;
        if (countedScript(ch) !== null) return null;
        letters++;
    }
    return letters >= AI_ONLY_MIN_LETTERS ? text : null;
}

/**
 * The scripts a reader of `targetLang` reads in a name: their own, and Latin
 * for everyone (owner, 2026-10-16: "no one wants an English name
 * translated"). A Latin name is never translated, whatever the reading
 * language.
 */
function readableScripts(targetLang: unknown): ReadonlySet<string> {
    return new Set([...readerScripts(targetLang), "Latin"]);
}

/** The script rule, for a name or pronouns of at most `max` characters. */
function foreignText(raw: unknown, targetLang: unknown, max: number): string | null {
    const own = readableScripts(targetLang);
    const text = readAsLatin(readable(raw, max), own);
    if (text === "") return null;
    const scripts = letterScripts(text);
    if (scripts.size === 0) return null;
    if ([...scripts].every(s => own.has(s))) return null;
    return isDecoration(text, own) ? null : text;
}

/**
 * The pronouns to translate, decoded, or null when they hold no letter.
 * NOT the name rule: Discord's pronouns field is free text ("i'm a discord
 * concept"), so it follows the bio's rule, by language, not by script. Google
 * decides; its "already your language" skip shows nothing. A Spanish reader
 * gets English pronouns translated (owner test 2026-10-16).
 */
export function pronounsToTranslate(pronouns: unknown, targetLang: unknown): string | null {
    const text = readAsLatin(readable(pronouns, PRONOUNS_MAX_CHARS), readableScripts(targetLang));
    return text !== "" && LETTER.test(text) ? text : null;
}

/** The letters of a text, NFKC and lower case: what "the same name" compares. */
function letterKey(text: string): string {
    let out = "";
    for (const ch of nfkc(text)) if (/[\p{L}\p{M}]/u.test(ch)) out += ch;
    return out.toLowerCase();
}

/**
 * True when an answer adds nothing: it is not a string, has no letters, or
 * has the same letters as one of `originals` (NFKC, case-insensitive, emoji,
 * symbols, punctuation and digits ignored). Such an answer is never shown,
 * as a tooltip or as a profile line (owner rule 4, 2026-10-16).
 */
export function sayNothingNew(answer: unknown, ...originals: unknown[]): boolean {
    if (typeof answer !== "string") return true;
    const key = letterKey(answer);
    if (key === "") return true;
    return originals.some(o => typeof o === "string" && letterKey(o) === key);
}
