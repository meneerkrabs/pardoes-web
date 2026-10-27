// Placeholder until the script interpreter lands: proves the file plumbing (DAT streaming, BMP decode, display).
import { Form, type Display } from '../engine/vcl.ts';
import { decodeBmp } from '../engine/surface.ts';
import { playMovie } from '../engine/movie.ts';
import type { GameFiles } from '../files.ts';

export async function startGame(display: Display, files: GameFiles, _onQuit: () => void): Promise<void> {
  const progress = setInterval(() => {
    const p = files.datProgress();
    display.progress(p?.done ?? 0, p?.total ?? 0);
    if (!p) clearInterval(progress);
  }, 200);
  const script = new TextDecoder('windows-1252').decode(await files.dat.read('PLAYER.SCR'));
  console.log('PLAYER.SCR', script.length, 'chars,', files.dat.entries.size, 'files');
  const f = new Form(display);
  const img = decodeBmp(await files.dat.read('XTITEL2.BMP'));
  f.onPaint = () => f.surface.bitBlt(0, 0, img.width, img.height, img, 0, 0);
  f.show();
  const movie = new URLSearchParams(location.search).get('movie');
  if (movie) {
    const m = await files.media(movie);
    if (m) {
      const t = performance.now();
      const pb = playMovie(m.stream(), f.surface, 0, 0, { onFrame: () => f.invalidate() });
      f.onPaint = null;
      await pb.done;
      (globalThis as { __movieMs?: number }).__movieMs = performance.now() - t;
    }
  }
  (globalThis as { __pardoes?: unknown }).__pardoes = { files, scriptLength: script.length };
}
