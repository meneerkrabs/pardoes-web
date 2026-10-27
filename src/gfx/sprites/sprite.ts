// An active sprite (docs/re/graphics.md B.6.1, struct S, 0x344 bytes in the original). The template (Bmp/Move/Trigger lists) is shared
// and immutable; the state the original keeps inside the template's Move structs (current frame, FX phase, BREAKWAIT latch, Special
// phase) lives in one MoveRt per move.

import type { Node, Rect } from '../scene.ts';
import { END_REPEAT, type Frame, type Move, type SprTemplate, type Trigger } from './spr.ts';
import { F1_ALIGN, T_MOVING, T_STATIC, type R4 } from './stmt.ts';

export interface MoveRt {
  m: Move;
  /** Index of the current frame (M.curFrame). */
  cur: number;
  /** Frame shown before the last FX hold (M.prevFrame), -1 = none. */
  prev: number;
  fxPhase: number;
  /** BREAKWAIT latch (move flag 4). */
  breakFired: boolean;
  spIdx: number;
  spCur: number;
  spInc: number;
}

export class Sprite {
  name = '';
  type = T_STATIC;
  f1 = 0;
  f2 = 0;
  level = -1;
  align = 0x11;
  visible = true;
  enabled = true;
  active = true;
  /** x, y = top-left (frame Shift not included), w, h = size of the current frame. */
  x = 0;
  y = 0;
  w = 0;
  h = 0;
  pendX = 0;
  pendY = 0;
  savedStart: R4 = [0, 0, 0, 0];
  endRect: R4 = [0, 0, 0, 0];
  /** AffectPos x, y, w, h: hit rect offset of DIRECTIONAL / COLIDE sprites. */
  affectRect: R4 = [0, 0, 0, 0];
  /** SPR Rect/Offset (ox, oy, ow, oh), or the BOUNDS clamp rect x1, y1, x2, y2. */
  offset: R4 = [0, 0, 0, 0];
  bounds = false;
  timer = '';
  defaultTimer = '';
  file = '';
  tpl!: SprTemplate;
  moves: MoveRt[] = [];
  byKey = new Map<string, MoveRt>();
  cur!: MoveRt;
  endType = END_REPEAT;
  count = 1;
  done = false;
  lastFlag = false;
  skipSpawnOnce = false;
  waiting = false;
  thread = -1;
  waitThread = -1;
  sfx = '';
  sfxVolume = 0;
  affect = '';
  stmtAtEnd = '';
  background = '';
  cursor = 0;
  /** World darkness percent of this sprite. */
  color = 0;
  reduction: R4 = [0, 0, 0, 0];
  /** Current REDUCTION scale in percent (0 = unscaled). */
  pct = 0;
  parent: Sprite | null = null;
  isChild = false;
  hasOverlay = false;
  hasSpawn = false;
  curTrigger: Trigger | null = null;
  node: Node | null = null;
  slot = -1;

  get right() { return this.x + this.w; }
  get bottom() { return this.y + this.h; }
  get frame(): Frame | undefined { return this.cur.m.frames[this.cur.cur]; }
  get moving() { return (this.type & T_MOVING) !== 0; }
  get aligned() { return (this.f1 & F1_ALIGN) !== 0; }

  /** Rectangle used for hit tests: the frame rect at the sprite position, or position + AffectPos for DIRECTIONAL/COLIDE sprites. */
  hitRect(): Rect {
    if (this.f1 & 0x44) { // DIRECTIONAL | COLIDE
      const l = this.x + this.affectRect[0], t = this.y + this.affectRect[1];
      return { l, t, r: l + this.affectRect[2], b: t + this.affectRect[3] };
    }
    return { l: this.x, t: this.y, r: this.x + this.w, b: this.y + this.h };
  }
}
