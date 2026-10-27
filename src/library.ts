// Where the game files come from: an ISO the user supplied (kept in the browser's Origin Private File System),
// a CD folder picked in the browser, dev copies in public/data/pardoes/, or — by default — the ISO on archive.org.
// archive.org serves single files out of the ISO with CORS (view_archive.php) but without byte ranges, so PARDOES.DAT
// (216 MB) is downloaded once as a whole and kept in OPFS; while it streams in, every file that has arrived is usable.
// The movies are streamed from archive.org when they play.

import { IsoVfs } from './engine/vfs.ts';
import { DatArchive } from './engine/dat.ts';
import { blobMedia, DAT_SIZE, looksLikePardoes, MEDIA_FILES, type GameFiles, type MediaFile, type Progress } from './files.ts';

export const GAME_TITLE = 'Een Wonderlijk Avontuur met Pardoes de Tovernar';
export const ARCHIVE_ITEM = 'een-wonderlijk-avontuur-met-pardoes-de-tovernar';
export const ARCHIVE_ISO = 'Een Wonderlijk Avontuur met Pardoes de Tovernar.iso';
export const ARCHIVE_PAGE = `https://archive.org/details/${ARCHIVE_ITEM}`;
const ROOT = 'PARDOES';

export type Source = 'iso' | 'dev' | 'archive';
export interface Library { source: Source; open: (onProgress?: Progress) => Promise<GameFiles> }

const opfs = async () => navigator.storage.getDirectory();
const opfsDir = async (name: string) => (await opfs()).getDirectoryHandle(name, { create: true });

const archiveUrl = (path: string) =>
  `https://archive.org/download/${ARCHIVE_ITEM}/${encodeURIComponent(ARCHIVE_ISO)}/${encodeURIComponent(`${ROOT}/${path}`)}`;

export async function availableSource(): Promise<Library> {
  try {
    const h = await (await opfsDir('isos')).getFileHandle('pardoes.iso').catch(() => null);
    if (h) return { source: 'iso', open: async (p) => isoFiles(await IsoVfs.open(await h.getFile(), ROOT), p) };
  } catch (e) {
    console.warn('OPFS niet beschikbaar', e);
  }
  if (import.meta.env.DEV && new URLSearchParams(location.search).get('source') !== 'archive') {
    const base = `${import.meta.env.BASE_URL}data/pardoes/`;
    const probe = await fetch(base + 'PARDOES.DAT', { method: 'HEAD' }).catch(() => null);
    if (probe?.ok && probe.headers.get('content-length') === String(DAT_SIZE)) {
      return { source: 'dev', open: async (p) => remoteFiles((f) => base + f, false, p) };
    }
  }
  return { source: 'archive', open: async (p) => remoteFiles(archiveUrl, true, p) };
}

function isoFiles(iso: IsoVfs, onProgress?: Progress): Promise<GameFiles> {
  return DatArchive.fromBlob(iso.file('PARDOES.DAT'), onProgress).then((dat) => ({
    dat,
    media: async (name: string) => {
      try { return blobMedia(iso.file(`MEDIA/${name.toUpperCase()}`)); } catch { return null; }
    },
  }));
}

/** A CD folder picked with <input webkitdirectory>: used in this session only. */
export async function cdFolder(files: Iterable<[string, Blob]>, onProgress?: Progress): Promise<GameFiles> {
  const map = new Map<string, Blob>();
  for (const [p, b] of files) {
    const parts = p.replace(/\\/g, '/').toUpperCase().split('/');
    const i = parts.lastIndexOf(ROOT);
    if (i >= 0) map.set(parts.slice(i + 1).join('/'), b);
  }
  if (!looksLikePardoes(map.keys())) throw new Error('Geen Pardoes-cd gevonden in deze map (verwacht een map "PARDOES" met PARDOES.DAT).');
  const dat = await DatArchive.fromBlob(map.get('PARDOES.DAT')!, onProgress);
  return {
    dat,
    media: async (name) => { const b = map.get(`MEDIA/${name.toUpperCase()}`); return b ? blobMedia(b) : null; },
  };
}

