// Sound (docs/re/script-core.md s12): 100 named DirectSound slots holding whole WAVs from PARDOES.DAT. Volume and pan are
// DirectSound units (hundredths of a dB; 0 = full, -10000 = silent; out-of-range values are rejected). Playing a name
// that is already playing restarts it. The Wave statement streams the title music from MEDIA\PARDOES.WAV.

import { audio } from '../engine/audio.ts';
import type { DatArchive } from '../engine/dat.ts';
import type { GameFiles } from '../files.ts';
import { atoi, type Stmt } from './parse.ts';
import type { Result, Thread, Vm } from './vm.ts';

export const SFX_CANINTERRUPT = 1, SFX_PLAYONEATATIME = 2;

const gainOf = (v: number) => Math.pow(10, v / 2000);

class Slot {
  readonly name: string;
  file = '';
  flags = 0;
  buffer: Promise<AudioBuffer | null> = Promise.resolve(null);
  vol = 0;
  pan = 0;
  playing = false;
  private src: AudioBufferSourceNode | null = null;
  private gl: GainNode;
  private gr: GainNode;
  private out: GainNode;
  private playToken = 0;
  onEnd: (() => void) | null = null;

  constructor(name: string) {
    this.name = name;
    this.out = audio.ctx.createGain();
    this.out.connect(audio.master);
    const merger = audio.ctx.createChannelMerger(2);
    this.gl = audio.ctx.createGain();
    this.gr = audio.ctx.createGain();
    this.gl.connect(merger, 0, 0);
    this.gr.connect(merger, 0, 1);
    merger.connect(this.out);
  }

  /** SetVolume: out-of-range values are rejected by DirectSound (the volume stays). */
  applyVolume(v: number) {
    if (v > 0 || v < -10000) return;
    this.out.gain.value = gainOf(v);
  }
  applyPan(p: number) {
    if (p > 10000 || p < -10000) return;
    this.pan = p;
    this.gl.gain.value = gainOf(-Math.max(p, 0));
    this.gr.gain.value = gainOf(-Math.max(-p, 0));
  }

  play(loop: boolean, vol: number) {
    this.stopNode();
    this.vol = vol;
    this.playing = true;
    const token = ++this.playToken;
    void this.buffer.then((buf) => {
      if (token !== this.playToken || !this.playing) return;
      if (!buf) { this.ended(token); return; }
      const s = audio.ctx.createBufferSource();
      s.buffer = buf;
      s.loop = loop;
      if (buf.numberOfChannels > 1) {
        const split = audio.ctx.createChannelSplitter(2);
        s.connect(split);
        split.connect(this.gl, 0);
        split.connect(this.gr, 1);
      } else {
        s.connect(this.gl);
        s.connect(this.gr);
      }
      s.onended = () => this.ended(token);
      this.src = s;
      this.applyVolume(vol);
      s.start();
    });
  }
  private ended(token: number) {
    if (token !== this.playToken) return;
    this.src = null;
    this.playing = false;
    this.onEnd?.();
  }
  private stopNode() {
    const s = this.src;
    this.src = null;
    if (s) { s.onended = null; try { s.stop(); } catch { /* not started */ } }
  }
  stop() {
    this.playToken++;
    this.stopNode();
    if (this.playing) { this.playing = false; this.onEnd?.(); }
  }
}

export class Sound {
  private slots = new Map<string, Slot>();
  private decoded = new Map<string, Promise<AudioBuffer | null>>();
  private dat: DatArchive;
  private files: GameFiles;
  /** Called when any sound stops (resumes a thread in Sfx WAIT). */
  onAnyEnd: (() => void) | null = null;

  constructor(files: GameFiles) {
    this.files = files;
    this.dat = files.dat;
  }

  /** Decoded WAV from the DAT (cached; null if missing). */
  private decode(file: string): Promise<AudioBuffer | null> {
    const k = file.toUpperCase();
    let p = this.decoded.get(k);
    if (!p) {
      const b = this.dat.get(k, 'WAV');
      if (!b) console.warn('geluid ontbreekt:', file);
      p = b ? audio.decode(b.slice().buffer).catch((e) => { if (b.length > 64) console.warn('geluid', k, e); return null; }) : Promise.resolve(null); // LEEG.WAV has no samples
      this.decoded.set(k, p);
    }
    return p;
  }

  /** `?NNxxxx` -> xxxx + rand(1..NN) as two digits + .wav (s12.2). */
  static resolveFile(f: string): string {
    const m = /^\?(\d\d)(.*)$/.exec(f);
    if (!m) return f;
    const n = Math.max(1, parseInt(m[1], 10));
    return `${m[2]}${String(1 + Math.floor(Math.random() * n)).padStart(2, '0')}.WAV`;
  }

  slot(name: string): Slot | undefined {
    return this.slots.get(name);
  }

