/**
 * Deterministic uint32 hash kernel. All operations are explicit 32-bit
 * unsigned arithmetic: multiplication through Math.imul (32-bit wrapping,
 * two's complement), every result normalized with >>> 0. No platform
 * randomness, no time, no transcendental functions — golden vectors in
 * fixtures/golden/kernel.json pin every primitive cross-platform.
 *
 * This is World Filler's own kernel (same doctrine as upstream, own
 * implementation and own constants); nothing requires its streams to match
 * any other tool's.
 */
/** Murmur3-style 32-bit finalizer: avalanche a value into a uint32. */
export function mix32(value) {
    let h = value >>> 0;
    h ^= h >>> 16;
    h = Math.imul(h, 0x85ebca6b) >>> 0;
    h ^= h >>> 13;
    h = Math.imul(h, 0xc2b2ae35) >>> 0;
    h ^= h >>> 16;
    return h >>> 0;
}
/** Order-dependent combine: fold b into accumulator a (FNV-style step). */
export function combine32(a, b) {
    const mixed = (a >>> 0) ^ mix32(b);
    return Math.imul(mixed, 0x01000193) >>> 0;
}
/** FNV-1a over the UTF-8 bytes of a string. */
export function hashString32(text) {
    const bytes = new TextEncoder().encode(text);
    let h = 0x811c9dc5;
    for (const byte of bytes) {
        h = (h ^ byte) >>> 0;
        h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h >>> 0;
}
/**
 * Fold a JavaScript safe integer (up to 53 bits, e.g. a WorldRecipe seed)
 * into a uint32: combine the low and high halves so seeds above 2^32 do not
 * silently alias their low words.
 */
export function fold53(value) {
    if (!Number.isSafeInteger(value) || value < 0) {
        throw new Error(`fold53: expected a non-negative safe integer, got ${value}`);
    }
    const low = value % 0x100000000;
    const high = Math.floor(value / 0x100000000);
    return combine32(low >>> 0, high >>> 0);
}
/** Hash a cell coordinate under a seed and salt (deterministic sampling). */
export function hashCell32(seed, x, y, salt) {
    let h = seed >>> 0;
    h = combine32(h, x >>> 0);
    h = combine32(h, y >>> 0);
    h = combine32(h, salt >>> 0);
    return mix32(h);
}