/** Store an ISO the user picked (after checking it is the Pardoes CD). */
export async function addIso(file: Blob, onProgress?: (f: number) => void): Promise<void> {
  const iso = await IsoVfs.open(file, ROOT);
  if (!looksLikePardoes(iso.list())) throw new Error('Deze ISO is niet de cd van Pardoes de Tovernar.');
  const h = await (await opfsDir('isos')).getFileHandle('pardoes.iso', { create: true });
  const w = await h.createWritable();
  const CHUNK = 8 << 20;
  for (let o = 0; o < file.size; o += CHUNK) {
    await w.write(await file.slice(o, o + CHUNK).arrayBuffer());
    onProgress?.(Math.min(1, (o + CHUNK) / file.size));
  }
  await w.close();
}

export async function removeIso() {
  await (await opfsDir('isos')).removeEntry('pardoes.iso').catch(() => {});
}

// ---- remote (archive.org, or the dev server): PARDOES.DAT once, kept in OPFS

async function storedDat(): Promise<File | null> {
  try {
    const dir = await opfsDir('archive');
    const ok = await dir.getFileHandle('pardoes.dat.ok').catch(() => null);
    if (!ok) return null;
    const f = await (await dir.getFileHandle('pardoes.dat')).getFile();
    return f.size === DAT_SIZE ? f : null;
  } catch {
    return null;
  }
}

async function storeDat(bytes: Uint8Array): Promise<void> {
  try {
    const dir = await opfsDir('archive');
    await dir.removeEntry('pardoes.dat.ok').catch(() => {});
    const h = await dir.getFileHandle('pardoes.dat', { create: true });
    const w = await h.createWritable();
    await w.write(bytes as Uint8Array<ArrayBuffer>);
    await w.close();
    await dir.getFileHandle('pardoes.dat.ok', { create: true });
  } catch (e) {
    console.warn('PARDOES.DAT kon niet in de browser bewaard worden; volgende keer wordt hij opnieuw geladen', e);
  }
}

async function remoteFiles(url: (path: string) => string, keep: boolean, onProgress?: Progress): Promise<GameFiles> {
  const media = async (name: string): Promise<MediaFile | null> => {
    const n = name.toUpperCase();
    if (!(n in MEDIA_FILES)) return null;
    return {
      size: MEDIA_FILES[n],
      stream: () => {
        // fetch lazily on the first pull; the response body is the stream
        let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
        return new ReadableStream<Uint8Array>({
          async pull(ctl) {
            if (!reader) {
              const res = await fetch(url(`MEDIA/${n}`));
              if (!res.ok || !res.body) throw new Error(`${n}: HTTP ${res.status}`);
              reader = res.body.getReader();
            }
            const { done, value } = await reader.read();
            if (done) ctl.close(); else ctl.enqueue(value);
          },
          cancel() { void reader?.cancel(); },
        });
      },
    };
  };

  const stored = keep ? await storedDat() : null;
  if (stored) return { dat: await DatArchive.fromBlob(stored, onProgress), media };

  // no byte ranges on archive.org: a broken download can only start over
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url('PARDOES.DAT'));
      if (!res.ok || !res.body) throw new Error(`PARDOES.DAT: HTTP ${res.status}`);
      const buf = new Uint8Array(DAT_SIZE);
      const reader = res.body.getReader();
      let o = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (o + value.length > DAT_SIZE) throw new Error('PARDOES.DAT: groter dan verwacht');
        buf.set(value, o);
        o += value.length;
        onProgress?.(o, DAT_SIZE);
      }
      if (o !== DAT_SIZE) throw new Error(`PARDOES.DAT: onvolledig (${o} van ${DAT_SIZE} bytes)`);
      if (keep) void storeDat(buf);
      return { dat: new DatArchive(buf), media };
    } catch (e) {
      lastErr = e;
      await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
    }
  }
  throw lastErr;
}
