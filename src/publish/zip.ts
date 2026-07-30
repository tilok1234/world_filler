import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { deflateRawSync } from "node:zlib";

/**
 * Deterministic ZIP writer for pack archives — no dependencies, no
 * wall clock. Same input bytes produce the same archive bytes on every
 * platform and every run: entries are sorted by name, stored with
 * forward-slash paths, a fixed DOS timestamp (1980-01-01, the format's
 * epoch), fixed attributes, and a fixed deflate level. That keeps the
 * uploaded artifact itself hash-stable, in the same spirit as the
 * canonical pack serialization.
 */

const DOS_EPOCH_DATE = 0x21; // 1980-01-01 in DOS date encoding
const DOS_EPOCH_TIME = 0x00;

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = (CRC_TABLE[(crc ^ byte) & 0xff] as number) ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

interface ZipEntry {
  readonly name: string;
  readonly crc: number;
  readonly compressed: Buffer;
  readonly uncompressedSize: number;
  readonly localHeaderOffset: number;
}

function walkFiles(root: string, prefix: string): string[] {
  const names: string[] = [];
  for (const entry of readdirSync(join(root, prefix), { withFileTypes: true })) {
    const relative = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) names.push(...walkFiles(root, relative));
    else names.push(relative);
  }
  return names;
}

/** Archive every file under dir (recursively) as a deterministic zip. */
export function zipDirectory(dir: string): Buffer {
  const names = walkFiles(dir, "").sort();
  const chunks: Buffer[] = [];
  const entries: ZipEntry[] = [];
  let offset = 0;

  for (const name of names) {
    const bytes = readFileSync(join(dir, name));
    const compressed = deflateRawSync(bytes, { level: 9 });
    const nameBytes = Buffer.from(name, "utf8");
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0); // local file header signature
    header.writeUInt16LE(20, 4); // version needed: 2.0 (deflate)
    header.writeUInt16LE(0, 6); // flags
    header.writeUInt16LE(8, 8); // method: deflate
    header.writeUInt16LE(DOS_EPOCH_TIME, 10);
    header.writeUInt16LE(DOS_EPOCH_DATE, 12);
    const crc = crc32(bytes);
    header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(compressed.length, 18);
    header.writeUInt32LE(bytes.length, 22);
    header.writeUInt16LE(nameBytes.length, 26);
    header.writeUInt16LE(0, 28); // extra field length
    entries.push({ name, crc, compressed, uncompressedSize: bytes.length, localHeaderOffset: offset });
    chunks.push(header, nameBytes, compressed);
    offset += header.length + nameBytes.length + compressed.length;
  }

  const centralStart = offset;
  for (const entry of entries) {
    const nameBytes = Buffer.from(entry.name, "utf8");
    const record = Buffer.alloc(46);
    record.writeUInt32LE(0x02014b50, 0); // central directory signature
    record.writeUInt16LE(20, 4); // version made by
    record.writeUInt16LE(20, 6); // version needed
    record.writeUInt16LE(0, 8); // flags
    record.writeUInt16LE(8, 10); // method
    record.writeUInt16LE(DOS_EPOCH_TIME, 12);
    record.writeUInt16LE(DOS_EPOCH_DATE, 14);
    record.writeUInt32LE(entry.crc, 16);
    record.writeUInt32LE(entry.compressed.length, 20);
    record.writeUInt32LE(entry.uncompressedSize, 24);
    record.writeUInt16LE(nameBytes.length, 28);
    record.writeUInt16LE(0, 30); // extra
    record.writeUInt16LE(0, 32); // comment
    record.writeUInt16LE(0, 34); // disk number
    record.writeUInt16LE(0, 36); // internal attributes
    record.writeUInt32LE(0, 38); // external attributes
    record.writeUInt32LE(entry.localHeaderOffset, 42);
    chunks.push(record, nameBytes);
    offset += record.length + nameBytes.length;
  }

  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); // end of central directory signature
  end.writeUInt16LE(0, 4); // disk
  end.writeUInt16LE(0, 6); // central directory disk
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(offset - centralStart, 12);
  end.writeUInt32LE(centralStart, 16);
  end.writeUInt16LE(0, 20); // comment length
  chunks.push(end);

  return Buffer.concat(chunks);
}
