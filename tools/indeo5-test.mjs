// Test harness for indeo5.ts: decodes AVI files and compares the YUV planes
// byte-for-byte with `ffmpeg -f rawvideo -pix_fmt yuv410p` output.
//
// Usage (node >= 22.18 / 23.6, TypeScript type stripping enabled):
//   node test.mjs                      # default set (INTROB, GAMEOVER, ENDPRE, INTROA first 300 frames)
//   node test.mjs FILE.AVI [maxFrames] # one file
// Test files are copyrighted game data and are never copied anywhere.

import fs from 'node:fs';
import { spawn, execFileSync } from 'node:child_process';
import { Indeo5Decoder } from '../src/engine/indeo5.ts';

const MEDIA = process.env.PARDOES_MEDIA ?? new URL('../public/data/pardoes/MEDIA', import.meta.url).pathname;

/** Minimal AVI demuxer: yields video chunks ('00dc'/'00db') in file order. */
function* aviVideoChunks(path, maxFrames = Infinity) {
  const fd = fs.openSync(path, 'r');
  try {
    const hdr = Buffer.alloc(12);
    fs.readSync(fd, hdr, 0, 12, 0);
    if (hdr.toString('latin1', 0, 4) !== 'RIFF' || hdr.toString('latin1', 8, 12) !== 'AVI ') throw new Error('not an AVI');
    const fileSize = fs.fstatSync(fd).size;
    const ch = Buffer.alloc(12);
    let count = 0;
    // walk a list of chunks in [pos, end)
    function* walk(pos, end) {
      while (pos + 8 <= end) {
        fs.readSync(fd, ch, 0, 12, pos);
        const id = ch.toString('latin1', 0, 4);
        const size = ch.readUInt32LE(4);
        if (id === 'LIST') {
          const type = ch.toString('latin1', 8, 12);
          if (type === 'movi' || type === 'rec ') yield* walk(pos + 12, Math.min(pos + 8 + size, end));
          // other lists (hdrl, INFO) are skipped
        } else if (/^00(d[cb]|iv)$/.test(id)) {
          const data = Buffer.alloc(size);
          fs.readSync(fd, data, 0, size, pos + 8);
          yield new Uint8Array(data.buffer, data.byteOffset, size);
        }
        pos += 8 + size + (size & 1);
      }
    }
    for (const c of walk(12, fileSize)) {
      yield c;
      if (++count >= maxFrames) return;
    }
  } finally {
    fs.closeSync(fd);
  }
}

/** Async generator yielding exact-size frames from ffmpeg's rawvideo stdout. */
async function* ffmpegFrames(path, frameSize, maxFrames) {
  const args = ['-v', 'error', '-i', path, '-f', 'rawvideo', '-pix_fmt', 'yuv410p', '-fps_mode', 'passthrough'];
  if (Number.isFinite(maxFrames)) args.push('-frames:v', String(maxFrames));
  args.push('-');
  const p = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'inherit'] });
  let buf = Buffer.alloc(0);
  for await (const chunk of p.stdout) {
    buf = buf.length ? Buffer.concat([buf, chunk]) : chunk;
    while (buf.length >= frameSize) {
      yield buf.subarray(0, frameSize);
      buf = buf.subarray(frameSize);
    }
  }
  if (buf.length) console.log(`  warning: ${buf.length} trailing bytes from ffmpeg`);
}

function compare(dec, ref) {
  // ref layout: Y (w*h), U, V; decoder planes may have padding stride
  const w = dec.width, h = dec.height, cw = dec.chromaWidth, ch = dec.chromaHeight;
  let diff = 0;
  let o = 0;
  for (let y = 0; y < h; y++, o += w)
    for (let x = 0; x < w; x++) if (dec.y[y * dec.strideY + x] !== ref[o + x]) diff++;
  for (const plane of [dec.u, dec.v]) {
    for (let y = 0; y < ch; y++, o += cw)
      for (let x = 0; x < cw; x++) if (plane[y * dec.strideC + x] !== ref[o + x]) diff++;
  }
  return diff;
}

async function testFile(name, maxFrames = Infinity) {
  const path = name.includes('/') ? name : `${MEDIA}/${name}`;
  const [vw, vh] = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries',
    'stream=width,height', '-of', 'csv=p=0:s=x', path]).toString().trim().split('x').map(Number);
  const dec = new Indeo5Decoder(vw, vh);
  const cw = (vw + 3) >> 2, chh = (vh + 3) >> 2;
  const frameSize = vw * vh + 2 * cw * chh;
  const refIter = ffmpegFrames(path, frameSize, maxFrames)[Symbol.asyncIterator]();
  let chunks = 0, shown = 0, nullFrames = 0, errors = 0, diffBytes = 0, badFrames = 0, ffmpegExtra = 0;
  let decodeMs = 0;
  const types = {};
  for (const chunk of aviVideoChunks(path, maxFrames)) {
    chunks++;
    const t0 = process.hrtime.bigint();
    const ok = dec.decode(chunk);
    decodeMs += Number(process.hrtime.bigint() - t0) / 1e6;
    types[dec.frameType] = (types[dec.frameType] ?? 0) + 1;
    if (!ok) {
      if (dec.lastError) { errors++; if (errors <= 3) console.log(`  chunk ${chunks - 1}: error: ${dec.lastError}`); }
      else nullFrames++;
      continue;
    }
    const r = await refIter.next();
    if (r.done) { ffmpegExtra++; continue; }
    shown++;
    const d = compare(dec, r.value);
    if (d) { badFrames++; diffBytes += d; if (badFrames <= 3) console.log(`  frame ${shown - 1} (chunk ${chunks - 1}): ${d} differing bytes`); }
  }
  let missing = 0;
  for (;;) { const r = await refIter.next(); if (r.done) break; missing++; }
  const fps = (shown / decodeMs) * 1000;
  console.log(`${name}: chunks=${chunks} shown=${shown} null/empty=${nullFrames} errors=${errors} ` +
    `frameTypes=${JSON.stringify(types)} diffFrames=${badFrames} diffBytes=${diffBytes} ` +
    `ffmpegFramesNotProduced=${missing} extraOurFrames=${ffmpegExtra} ` +
    `decode=${decodeMs.toFixed(0)}ms (${fps.toFixed(0)} fps)`);
  return diffBytes === 0 && missing === 0 && ffmpegExtra === 0 && errors === 0;
}

const args = process.argv.slice(2);
let ok = true;
if (args.length) {
  ok = await testFile(args[0], args[1] ? Number(args[1]) : Infinity);
} else {
  for (const [f, n] of [['INTROB.AVI'], ['GAMEOVER.AVI'], ['ENDPRE.AVI'], ['INTROA.AVI', 300]])
    ok = (await testFile(f, n)) && ok;
}
console.log(ok ? 'ALL OK: 0 differing bytes' : 'FAILED');
process.exit(ok ? 0 : 1);
