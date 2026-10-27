// .SPR sprite templates (docs/re/spr-format.md): FUN_00445e21 (load), FUN_004463c0 (line parser), FUN_00446ff3 (move keys).
// The original re-parses the file for every sprite instance; the parse result here is immutable and cached per file, the
// per-sprite state (current frame, repeat counter, FX phase ...) lives in the sprite's MoveRt objects (sprites.ts).

import { atoi } from '../../script/parse.ts';

export const END_REPEAT = 1, END_SFX = 0x10, END_COORD = 0x20;

export interface Bmp {
  name: string;
  /** Name of the script Bitmap (usually Type=POPUP) holding the picture. */
  dib: string;
  shift: [number, number];
  center: [number, number];
  sfx: string;
  volume: number;
  spawn: string;
}
export interface Frame { bmp: Bmp; pos: [number, number]; spawn: string }
/** Move `Special=COS..` (screen-space wave): per-scanline shear table and a pulsing strength. */
export interface Special { n: number; amp: number; min: number; max: number; cur0: number; inc0: number; step: number; table: number[] }
export interface Move {
  /** `Move=<key>`: the name used for lookups and AtEnd. */
  key: string;
  /** `Name=<family>`: only used for the COORD continuation family + count. */
  family: string;
  frames: Frame[];
  overlay: string;
  atEnd: string;
  speed: number;
  dir: [number, number];
  /** 0 = Extra=LEFT, 1 = RIGHT (default): which side is cropped at the screen edge. */
  lr: number;
  end: number;
  count: number;
  click: boolean;
  breakWait: boolean;
  level: number;
  special: Special | null;
}
export interface Trigger { name: string; area: [number, number, number, number]; mouseOver: number; posFixed: boolean }
export interface SprTemplate {
  file: string;
  timer: string;
  rect: number[] | null;
  offset: number[];
  before: boolean;
  bmps: Bmp[];
  moves: Move[];
  triggers: Trigger[];
}

/** FUN_00415dcf: upper-case, split on blanks; 50 blank-terminated tokens = the line is dropped (null). */
function tokenize(line: string): string[] | null {
  const toks: string[] = [];
  let cur = '';
  for (const ch of line) {
    if (ch === '\r' || ch === '\n') break;
    if (ch === ' ' || ch === '\t') {
      if (cur) { toks.push(cur); cur = ''; if (toks.length === 50) return null; }
    } else cur += ch.toUpperCase();
  }
  if (cur) toks.push(cur);
  return toks;
}

/** FUN_00415d25: key | value (the value restarts after every further '='). */
function kv(tok: string): [string, string] {
  const i = tok.indexOf('=');
  if (i < 0) return [tok, ''];
  const rest = tok.slice(i + 1);
  return [tok.slice(0, i), rest.slice(rest.lastIndexOf('=') + 1)];
}

const nums = (s: string): number[] => {
  const a = s.split(',').slice(0, 4).map(atoi);
  while (a.length < 4) a.push(0);
  return a;
};

/** FUN_00447724: first Bmp with that name, else the LAST one; null when the file has none. */
function findBmp(t: SprTemplate, name: string): Bmp | null {
  if (!t.bmps.length) return null;
  return t.bmps.find((b) => b.name === name) ?? t.bmps[t.bmps.length - 1];
}

const cdiv = (a: number, b: number) => Math.trunc(a / b);

