/**
 * A QR CODE, MADE HERE (0.2.8 "Pay on another device").
 *
 * The buy panel shows the checkout link as a QR code, for a phone or another
 * computer when this one cannot open the payment page (a VPN that blocks it).
 * The code is made on this computer: the link never goes to a QR service, and
 * no library is added (the pinned Vencord has none).
 *
 * WHAT IT ENCODES. ISO/IEC 18004 Model 2, byte mode (the text as UTF-8), error
 * correction level M (15% of the symbol can be damaged and it still reads),
 * the smallest version (1 to 40) the text fits in, and the mask with the
 * lowest penalty score (rules N1 to N4 of the standard, as the widely used
 * `qrcode` npm package scores them, so both pick the same mask). The tests
 * compare whole symbols with that package's, and read every symbol back with
 * a decoder of their own.
 *
 * Pure: no Discord, no DOM. qrSvgPath turns the modules into one SVG path.
 */

/** Level M's error correction codewords per block, by version (index 0 unused). */
const ECC_PER_BLOCK = [
    -1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26,
    26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28
];
/** Level M's error correction blocks, by version (index 0 unused). */
const BLOCKS = [
    -1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16,
    17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49
];
/** Level M's two format bits (L = 01, M = 00, Q = 11, H = 10). */
const LEVEL_M_BITS = 0;

/** The modules of a QR code: `true` is dark. Row by row. */
export type QrMatrix = boolean[][];

/** Modules for data and error correction in a version (everything but the function patterns). */
function rawDataModules(version: number): number {
    let result = (16 * version + 128) * version + 64;
    if (version >= 2) {
        const align = Math.floor(version / 7) + 2;
        result -= (25 * align - 10) * align - 55;
        if (version >= 7) result -= 36;
    }
    return result;
}

/** Data codewords at level M. */
function dataCodewords(version: number): number {
    return Math.floor(rawDataModules(version) / 8) - ECC_PER_BLOCK[version]! * BLOCKS[version]!;
}

/* ------------------------------------------------- Reed-Solomon, GF(256) -- */

/** Product in GF(2^8) modulo x^8 + x^4 + x^3 + x^2 + 1 (0x11D). */
function gfMultiply(x: number, y: number): number {
    let z = 0;
    for (let i = 7; i >= 0; i--) {
        z = (z << 1) ^ ((z >>> 7) * 0x11D);
        z ^= ((y >>> i) & 1) * x;
    }
    return z & 0xFF;
}

/** The generator polynomial of `degree` (its leading 1 left out), highest power first. */
function rsDivisor(degree: number): number[] {
    const result = new Array<number>(degree).fill(0);
    result[degree - 1] = 1;
    let root = 1;
    for (let i = 0; i < degree; i++) {
        for (let j = 0; j < result.length; j++) {
            result[j] = gfMultiply(result[j]!, root);
            if (j + 1 < result.length) result[j]! ^= result[j + 1]!;
        }
        root = gfMultiply(root, 0x02);
    }
    return result;
}

/** The error correction codewords of `data`. */
function rsRemainder(data: readonly number[], divisor: readonly number[]): number[] {
    const result = new Array<number>(divisor.length).fill(0);
    for (const b of data) {
        const factor = b ^ result.shift()!;
        result.push(0);
        divisor.forEach((coef, i) => { result[i]! ^= gfMultiply(coef, factor); });
    }
    return result;
}

/* ----------------------------------------------------------- the symbol -- */

class QrSymbol {
    readonly size: number;
    readonly modules: boolean[][];
    readonly isFunction: boolean[][];

    constructor(readonly version: number) {
        this.size = version * 4 + 17;
        this.modules = Array.from({ length: this.size }, () => new Array<boolean>(this.size).fill(false));
        this.isFunction = Array.from({ length: this.size }, () => new Array<boolean>(this.size).fill(false));
    }

    set(x: number, y: number, dark: boolean): void {
        this.modules[y]![x] = dark;
        this.isFunction[y]![x] = true;
    }

