/**
 * Bit-packed walkability grid codec, matching the game-pack contract:
 * encoding "base64-bitpacked-row-major-lsb-first" — bit i = y*width + x,
 * stored in byte i>>3 at bit position (i & 7), walkable = 1.
 */
export function packBits(bits) {
    const bytes = new Uint8Array(Math.ceil(bits.length / 8));
    for (let i = 0; i < bits.length; i += 1) {
        if (bits[i] === 1) {
            bytes[i >> 3] = bytes[i >> 3] | (1 << (i & 7));
        }
    }
    return bytes;
}
export function unpackBit(bytes, index) {
    return ((bytes[index >> 3] >> (index & 7)) & 1) === 1;
}
export function decodeBase64Grid(grid, cellCount) {
    const bytes = Uint8Array.from(Buffer.from(grid, "base64"));
    const expected = Math.ceil(cellCount / 8);
    if (bytes.length !== expected) {
        throw new Error(`walkability grid is ${bytes.length} bytes; expected ${expected} for ${cellCount} cells`);
    }
    return bytes;
}
/** Compare a derived 0/1 grid against packed reference bytes, cell-exact. */
export function compareGrids(ours, referenceBytes, width, maxReported) {
    let mismatchCount = 0;
    const samples = [];
    for (let index = 0; index < ours.length; index += 1) {
        const mine = ours[index] === 1;
        const reference = unpackBit(referenceBytes, index);
        if (mine !== reference) {
            mismatchCount += 1;
            if (samples.length < maxReported) {
                const x = index % width;
                samples.push({ index, x, y: (index - x) / width, ours: mine, reference });
            }
        }
    }
    return { mismatchCount, samples };
}
