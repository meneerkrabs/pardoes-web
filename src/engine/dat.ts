// PARDOES.DAT: the game's one archive (2191 BMP/WAV/SPR/MAP files and the script PLAYER.SCR).
// Layout: u32 count, u32 dataStart, then count × { char name[13] (NUL padded), u32 endOffset }; entry i spans
// [end of entry i-1 (dataStart for the first), its end). The last table slot (count includes it) is an unused
// terminator that overlaps the start of the data.
//
// The engine reads files synchronously in the middle of a script chain (like the original), so the whole archive is
// held in memory as one buffer (216 MB) and entries are views into it.

export interface DatEntry { name: string; start: number; end: number }

export class DatArchive {
  readonly entries = new Map<string, DatEntry>(); // UPPER name -> entry
  readonly bytes: Uint8Array;

  constructor(bytes: Uint8Array) {
    this.bytes = bytes;
    const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const count = v.getUint32(0, true);
    const dataStart = v.getUint32(4, true);
    let start = dataStart;
    for (let i = 0; i < count; i++) {
      const o = 8 + i * 17;
      if (o + 17 > dataStart) break; // the terminator slot runs into the data
      let name = '';
      for (let k = 0; k < 13 && bytes[o + k]; k++) name += String.fromCharCode(bytes[o + k]);
      const end = v.getUint32(o + 13, true);
      if (!name) break;
      this.entries.set(name.toUpperCase(), { name: name.toUpperCase(), start, end });
      start = end;
    }
  }

  /** Read a Blob (ISO extent, OPFS copy, CD file) completely into memory. */
  static async fromBlob(blob: Blob, onProgress?: (done: number, total: number) => void): Promise<DatArchive> {
    const out = new Uint8Array(blob.size);
    const reader = (blob.stream() as ReadableStream<Uint8Array>).getReader();
    let o = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      out.set(value, o);
      o += value.length;
      onProgress?.(o, blob.size);
    }
    return new DatArchive(out);
  }

  /** Entry for a name as written in the script (case-insensitive; `ext` is tried when the name has none). */
  find(name: string, ext?: string): DatEntry | null {
    const n = name.replace(/\\/g, '/').split('/').pop()!.trim().toUpperCase();
    return this.entries.get(n) ?? (ext && !n.includes('.') ? this.entries.get(`${n}.${ext.toUpperCase()}`) ?? null : null);
  }

  has(name: string, ext?: string) {
    return this.find(name, ext) !== null;
  }

  /** The file's bytes (a view into the archive; do not modify). */
  get(name: string, ext?: string): Uint8Array | null {
    const e = this.find(name, ext);
    return e ? this.bytes.subarray(e.start, e.end) : null;
  }

  /** A copy as ArrayBuffer (for decoders that take ownership, e.g. decodeAudioData). */
  read(name: string, ext?: string): ArrayBuffer {
    const b = this.get(name, ext);
    if (!b) throw new Error(`niet gevonden in PARDOES.DAT: ${name}`);
    return b.slice().buffer;
  }

  text(name: string): string {
    const b = this.get(name);
    if (!b) throw new Error(`niet gevonden in PARDOES.DAT: ${name}`);
    return new TextDecoder('windows-1252').decode(b);
  }
}
