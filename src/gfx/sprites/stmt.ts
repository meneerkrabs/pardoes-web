// The script `Sprite` statement (docs/re/graphics.md B.2.1, FUN_00447ba0). Like the original the parsed block is cached on the
// statement and the run-time prelude (random starts, $VAR rects) writes its results back into it.

import { atoi, type Stmt } from '../../script/parse.ts';
import { END_COORD, END_REPEAT, END_SFX } from './spr.ts';

// statement Type bits
export const T_STATIC = 0x01, T_MOVING = 0x02, T_KILL = 0x04, T_TRACKING = 0x08, T_MOVEABLE = 0x10, T_WAIT = 0x20, T_CHANGE = 0x40, T_SET = 0x100,
  T_HIDE = 0x200, T_SHOW = 0x400, T_MOUSE = 0x801;
// flags1
export const F1_NOCLEAR = 0x1, F1_LOOPING = 0x2, F1_DIRECTIONAL = 0x4, F1_REDUCTION = 0x8, F1_ALIGN = 0x10, F1_ACTIVE = 0x20, F1_COLIDE = 0x40,
  F1_BOUNDS = 0x80, F1_PARTIAL = 0x100, F1_COMMAND = 0x200, F1_CENTERTO = 0x400, F1_SFXMUSTREPEAT = 0x1000, F1_CANBEOFFSCREEN = 0x2000,
  F1_NOSPAWNKILL = 0x4000, F1_VOLADJ = 0x8000;
// flags2
export const F2_DX = 0x02, F2_NOTINWORLD = 0x04, F2_BEFORE = 0x10, F2_ALLRECT = 0x20;

const TYPES: Record<string, number> = {
  STATIC: T_STATIC, MOVING: T_MOVING, KILL: T_KILL, TRACKING: T_TRACKING, MOVEABLE: T_MOVEABLE, WAIT: T_WAIT, CHANGE: T_CHANGE, SET: T_SET,
  HIDE: T_HIDE, SHOW: T_SHOW, LOAD: 0x04, DRAG: 0x06, CURSOR: 0x07, MOUSE: T_MOUSE, TEMP: -1,
};
const F1: Record<string, number> = {
  NOCLEAR: 1, DIRECTIONAL: 4, REDUCTION: 8, LOOPING: 2, COLIDE: 0x40, BOUNDS: 0x80, PARTIAL: 0x100, COMMAND: 0x200, CENTERTO: 0x400, ALIGN: 0x10,
  COLREDUCTION: 0x800, SFXMUSTREPEAT: 0x1000, CANBEOFFSCREEN: 0x2000, VOLUMEADJUSTTOFX: 0x8000, NOSPAWNKILL: 0x4000,
};
const F2: Record<string, number> = { DXBLIT: 2, NOTINWORLD: 4, BEFORE: 0x10, ALLRECT: 0x20 };
const ALIGN: Record<string, number> = {
  LEFTTOP: 0x11, LEFTBOTTOM: 0x21, LEFTCENTER: 0x41, RIGHTTOP: 0x12, RIGHTBOTTOM: 0x22, RIGHTCENTER: 0x42, CENTERTOP: 0x14, CENTERBOTTOM: 0x24,
  CENTERCENTER: 0x44,
};

export type R4 = [number, number, number, number];

export interface SpriteStmt {
  st: Stmt | null;
  name: string;
  type: number;
  file: string;
  move: string;
  timer: string;
  relative: string;
  background: string;
  startRaw: string;
  start: R4;
  startSpec: boolean;
  startMouse: boolean;
  endRaw: string;
  end: R4;
  endType: number;
  endSpec: boolean;
  atEnd: string;
  affect: string;
  affectRaw: string;
  affectPos: R4;
  reductionRaw: string;
  reduction: R4;
  sfx: string;
  volume: number;
  level: number;
  mouseOver: number;
  align: number;
  f1: number;
  f2: number;
  count: number;
}

/** FUN_004166c9: up to four comma separated numbers, missing = 0. */
export function nums4(s: string): R4 {
  const a = s.split(',').slice(0, 4).map(atoi);
  while (a.length < 4) a.push(0);
  return a as R4;
}

export function parseSpriteStmt(st: Stmt): SpriteStmt {
  if (st.cache) return st.cache as SpriteStmt;
  const d: SpriteStmt = {
    st, name: '', type: T_STATIC, file: '', move: '', timer: '', relative: '', background: '', startRaw: '', start: [0, 0, 0, 0], startSpec: false,
    startMouse: false, endRaw: '', end: [0, 0, 0, 0], endType: END_REPEAT, endSpec: false, atEnd: '', affect: '', affectRaw: '', affectPos: [0, 0, 0, 0],
    reductionRaw: '', reduction: [0, 0, 0, 0], sfx: '', volume: 0, level: -2, mouseOver: 0, align: 0x11, f1: 0, f2: 0, count: 1,
  };
  for (const [k, v] of st.kv) {
    switch (k) {
      case 'NAME': d.name = v; break;
      case 'TYPE': d.type = TYPES[v] ?? T_STATIC; break;
      case 'FILE': d.file = v; break;
      case 'MOVE': d.move = v; break;
      case 'TIMER': d.timer = v; break;
      case 'RELATIVE': d.relative = v; break;
      case 'BACKGROUND': d.background = v; break;
      case 'REDUCTION': d.reductionRaw = v; if (!v.startsWith('$')) d.reduction = nums4(v); break;
      case 'AFFECT': d.affect = v; break;
      case 'AFFECTPOS': d.affectRaw = v; if (!v.startsWith('$')) d.affectPos = nums4(v); break;
      case 'START':
        if (v === 'MOUSE') d.startMouse = true;
        else {
          d.startRaw = v;
          if (!/^[$@#]/.test(v)) d.start = nums4(v);
        }
        d.startSpec = true;
        break;
      case 'END':
        if (v === 'SFX') d.endType = END_SFX;
        else if (v === 'REPEAT') d.endType = END_REPEAT;
        else {
          d.endRaw = v;
          if (!v.startsWith('$')) { d.end = nums4(v); d.endType = END_COORD; }
          if (v.length) d.endSpec = true;
        }
        break;
      case 'ATEND': d.atEnd = v; break;
      case 'SFX': d.sfx = v; break;
      case 'VOLUME': d.volume = atoi(v); break;
      case 'LEVEL': d.level = atoi(v); break;
      case 'MOUSEOVER': d.mouseOver = atoi(v); break;
      case 'ALIGN': d.align = ALIGN[v] ?? 0x21; break;
      case 'EXTRA':
        if (v in F1) d.f1 |= F1[v];
        else if (v in F2) d.f2 |= F2[v];
        else d.count = atoi(v);
        break;
      // SPEED / DIRECTION: parsed but never read by the original
    }
  }
  st.cache = d;
  return d;
}
