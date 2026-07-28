/**
 * Canonical JSON writer, mirroring the upstream serialization doctrine so
 * World Filler outputs are byte-stable and upstream files round-trip:
 * keys sorted by UTF-16 code units, 2-space indent, LF newlines, one
 * trailing newline, UTF-8, and only JSON-safe values — numbers must be
 * safe integers (fractional quantities are expressed as permille/percent
 * integers by contract), and undefined/NaN/Infinity throw instead of
 * silently degrading.
 */
export function canonicalJson(value) {
    return render(sortValue(value, "$")) + "\n";
}
function sortValue(value, path) {
    if (value === null)
        return null;
    switch (typeof value) {
        case "string":
        case "boolean":
            return value;
        case "number":
            if (!Number.isSafeInteger(value)) {
                throw new Error(`canonicalJson: ${path} is not a safe integer: ${value}`);
            }
            return value;
        case "object":
            break;
        default:
            throw new Error(`canonicalJson: ${path} has unsupported type ${typeof value}`);
    }
    if (Array.isArray(value)) {
        return value.map((entry, i) => sortValue(entry, `${path}[${i}]`));
    }
    const record = value;
    const sorted = {};
    for (const key of Object.keys(record).sort()) {
        const entry = record[key];
        if (entry === undefined) {
            throw new Error(`canonicalJson: ${path}.${key} is undefined`);
        }
        sorted[key] = sortValue(entry, `${path}.${key}`);
    }
    return sorted;
}
function render(value) {
    return JSON.stringify(value, null, 2);
}
