// The graphics context every object module works against: the scene (node lists + compositor), the script machine,
// the archive, sound, the bitmap name table and the input state. Modules register their statements on `vm` and their
// nodes in `scene`.

import type { DatArchive } from '../engine/dat.ts';
import type { Sound } from '../script/sound.ts';
import type { Vm } from '../script/vm.ts';
import { Img } from './image.ts';
import { Scene, type Node, type Rect } from './scene.ts';

/** A Bitmap object (docs/re/graphics.md A.4); also the frames sprites draw (POPUP bitmaps). */
export interface Bm {
  name: string;
  type: string; // STATIC, POPUP, MOVEABLE, BACKBUF, ...
  file: string;
  img: Img | null;
  /** Screen rect of the image. */
  rect: Rect;
  /** RECT as written: home position for puzzles (x, y, w, h). */
  home: [number, number, number, number];
  level: number;
  /** EXTRA flag bits (+0x78) and DX flags (+0x7c). */
  extra: number;
  dxf: number;
  /** Resolved palette index key (-1 = opaque in the BG path). */
  maskIndex: number;
  /** RGB colour key of the DX path (default white). */
  key: number;
  colfx: number;
  colorize: number;
  fx: number;
  puzzle: number;
  size: [number, number];
  ref: string;
  node: Node | null;
  live: boolean;
}

// EXTRA (+0x78) and DX (+0x7c) bits
export const BX_NOCLEAR = 0x1, BX_FULLSCREEN = 0x2, BX_MOVEABLE = 0x1000;
export const DX_KEEP = 1, DX_BLIT = 2, DX_NOTINWORLD = 4, DX_ALWAYSINWORLD = 8;
export const FX_SNOW = 7, FX_PUZZLE = 8;
export const PUZZLE_SHIFT = 1, PUZZLE_WORD = 5, PUZZLE_LETTER = 6;

/** Hooks other modules provide (sprites, DXSCREEN) for input and drawing. */
export interface SpriteHooks {
  /** Pixel/zone hit test of a sprite node at screen (x, y). */
  hit(node: Node, x: number, y: number): boolean;
  /** Left press on a sprite node (fires CLICK / trigger / ENTER, walks DIRECTIONAL stones). */
  press(node: Node, x: number, y: number): void;
  /** Cursor id for hovering this sprite (0 = leave NORMAL). */
  cursor(node: Node, x: number, y: number): number;
  /** Draw the held item (Sprite Type=MOUSE) centred on the mouse. */
  drawHeld(out: import('../engine/surface.ts').Surface, mx: number, my: number): void;
  /** A sprite clock ticked (timer name or 'DX'). */
  tick(clock: string): void;
}

export class Gfx {
  readonly scene = new Scene();
  readonly vm: Vm;
  readonly dat: DatArchive;
  readonly snd: Sound;
  /** Live bitmap objects by name (POPUP included). */
  readonly bitmaps = new Map<string, Bm>();
  mouseX = 280;
  mouseY = 400;
  /** Cursor: holding an item (Sprite Type=MOUSE). */
  holding = false;
  sprites: SpriteHooks | null = null;
  /** OBJECT DISABLE: only these names stay hittable (FUN_0041201f). */
  objectDisabled = false;
  private decoded = new Map<string, Img>();

  constructor(vm: Vm, dat: DatArchive, snd: Sound) {
    this.vm = vm;
    this.dat = dat;
    this.snd = snd;
  }

  /** Look a bitmap up by name; `$VAR` names are substituted (FUN_0040b705). */
  bitmap(name: string): Bm | null {
    return this.bitmaps.get(this.vm.vars.sub(name)) ?? null;
  }

  /** Decode a BMP from the archive: a fresh Img per object (each has its own darkness), the decode is cached. */
  loadImg(file: string): Img | null {
    const k = file.replace(/\\/g, '/').split('/').pop()!.toUpperCase();
    if (!k) return null;
    let base = this.decoded.get(k);
    if (!base) {
      const b = this.dat.get(k);
      if (!b) { console.warn('beeld ontbreekt:', file); return null; }
      try {
        base = Img.decode(b.slice().buffer);
      } catch (e) {
        console.warn('beeld kapot:', file, e);
        return null;
      }
      this.decoded.set(k, base);
    }
    return base.clone();
  }

  /** "x,y,w,h" text -> numbers (missing = 0). */
  static nums(s: string): number[] {
    const out = [0, 0, 0, 0];
    s.split(',').forEach((v, i) => { if (i < 4) out[i] = parseInt(v, 10) || 0; });
    return out;
  }
}