    drawFunctionPatterns(): void {
        const { size } = this;
        for (let i = 0; i < size; i++) {
            this.set(6, i, i % 2 === 0);
            this.set(i, 6, i % 2 === 0);
        }
        this.drawFinder(3, 3);
        this.drawFinder(size - 4, 3);
        this.drawFinder(3, size - 4);
        const positions = this.alignmentPositions();
        const n = positions.length;
        for (let i = 0; i < n; i++) {
            for (let j = 0; j < n; j++) {
                // Not over the three finder patterns.
                if ((i === 0 && j === 0) || (i === 0 && j === n - 1) || (i === n - 1 && j === 0)) continue;
                this.drawAlignment(positions[i]!, positions[j]!);
            }
        }
        // Reserved now, written for real once the mask is chosen.
        this.drawFormat(0);
        this.drawVersion();
    }

    /** A finder pattern and its separator, centred on (x, y). */
    drawFinder(x: number, y: number): void {
        for (let dy = -4; dy <= 4; dy++) {
            for (let dx = -4; dx <= 4; dx++) {
                const dist = Math.max(Math.abs(dx), Math.abs(dy));
                const xx = x + dx, yy = y + dy;
                if (xx >= 0 && xx < this.size && yy >= 0 && yy < this.size) this.set(xx, yy, dist !== 2 && dist !== 4);
            }
        }
    }

    drawAlignment(x: number, y: number): void {
        for (let dy = -2; dy <= 2; dy++) {
            for (let dx = -2; dx <= 2; dx++) this.set(x + dx, y + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
        }
    }

    /** The centres of the alignment patterns, on each axis. */
    alignmentPositions(): number[] {
        if (this.version === 1) return [];
        const count = Math.floor(this.version / 7) + 2;
        const step = this.version === 32 ? 26 : Math.ceil((this.version * 4 + 4) / (count * 2 - 2)) * 2;
        const result = [6];
        for (let pos = this.size - 7; result.length < count; pos -= step) result.splice(1, 0, pos);
        return result;
    }

    /** The 15 format bits (level M and the mask, BCH coded), both copies. */
    drawFormat(mask: number): void {
        const data = (LEVEL_M_BITS << 3) | mask;
        let rem = data;
        for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
        const bits = ((data << 10) | rem) ^ 0x5412;
        const bit = (i: number) => ((bits >>> i) & 1) !== 0;
        for (let i = 0; i <= 5; i++) this.set(8, i, bit(i));
        this.set(8, 7, bit(6));
        this.set(8, 8, bit(7));
        this.set(7, 8, bit(8));
        for (let i = 9; i < 15; i++) this.set(14 - i, 8, bit(i));
        for (let i = 0; i < 8; i++) this.set(this.size - 1 - i, 8, bit(i));
        for (let i = 8; i < 15; i++) this.set(8, this.size - 15 + i, bit(i));
        // The dark module, always.
        this.set(8, this.size - 8, true);
    }

    /** The 18 version bits (BCH coded), version 7 and up. */
    drawVersion(): void {
        if (this.version < 7) return;
        let rem = this.version;
        for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1F25);
        const bits = (this.version << 12) | rem;
        for (let i = 0; i < 18; i++) {
            const dark = ((bits >>> i) & 1) !== 0;
            const a = this.size - 11 + (i % 3);
            const b = Math.floor(i / 3);
            this.set(a, b, dark);
            this.set(b, a, dark);
        }
    }

    /** The codewords, in the standard's zigzag, two columns at a time from the right. */
    drawCodewords(codewords: readonly number[]): void {
        let i = 0;
        for (let right = this.size - 1; right >= 1; right -= 2) {
            if (right === 6) right = 5;
            for (let vert = 0; vert < this.size; vert++) {
                for (let j = 0; j < 2; j++) {
                    const x = right - j;
                    const upward = ((right + 1) & 2) === 0;
                    const y = upward ? this.size - 1 - vert : vert;
                    if (!this.isFunction[y]![x] && i < codewords.length * 8) {
                        this.modules[y]![x] = ((codewords[i >>> 3]! >>> (7 - (i & 7))) & 1) !== 0;
                        i++;
                    }
                    // Remainder bits (when there are any) stay light.
                }
            }
        }
    }

