// AVI movies (Indeo 5 video + 16-bit PCM audio) played while they stream in: a progressive RIFF reader feeds the
// IV50 decoder and Web Audio; video frames follow the audio clock. The game's movies are 640x480 at 12 fps with
// 22 kHz stereo audio, interleaved, so a download that keeps up with ~1 MB/s plays without stalls.

import { audio } from './audio.ts';
import { Indeo5Decoder } from './indeo5.ts';
import type { Surface } from './surface.ts';

interface AviInfo { width: number; height: number; fps: number; rate: number; channels: number; bits: number; frames: number }

/** Reads RIFF chunks from a byte stream without holding the whole file. */
class ChunkReader {
  private buf = new Uint8Array(0);
  private pos = 0;
  private done = false;
  private reader: ReadableStreamDefaultReader<Uint8Array>;
  constructor(stream: ReadableStream<Uint8Array>) {
    this.reader = stream.getReader();
  }
  /** Make at least n bytes available after pos; false at the end of the stream. */
  async need(n: number): Promise<boolean> {
    while (this.buf.length - this.pos < n) {
      if (this.done) return false;
      const { done, value } = await this.reader.read();
      if (done) { this.done = true; continue; }
      const rest = this.buf.subarray(this.pos);
      const nb = new Uint8Array(rest.length + value.length);
      nb.set(rest);
      nb.set(value, rest.length);
      this.buf = nb;
      this.pos = 0;
    }
    return true;
  }
  fourcc(o = 0) {
    const b = this.buf, p = this.pos + o;
    return String.fromCharCode(b[p], b[p + 1], b[p + 2], b[p + 3]);
  }
  u32(o = 0) {
    const b = this.buf, p = this.pos + o;
    return (b[p] | (b[p + 1] << 8) | (b[p + 2] << 16) | (b[p + 3] << 24)) >>> 0;
  }
  take(n: number): Uint8Array {
    const out = this.buf.slice(this.pos, this.pos + n);
    this.pos += n;
    return out;
  }
  skip(n: number) { this.pos += n; }
  view(n: number) { return new DataView(this.buf.buffer, this.buf.byteOffset + this.pos, n); }
  cancel() { void this.reader.cancel().catch(() => {}); }
}

export interface MoviePlayback {
  /** Resolves when the movie has ended (or was stopped). */
  done: Promise<void>;
  stop(): void;
  readonly playing: boolean;
}

/**
 * Play a movie into `target` at (x, y). `volume` is a DirectSound volume in hundredths of dB (0 = full).
 * `onFrame` is called after each new picture (to repaint).
 */
