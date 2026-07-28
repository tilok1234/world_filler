import { combine32, fold53, hashString32, mix32 } from "./hash.js";
/**
 * Hierarchical named seed channels — the reroll-scoping machinery.
 *
 * A channel is a (path, uint32 seed) pair. Children derive from the parent
 * seed plus the child's name only, so:
 *  - deriving or drawing from one channel can never perturb a sibling;
 *  - adding a new channel changes nothing that already existed;
 *  - rerolling a subtree = bumping a `reroll` segment in its path, which
 *    changes that subtree's streams and no others.
 *
 * Draws are stateless and indexed: u32(i) is the i-th value of the
 * channel's stream, independent of every other index. There is no hidden
 * cursor, so iteration order can never change a result.
 */
const MAX_RANGE = 2 ** 21;
export class Channel {
    path;
    seed;
    constructor(path, seed) {
        this.path = path;
        this.seed = seed;
    }
    /** Root channel for a world: derived from the director seed and a name. */
    static root(directorSeed, name = "world") {
        const seed = mix32(combine32(hashString32(name), fold53(directorSeed)));
        return new Channel(name, seed);
    }
    child(name) {
        if (name === "" || name.includes("/")) {
            throw new Error(`channel: invalid segment name "${name}"`);
        }
        const seed = mix32(combine32(this.seed, hashString32(name)));
        return new Channel(`${this.path}/${name}`, seed);
    }
    /** Descend several segments at once: channel.at("region.14", "boss"). */
    at(...names) {
        let current = this;
        for (const name of names)
            current = current.child(name);
        return current;
    }
    /** The i-th uint32 of this channel's stream. */
    u32(index) {
        if (!Number.isSafeInteger(index) || index < 0) {
            throw new Error(`channel: draw index must be a non-negative safe integer, got ${index}`);
        }
        return mix32(combine32(this.seed, fold53(index)));
    }
    /**
     * The i-th draw in [0, maxExclusive). Multiply-shift mapping — bias is
     * bounded by maxExclusive / 2^32 and maxExclusive is capped at 2^21 so
     * the product stays inside the safe-integer range.
     */
    int(index, maxExclusive) {
        if (!Number.isInteger(maxExclusive) || maxExclusive <= 0 || maxExclusive > MAX_RANGE) {
            throw new Error(`channel: maxExclusive must be in [1, ${MAX_RANGE}], got ${maxExclusive}`);
        }
        return Math.floor((this.u32(index) * maxExclusive) / 0x100000000);
    }
    /** The i-th pick from a non-empty list. */
    pick(items, index) {
        if (items.length === 0)
            throw new Error("channel: cannot pick from an empty list");
        return items[this.int(index, items.length)];
    }
    /**
     * The i-th weighted pick: returns an index into `weights`. Weights are
     * non-negative integers (permille/percent by convention) with a positive,
     * capped total.
     */
    weightedIndex(weights, index) {
        let total = 0;
        for (const weight of weights) {
            if (!Number.isInteger(weight) || weight < 0) {
                throw new Error(`channel: weights must be non-negative integers, got ${weight}`);
            }
            total += weight;
        }
        if (total <= 0 || total > MAX_RANGE) {
            throw new Error(`channel: weight total must be in [1, ${MAX_RANGE}], got ${total}`);
        }
        let remaining = Math.floor((this.u32(index) * total) / 0x100000000);
        for (let i = 0; i < weights.length; i += 1) {
            remaining -= weights[i];
            if (remaining < 0)
                return i;
        }
        return weights.length - 1;
    }
    /**
     * Deterministic Fisher-Yates shuffle (a new array; input untouched),
     * consuming draws baseIndex, baseIndex+1, ... so distinct shuffles on one
     * channel use distinct index ranges.
     */
    shuffle(items, baseIndex = 0) {
        const result = [...items];
        for (let i = result.length - 1; i > 0; i -= 1) {
            const j = this.int(baseIndex + (result.length - 1 - i), i + 1);
            const swap = result[i];
            result[i] = result[j];
            result[j] = swap;
        }
        return result;
    }
}
