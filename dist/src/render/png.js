import { deflateSync } from "node:zlib";
/**
 * Minimal zero-dependency PNG encoder: 8-bit RGBA, no interlace, filter 0
 * on every scanline. Renders are inspection evidence, not identity-bearing
 * artifacts — the analysis JSON carries the deterministic identity; PNG
 * bytes may legally differ across zlib builds.
 */
const SIGNATURE = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
        let c = n;
        for (let k = 0; k < 8; k += 1) {
            c = (c & 1) === 1 ? (0xedb88320 ^ (c >>> 1)) >>> 0 : c >>> 1;
        }
        table[n] = c >>> 0;
    }
    return table;
})();
function crc32(bytes) {
    let crc = 0xffffffff;
    for (const byte of bytes) {
        crc = (CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8)) >>> 0;
    }
    return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
    const out = new Uint8Array(12 + data.length);
    const view = new DataView(out.buffer);
    view.setUint32(0, data.length);
    for (let i = 0; i < 4; i += 1)
        out[4 + i] = type.charCodeAt(i);
    out.set(data, 8);
    const crcInput = out.subarray(4, 8 + data.length);
    view.setUint32(8 + data.length, crc32(crcInput));
    return out;
}
/** Encode an RGBA image (4 bytes per pixel, row-major) as PNG bytes. */
export function encodePng(width, height, rgba) {
    if (rgba.length !== width * height * 4) {
        throw new Error(`png: expected ${width * height * 4} bytes of RGBA, got ${rgba.length}`);
    }
    const ihdr = new Uint8Array(13);
    const ihdrView = new DataView(ihdr.buffer);
    ihdrView.setUint32(0, width);
    ihdrView.setUint32(4, height);
    ihdr[8] = 8; // bit depth
    ihdr[9] = 6; // color type RGBA
    ihdr[10] = 0; // compression
    ihdr[11] = 0; // filter
    ihdr[12] = 0; // interlace
    const stride = width * 4;
    const raw = new Uint8Array((stride + 1) * height);
    for (let y = 0; y < height; y += 1) {
        raw[y * (stride + 1)] = 0; // filter type 0
        raw.set(rgba.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
    }
    const idat = Uint8Array.from(deflateSync(raw));
    const parts = [SIGNATURE, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", new Uint8Array(0))];
    const total = parts.reduce((sum, part) => sum + part.length, 0);
    const out = new Uint8Array(total);
    let offset = 0;
    for (const part of parts) {
        out.set(part, offset);
        offset += part.length;
    }
    return out;
}