function parseMove(t: SprTemplate, key: string, toks: string[]): Move {
  const m: Move = {
    key, family: '', frames: [], overlay: '', atEnd: '', speed: 0, dir: [0, 0], lr: 1, end: 0, count: 0, click: false, breakWait: false,
    level: -1, special: null,
  };
  let lastBmp = '';
  for (const tk of toks) {
    const [k, v] = kv(tk);
    switch (k) {
      case 'BMP': {
        lastBmp = v;
        const b = findBmp(t, v);
        if (b) m.frames.push({ bmp: b, pos: [0, 0], spawn: '' });
        break;
      }
      case 'POS': { const f = m.frames[m.frames.length - 1]; if (f) { const n = nums(v); f.pos = [n[0], n[1]]; } break; }
      case 'SPAWN': { const f = m.frames[m.frames.length - 1]; if (f) f.spawn = v; break; } // before any BMP: dead
      case 'OVERLAY': m.overlay = v; break;
      case 'NAME': m.family = v; break;
      case 'SPEED': m.speed = atoi(v); break;
      case 'DIRECTION': { const n = nums(v); m.dir = [n[0], n[1]]; break; }
      case 'END':
        if (v === 'SFX') m.end = END_SFX;
        else if (v === 'REPEAT') m.end = END_REPEAT;
        else if (v === 'COORD') m.end = END_COORD;
        else { m.end = END_REPEAT; m.count = 1; }
        break;
      case 'ATEND': m.atEnd = v; break;
      case 'LEVEL': m.level = atoi(v); break;
      case 'EXTRA':
        if (v === 'LEFT') m.lr = 0;
        else if (v === 'RIGHT') m.lr = 1;
        else if (v === 'CLICK') m.click = true;
        else if (v === 'BREAKWAIT') m.breakWait = true;
        else m.count = atoi(v);
        break;
      case 'SPECIAL': {
        const sp = (m.special ??= { n: 0, amp: 0, min: 0, max: 0, cur0: 0, inc0: 1, step: 1, table: [] });
        if (v.startsWith('COS')) { sp.n = atoi(v.slice(3)); sp.inc0 = 1; sp.step = 1; }
        else if (v.startsWith('X')) sp.amp = atoi(v.slice(1));
        else if (v.startsWith('MAX')) sp.max = atoi(v.slice(3));
        else if (v.startsWith('MIN')) { sp.min = atoi(v.slice(3)); sp.cur0 = sp.min; }
        else if (v.startsWith('INC')) sp.inc0 = atoi(v.slice(3));
        else if (v.startsWith('STEP')) sp.step = atoi(v.slice(4));
        break;
      }
    }
  }
  if (m.special && m.special.n <= 0) m.special = null; // only COSn switches the effect on
  if (m.special) {
    const sp = m.special;
    sp.table = Array.from({ length: Math.max(0, sp.n) }, (_, i) => Math.trunc(Math.sin((2 * Math.PI * i) / sp.n) * sp.amp + 0.5));
  }
  // Speed=N Direction=dx,dy: the last BMP becomes N frames whose POS add up to the direction (spr-format.md 1.5)
  if (m.speed !== 0 && lastBmp && m.frames.length) {
    const sp = m.speed;
    const [dx, dy] = m.dir;
    const px = cdiv(dx, sp), py = cdiv(dy, sp);
    let rx = dx % sp, ry = dy % sp;
    const sx = dx >= 0 ? 1 : -1, sy = dy >= 0 ? 1 : -1;
    const share = (): [number, number] => {
      let ax = px, ay = py;
      if (rx !== 0) { ax = px + sx; rx -= sx; }
      if (ry !== 0) { ay = py + sy; ry -= sy; }
      return [ax, ay];
    };
    m.frames[m.frames.length - 1].pos = share();
    for (let i = 1; i < sp; i++) {
      const b = findBmp(t, lastBmp);
      if (!b) break;
      m.frames.push({ bmp: b, pos: share(), spawn: '' });
    }
  }
  return m;
}

export function parseSpr(file: string, text: string): SprTemplate {
  const t: SprTemplate = { file, timer: '', rect: null, offset: [0, 0, 0, 0], before: false, bmps: [], moves: [], triggers: [] };
  for (const line of text.split('\n')) {
    const toks = tokenize(line);
    if (!toks || !toks.length) continue;
    const [key, val] = kv(toks[0]);
    switch (key) {
      case 'TIMER': t.timer = val; break;
      case 'RECT': t.rect = nums(val); t.offset = nums(val); break;
      case 'OFFSET': t.offset = nums(val); break;
      case 'COUNT': if (val === 'BEFORE') t.before = true; break;
      case 'BMP': {
        const b: Bmp = { name: val, dib: '', shift: [0, 0], center: [0, 0], sfx: '', volume: 0, spawn: '' };
        for (const tk of toks.slice(1)) {
          const [k, v] = kv(tk);
          if (k === 'DIB') b.dib = v;
          else if (k === 'SHIFT') { const n = nums(v); b.shift = [n[0], n[1]]; }
          else if (k === 'CENTER') { const n = nums(v); b.center = [n[0], n[1]]; }
          else if (k === 'SPAWN') b.spawn = v;
          else if (k === 'SFX') b.sfx = v;
          else if (k === 'VOLUME') b.volume = atoi(v);
        }
        t.bmps.push(b);
        break;
      }
      case 'TRIGGER': {
        const tr: Trigger = { name: val, area: [0, 0, 0, 0], mouseOver: 0, posFixed: false };
        for (const tk of toks.slice(1)) {
          const [k, v] = kv(tk);
          if (k === 'AREA') { const n = nums(v); tr.area = [n[0], n[1], n[2], n[3]]; }
          else if (k === 'MOUSEOVER') tr.mouseOver = atoi(v);
          else if (k === 'EXTRA' && v === 'POSFIXED') tr.posFixed = true;
        }
        t.triggers.push(tr);
        break;
      }
      case 'MOVE': t.moves.push(parseMove(t, val, toks.slice(1))); break;
    }
  }
  return t;
}

const cache = new Map<string, SprTemplate | null>();

/** Parsed template of a file in the archive (cached; null when the file does not exist). */
export function loadSpr(dat: { get(name: string): Uint8Array | null }, file: string): SprTemplate | null {
  const k = file.replace(/\\/g, '/').split('/').pop()!.toUpperCase();
  if (cache.has(k)) return cache.get(k)!;
  const b = dat.get(k);
  const t = b ? parseSpr(k, new TextDecoder('windows-1252').decode(b)) : null;
  cache.set(k, t);
  return t;
}
