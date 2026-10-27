// The game's files, wherever they come from: PARDOES.DAT (everything the script uses) and the CD's MEDIA folder
// (the Indeo 5 movies and PARDOES.WAV), as found in the PARDOES folder of the CD.

import { DatArchive } from './engine/dat.ts';

export interface MediaFile {
  size: number;
  /** The bytes as they arrive (movies are played while they stream in). */
  stream(): ReadableStream<Uint8Array>;
}

export interface GameFiles {
  dat: DatArchive;
  /** A file from PARDOES/MEDIA (`INTROA.AVI`, `PARDOES.WAV`), or null when missing. */
  media(name: string): Promise<MediaFile | null>;
  /** While PARDOES.DAT is still being downloaded: bytes received / total; null when complete. */
  datProgress(): { done: number; total: number } | null;
}

/** MEDIA names known on the CD (sizes from the ISO; also used for progress). */
export const MEDIA_FILES: Record<string, number> = {
  'INTROA.AVI': 129361458,
  'INTROB.AVI': 1687910,
  'ENDPRE.AVI': 20360522,
  'ENDPOST.AVI': 127593418,
  'GAMEOVER.AVI': 3781678,
  'PARDOES.WAV': 18795100,
};
export const DAT_SIZE = 216187505;

export const blobMedia = (blob: Blob): MediaFile => ({ size: blob.size, stream: () => blob.stream() as ReadableStream<Uint8Array> });

/** The two CD files every source must have. */
export function looksLikePardoes(paths: Iterable<string>): boolean {
  const set = new Set([...paths].map((p) => p.toUpperCase()));
  return set.has('PARDOES.DAT') && set.has('PARDOES.EXE');
}
