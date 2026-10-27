// PARDOES.DAT: the game's one archive (2191 BMP/WAV/SPR/MAP files and the script PLAYER.SCR).
// Layout: u32 count, u32 dataStart, then count × { char name[13] (NUL padded), u32 endOffset }; entry i spans
// [end of entry i-1 (dataStart for the first), its end). The last table slot (count includes it) is an unused
// terminator that overlaps the start of the data.
//
// Sources: a Blob (the user's ISO, or the copy kept in OPFS) read lazily with slice(), or a download that is
// still streaming in: then a read waits until the bytes of that entry have arrived.

export interface DatEntry { name: string; start: number; end: number }

export class DatArchive {
  readonly entries = new Map<string, DatEntry>(); // UPPER name -> entry
  private readSpan: (start: number, end: number) => Promise<ArrayBuffer>;
  private constructor(readSpan: (start: number, end: number) => Promise<ArrayBuffer>) {
    this.readSpan = readSpan;
  }

  /** Parse the table of contents from the first bytes of the file (at least `dataStart` bytes). */
  private static parseToc(head: Uint8Array): DatEntry[] {
    const v = new DataView(head.buffer, head.byteOffset, head.byteLength);
    const count = v.getUint32(0, true);
    let start = v.getUint32(4, true);
    const out: DatEntry[] = [];
    for (let i = 0; i < count; i++) {
      const o = 8 + i * 17;
      if (o + 17 > head.length) break; // the terminator slot runs into the data
      let name = '';
      for (let k = 0; k < 13 && head[o + k]; k++) name += String.fromCharCode(head[o + k]);
      const end = v.getUint32(o + 13, true);
      if (!name) break;
      out.push({ name: name.toUpperCase(), start, end });
      start = end;
    }
    return out;
  }

  private add(list: DatEntry[]) {
    for (const e of list) this.entries.set(e.name, e);
  }

  static async fromBlob(blob: Blob): Promise<DatArchive> {
    const head = new Uint8Array(await blob.slice(0, 8).arrayBuffer());
    const dataStart = new DataView(head.buffer).getUint32(4, true);
    const toc = new Uint8Array(await blob.slice(0, dataStart).arrayBuffer());
    const dat = new DatArchive((s, e) => blob.slice(s, e).arrayBuffer());
    dat.add(DatArchive.parseToc(toc));
    return dat;
  }

  /**
   * A DAT that is being downloaded: `chunks` grows as bytes arrive. Resolves once the table of contents is in.
   * Call the returned `push` for each received chunk and `done`/`fail` at the end.
   */
  static streaming(): { ready: Promise<DatArchive>; push(chunk: Uint8Array): void; done(): void; fail(e: unknown): void; bytes(): Uint8Array[] } {
    const chunks: Uint8Array[] = [];
    const offsets: number[] = []; // start offset of each chunk
    let received = 0;
    let finished = false;
    let error: unknown = null;
    const waiters: { end: number; resolve: () => void; reject: (e: unknown) => void }[] = [];
    let readyResolve!: (d: DatArchive) => void, readyReject!: (e: unknown) => void;
    const ready = new Promise<DatArchive>((res, rej) => { readyResolve = res; readyReject = rej; });
    let dat: DatArchive | null = null;

    const copy = (s: number, e: number): ArrayBuffer => {
      const out = new Uint8Array(e - s);
      // binary search the first chunk holding s
      let lo = 0, hi = offsets.length - 1;
      while (lo < hi) { const m = (lo + hi + 1) >> 1; if (offsets[m] <= s) lo = m; else hi = m - 1; }
      for (let i = lo, o = 0; i < chunks.length && o < out.length; i++) {
        const c = chunks[i], cs = offsets[i];
        const a = Math.max(s, cs) - cs, b = Math.min(e, cs + c.length) - cs;
        if (b > a) { out.set(c.subarray(a, b), o); o += b - a; }
      }
      return out.buffer;
    };
    const span = (s: number, e: number) => {
      if (e <= received) return Promise.resolve(copy(s, e));
      if (error) return Promise.reject(error);
      if (finished) return Promise.reject(new Error('PARDOES.DAT: bestand korter dan verwacht'));
      return new Promise<void>((resolve, reject) => waiters.push({ end: e, resolve, reject })).then(() => copy(s, e));
    };
    const tryToc = () => {
      if (dat || received < 8) return;
      const head = new Uint8Array(copy(0, 8));
      const dataStart = new DataView(head.buffer).getUint32(4, true);
      if (received < dataStart) return;
      dat = new DatArchive(span);
      dat.add(DatArchive.parseToc(new Uint8Array(copy(0, dataStart))));
      readyResolve(dat);
    };
    return {
      ready,
      push(chunk) {
        offsets.push(received);
        chunks.push(chunk);
        received += chunk.length;
        tryToc();
        for (let i = waiters.length - 1; i >= 0; i--) if (waiters[i].end <= received) waiters.splice(i, 1)[0].resolve();
      },
      done() {
        finished = true;
        for (const w of waiters.splice(0)) w.reject(new Error('PARDOES.DAT: bestand korter dan verwacht'));
        if (!dat) readyReject(new Error('PARDOES.DAT: geen inhoudsopgave'));
      },
      fail(e) {
        error = e;
        for (const w of waiters.splice(0)) w.reject(e);
        if (!dat) readyReject(e);
      },
      bytes: () => chunks,
    };
  }

  /** Entry for a name as written in the script (case-insensitive; `ext` is tried when the name has none). */
  find(name: string, ext?: string): DatEntry | null {
    const n = name.replace(/\\/g, '/').split('/').pop()!.trim().toUpperCase();
    return this.entries.get(n) ?? (ext && !n.includes('.') ? this.entries.get(`${n}.${ext.toUpperCase()}`) ?? null : null);
  }

  has(name: string, ext?: string) {
    return this.find(name, ext) !== null;
  }

  async read(name: string, ext?: string): Promise<ArrayBuffer> {
    const e = this.find(name, ext);
    if (!e) throw new Error(`niet gevonden in PARDOES.DAT: ${name}`);
    return this.readSpan(e.start, e.end);
  }

  /** Swap the byte source (after a download was stored in OPFS) without touching the table. */
  rebase(blob: Blob) {
    this.readSpan = (s, e) => blob.slice(s, e).arrayBuffer();
  }
}