    /** XOR the mask over the data modules. Applying it twice undoes it. */
    applyMask(mask: number): void {
        for (let y = 0; y < this.size; y++) {
            for (let x = 0; x < this.size; x++) {
                if (this.isFunction[y]![x]) continue;
                if (maskBit(mask, x, y)) this.modules[y]![x] = !this.modules[y]![x];
            }
        }
    }
}

/** Whether mask `mask` inverts the module at column x, row y (ISO/IEC 18004 table 10). */
export function maskBit(mask: number, x: number, y: number): boolean {
    switch (mask) {
        case 0: return (x + y) % 2 === 0;
        case 1: return y % 2 === 0;
        case 2: return x % 3 === 0;
        case 3: return (x + y) % 3 === 0;
        case 4: return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0;
        case 5: return (x * y) % 2 + (x * y) % 3 === 0;
        case 6: return ((x * y) % 2 + (x * y) % 3) % 2 === 0;
        case 7: return ((x + y) % 2 + (x * y) % 3) % 2 === 0;
        default: throw new RangeError("mask");
    }
}

/**
 * The penalty of a masked symbol (rules N1 to N4): runs of five or more,
 * 2x2 blocks of one colour, finder-like 1:1:3:1:1 runs, and how far the dark
 * share is from half.
 */
export function penalty(m: QrMatrix): number {
    const size = m.length;
    let points = 0;
    // N1: a run of 5 or more of one colour, in a row or a column: 3 + (run - 5).
    for (let row = 0; row < size; row++) {
        let sameRow = 0, sameCol = 0, lastRow: boolean | null = null, lastCol: boolean | null = null;
        for (let col = 0; col < size; col++) {
            let module = m[row]![col]!;
            if (module === lastRow) sameRow++;
            else {
                if (sameRow >= 5) points += 3 + (sameRow - 5);
                lastRow = module;
                sameRow = 1;
            }
            module = m[col]![row]!;
            if (module === lastCol) sameCol++;
            else {
                if (sameCol >= 5) points += 3 + (sameCol - 5);
                lastCol = module;
                sameCol = 1;
            }
        }
        if (sameRow >= 5) points += 3 + (sameRow - 5);
        if (sameCol >= 5) points += 3 + (sameCol - 5);
    }
    // N2: each 2x2 block of one colour: 3.
    for (let row = 0; row < size - 1; row++) {
        for (let col = 0; col < size - 1; col++) {
            const c = m[row]![col]!;
            if (c === m[row]![col + 1] && c === m[row + 1]![col] && c === m[row + 1]![col + 1]) points += 3;
        }
    }
    // N3: dark-light-dark-dark-dark-light-dark with four light on one side
    // (1011101 0000, or 0000 1011101), in a row or a column: 40 each.
    let n3 = 0;
    for (let row = 0; row < size; row++) {
        let bitsRow = 0, bitsCol = 0;
        for (let col = 0; col < size; col++) {
            bitsRow = ((bitsRow << 1) & 0x7FF) | (m[row]![col] ? 1 : 0);
            if (col >= 10 && (bitsRow === 0x5D0 || bitsRow === 0x05D)) n3++;
            bitsCol = ((bitsCol << 1) & 0x7FF) | (m[col]![row] ? 1 : 0);
            if (col >= 10 && (bitsCol === 0x5D0 || bitsCol === 0x05D)) n3++;
        }
    }
    points += n3 * 40;
    // N4: 10 for every 5% the dark share is away from 50%.
    let dark = 0;
    for (const row of m) for (const module of row) if (module) dark++;
    const k = Math.abs(Math.ceil((dark * 100 / (size * size)) / 5) - 10);
    return points + k * 10;
}