export function playMovie(stream: ReadableStream<Uint8Array>, target: Surface, x: number, y: number, opts: { volume?: number; onFrame?: () => void } = {}): MoviePlayback {
  const rd = new ChunkReader(stream);
  let stopped = false;
  let resolveDone!: () => void;
  const done = new Promise<void>((r) => (resolveDone = r));
  const sources: AudioBufferSourceNode[] = [];
  const gain = audio.ctx.createGain();
  gain.gain.value = Math.pow(10, Math.min(0, opts.volume ?? 0) / 2000);
  gain.connect(audio.master);

  const state: MoviePlayback = {
    done,
    get playing() { return !stopped; },
    stop() {
      if (stopped) return;
      stopped = true;
      rd.cancel();
      for (const s of sources) { try { s.stop(); } catch { /* not started */ } }
      gain.disconnect();
      resolveDone();
    },
  };

  void (async () => {
    try {
      const info = await readHeader(rd);
      if (!info) throw new Error('geen AVI');
      const dec = new Indeo5Decoder(info.width, info.height);
      const rgba = new Uint32Array(info.width * info.height);
      const frames: (Uint8Array | null)[] = []; // video chunks waiting for their time (null = unchanged)
      let shown = -1, decoded = -1, received = 0, ended = false;
      let audioAt = 0; // seconds of audio scheduled
      let t0 = -1;
      const BUFFER = 1.0; // seconds buffered before starting

      const show = (n: number) => {
        // decode every frame up to n (intra-only in practice, but keep the order for inter frames)
        while (decoded < n) {
          decoded++;
          const f = frames[decoded];
          frames[decoded] = null;
          if (f && f.length && dec.decode(f)) {
            dec.toRGBA(rgba);
            const w = Math.min(info.width, target.width - x), h = Math.min(info.height, target.height - y);
            for (let r = 0; r < h; r++) {
              const so = r * info.width, d = (y + r) * target.width + x;
              for (let c = 0; c < w; c++) target.px[d + c] = rgba[so + c] & 0xffffff;
            }
          }
        }
        shown = n;
        opts.onFrame?.();
      };
      const tick = () => {
        if (stopped) return;
        if (t0 >= 0) {
          const t = audio.ctx.currentTime - t0;
          const n = Math.min(received - 1, Math.floor(t * info.fps));
          if (n > shown) show(n);
          if (ended && shown >= received - 1 && t >= Math.max(audioAt, received / info.fps)) { state.stop(); return; }
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);

      const start = () => { if (t0 < 0) { t0 = audio.ctx.currentTime + 0.05; schedulePending(); } };
      const pending: AudioBuffer[] = [];
      const schedulePending = () => {
        for (const b of pending.splice(0)) {
          const s = audio.ctx.createBufferSource();
          s.buffer = b;
          s.connect(gain);
          const at = Math.max(t0 + audioAt, audio.ctx.currentTime);
          s.start(at);
          sources.push(s);
          s.onended = () => { const i = sources.indexOf(s); if (i >= 0) sources.splice(i, 1); };
          audioAt += b.duration;
        }
      };

      // movi chunks
      for (;;) {
        if (stopped) return;
        if (!(await rd.need(8))) break;
        const id = rd.fourcc(), size = rd.u32(4);
        rd.skip(8);
        if (id === 'LIST') { if (!(await rd.need(4))) break; rd.skip(4); continue; } // descend into 'movi'/'rec '
        if (!(await rd.need(size + (size & 1)))) break;
        if (/^\d\d(dc|db)$/.test(id)) {
          frames.push(size ? rd.take(size) : null);
          received++;
        } else if (/^\d\dwb$/.test(id) && size && info.bits === 16) {
          const v = rd.view(size);
          const n = Math.floor(size / (2 * info.channels));
          const ab = audio.ctx.createBuffer(info.channels, n, info.rate);
          for (let ch = 0; ch < info.channels; ch++) {
            const d = ab.getChannelData(ch);
            for (let i = 0; i < n; i++) d[i] = v.getInt16((i * info.channels + ch) * 2, true) / 32768;
          }
          rd.skip(size);
          pending.push(ab);
          if (t0 >= 0) schedulePending();
        } else rd.skip(size);
        if (size & 1) rd.skip(1);
        if (id === 'idx1') break;
        if (t0 < 0 && received / info.fps >= BUFFER) start();
        // don't run far ahead of the picture: a fast download would otherwise hold the whole movie in memory
        while (!stopped && t0 >= 0 && received / info.fps - (audio.ctx.currentTime - t0) > 8) await new Promise((r) => setTimeout(r, 200));
      }
      ended = true;
      start();
    } catch (e) {
      if (!stopped) console.warn('film', e);
      state.stop();
    }
  })();
  return state;
}

/** RIFF/AVI header up to the start of the 'movi' list. */
async function readHeader(rd: ChunkReader): Promise<AviInfo | null> {
  if (!(await rd.need(12)) || rd.fourcc() !== 'RIFF' || rd.fourcc(8) !== 'AVI ') return null;
  rd.skip(12);
  const info: AviInfo = { width: 0, height: 0, fps: 15, rate: 22050, channels: 1, bits: 16, frames: 0 };
  let streamType = '';
  for (;;) {
    if (!(await rd.need(12))) return null;
    const id = rd.fourcc(), size = rd.u32(4);
    if (id === 'LIST') {
      const kind = rd.fourcc(8);
      rd.skip(12);
      if (kind === 'movi') return info;
      continue; // hdrl / strl: walk into it
    }
    rd.skip(8);
    if (!(await rd.need(size + (size & 1)))) return null;
    const v = rd.view(size);
    if (id === 'avih') {
      const us = v.getUint32(0, true);
      if (us) info.fps = 1e6 / us;
      info.frames = v.getUint32(16, true);
    } else if (id === 'strh') {
      streamType = String.fromCharCode(v.getUint8(0), v.getUint8(1), v.getUint8(2), v.getUint8(3));
      if (streamType === 'vids') {
        const scale = v.getUint32(20, true), rate = v.getUint32(24, true);
        if (scale && rate) info.fps = rate / scale;
      }
    } else if (id === 'strf') {
      if (streamType === 'vids') { info.width = v.getInt32(4, true); info.height = Math.abs(v.getInt32(8, true)); }
      else if (streamType === 'auds') { info.channels = v.getUint16(2, true); info.rate = v.getUint32(4, true); info.bits = v.getUint16(14, true); }
    }
    rd.skip(size + (size & 1));
  }
}