  load(name: string, file: string, flags = 0) {
    if (!name) return;
    let s = this.slots.get(name);
    if (s && s.file === file) { s.flags = flags; return; }
    if (!s) {
      if (this.slots.size >= 100) return;
      s = new Slot(name);
      s.onEnd = () => this.onAnyEnd?.();
      this.slots.set(name, s);
    } else s.stop();
    s.file = file;
    s.flags = flags;
    s.buffer = this.decode(file);
  }
  unload(name: string) {
    const s = this.slots.get(name);
    if (!s) return;
    s.stop();
    this.slots.delete(name);
  }
  play(name: string, vol: number, loop: boolean) {
    this.slots.get(name)?.play(loop, vol);
  }
  stop(name: string) {
    this.slots.get(name)?.stop();
  }
  isPlaying(name: string) {
    return !!this.slots.get(name)?.playing;
  }
  /** Instruction SFX VOLUME: slot by name, or else by file name (FUN_00424fce). */
  setVolume(name: string, v: number) {
    const s = this.slots.get(name) ?? [...this.slots.values()].find((x) => x.file === name);
    if (!s) return;
    s.vol = v;
    s.applyVolume(v);
  }
  /** MODVOLUME: the stored value keeps accumulating even when DirectSound rejects the result. */
  modVolume(name: string, dv: number) {
    const s = this.slots.get(name);
    if (!s) return;
    s.vol += dv;
    s.applyVolume(s.vol);
  }
  setPan(name: string, p: number) {
    this.slots.get(name)?.applyPan(p);
  }
  stopAll() {
    for (const s of this.slots.values()) s.stop();
    this.wave?.stop();
  }

  // ---- Wave: the title music (MEDIA\PARDOES.WAV), looped
  private wave: { stop(): void; name: string } | null = null;
  async playWave(name: string, file: string, loop: boolean, vol: number) {
    this.wave?.stop();
    const base = file.replace(/\\/g, '/').split('/').pop()!.toUpperCase();
    const m = await this.files.media(base);
    if (!m) { console.warn('muziek ontbreekt:', file); return; }
    let stopped = false;
    const g = audio.ctx.createGain();
    g.gain.value = gainOf(Math.min(0, vol));
    g.connect(audio.master);
    let src: AudioBufferSourceNode | null = null;
    this.wave = { name, stop: () => { stopped = true; try { src?.stop(); } catch { /* */ } g.disconnect(); } };
    const buf = await new Response(m.stream()).arrayBuffer();
    if (stopped) return;
    const ab = await audio.decode(buf);
    if (stopped) return;
    src = audio.ctx.createBufferSource();
    src.buffer = ab;
    src.loop = loop;
    src.connect(g);
    src.start();
  }
  killWave(name: string) {
    if (this.wave && (!name || this.wave.name === name)) { this.wave.stop(); this.wave = null; }
  }
}

/** Register Sfx / Wave / Instruction SFX on the machine. */
export function installSound(vm: Vm, snd: Sound) {
  snd.onAnyEnd = () => { if (vm.soundWaitThread >= 0) { vm.resume(vm.soundWaitThread); vm.pump(); } };

  vm.on('SFX', (st: Stmt) => {
    const name = vm.vars.sub(st.get('NAME'));
    const type = st.get('TYPE');
    let flags = 0;
    for (const e of st.all('EXTRA')) flags |= e === 'CANINTERRUPT' ? SFX_CANINTERRUPT : e === 'PLAYONEATATIME' ? SFX_PLAYONEATATIME : 0;
    switch (type) {
      case 'LOAD': snd.load(name, Sound.resolveFile(vm.vars.expand(st.get('FILE'))), flags); break;
      case 'UNLOAD': snd.unload(name); break;
      case 'PLAY': snd.play(name, atoi(st.get('VOLUME')), st.get('ATEND') === 'REPEAT'); break;
      default: snd.stop(name); // KILL (also the default)
    }
  });

  vm.instr.set('SFX', (st: Stmt, t: Thread): Result => {
    const name = vm.vars.sub(st.get('NAME'));
    const n = atoi(vm.vars.sub(st.get('CONTENTS')));
    switch (st.get('VALUE')) {
      case 'PLAY': snd.play(name, n, false); break;
      case 'KILL': snd.stop(name); break;
      case 'WAIT':
        if (snd.isPlaying(name)) { vm.soundWaitThread = t.id; return 'retry'; }
        if (vm.soundWaitThread === t.id) vm.soundWaitThread = -1;
        break;
      case 'VOLUME': snd.setVolume(name, n); break;
      case 'MODVOLUME': snd.modVolume(name, n); break;
    }
    return 'cont';
  });

  vm.on('WAVE', (st: Stmt) => {
    const name = st.get('NAME');
    if (st.get('TYPE') === 'PLAY') void snd.playWave(name, st.get('FILE'), st.get('ATEND') === 'REPEAT', atoi(st.get('VOLUME')));
    else if (st.get('TYPE') === 'KILL' || !st.get('TYPE')) snd.killWave(name);
  });
}