/** The text's bytes (UTF-8). */
function utf8(text: string): number[] {
    return [...new TextEncoder().encode(text)];
}

/**
 * The QR code of `text` at level M, or null when it does not fit (more than
 * 2331 bytes, version 40). `mask` forces a mask (tests); otherwise the one
 * with the lowest penalty is used, the lowest number on a tie.
 */
export function qrMatrix(text: string, mask?: number): QrMatrix | null {
    const bytes = utf8(text);
    let version = 1;
    for (; version <= 40; version++) {
        const countBits = version <= 9 ? 8 : 16;
        if (bytes.length < 2 ** countBits && 4 + countBits + bytes.length * 8 <= dataCodewords(version) * 8) break;
    }
    if (version > 40) return null;

    // The bit stream: mode (byte, 0100), count, data, terminator, pad.
    const bits: number[] = [];
    const put = (value: number, length: number) => { for (let i = length - 1; i >= 0; i--) bits.push((value >>> i) & 1); };
    put(0b0100, 4);
    put(bytes.length, version <= 9 ? 8 : 16);
    for (const b of bytes) put(b, 8);
    const capacity = dataCodewords(version) * 8;
    put(0, Math.min(4, capacity - bits.length));
    put(0, (8 - (bits.length % 8)) % 8);
    for (let pad = 0xEC; bits.length < capacity; pad ^= 0xEC ^ 0x11) put(pad, 8);
    const data: number[] = [];
    for (let i = 0; i < bits.length; i += 8) data.push(bits.slice(i, i + 8).reduce((acc, b) => (acc << 1) | b, 0));

    // Split into blocks, add each block's error correction, interleave.
    const blockCount = BLOCKS[version]!;
    const eccLen = ECC_PER_BLOCK[version]!;
    const rawCodewords = Math.floor(rawDataModules(version) / 8);
    const shortBlocks = blockCount - (rawCodewords % blockCount);
    const shortLen = Math.floor(rawCodewords / blockCount);
    const divisor = rsDivisor(eccLen);
    const blocks: number[][] = [];
    for (let i = 0, k = 0; i < blockCount; i++) {
        const dat = data.slice(k, k + shortLen - eccLen + (i < shortBlocks ? 0 : 1));
        k += dat.length;
        const block = dat.concat(rsRemainder(dat, divisor));
        if (i < shortBlocks) block.splice(dat.length, 0, -1);
        blocks.push(block);
    }
    const codewords: number[] = [];
    for (let i = 0; i < blocks[0]!.length; i++) {
        blocks.forEach((block, j) => {
            if (i !== shortLen - eccLen || j >= shortBlocks) codewords.push(block[i]!);
        });
    }

    const symbol = new QrSymbol(version);
    symbol.drawFunctionPatterns();
    symbol.drawCodewords(codewords);
    let chosen = mask ?? -1;
    if (chosen < 0) {
        let best = Infinity;
        for (let i = 0; i < 8; i++) {
            symbol.applyMask(i);
            symbol.drawFormat(i);
            const score = penalty(symbol.modules);
            if (score < best) { best = score; chosen = i; }
            symbol.applyMask(i);
        }
    }
    symbol.applyMask(chosen);
    symbol.drawFormat(chosen);
    return symbol.modules.map(row => row.slice());
}

/**
 * One SVG path drawing the dark modules, each a unit square, offset by a
 * light margin of `quiet` modules (the standard asks for 4). The viewBox is
 * `0 0 n n` with n = qrViewSize(matrix, quiet).
 */
export function qrSvgPath(matrix: QrMatrix, quiet = 4): string {
    const parts: string[] = [];
    matrix.forEach((row, y) => {
        row.forEach((dark, x) => { if (dark) parts.push(`M${x + quiet} ${y + quiet}h1v1h-1z`); });
    });
    return parts.join("");
}

/** The width (and height) of the drawing, quiet margin included. */
export function qrViewSize(matrix: QrMatrix, quiet = 4): number {
    return matrix.length + quiet * 2;
}
