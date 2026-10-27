// The Bitmap statement and its instructions (docs/re/graphics.md A.4-A.10, C.10): STATIC/MOVEABLE objects in the node
// lists, POPUP images in the name table only (sprite frames, cursors, command images), KILL, BACKBUF snapshots, world
// darkness (Instruction OBJECT COLOR) and the puzzles living in bitmaps (jigsaw, word puzzle, sliding puzzle).

import { atoi, type Stmt } from '../script/parse.ts';
import { Surface } from '../engine/surface.ts';
import { Img, blitIndexed, blitKeyed, blitPart, parseRgb, COLFX_BRIGHTEN, COLFX_COMPLEMENT, COLFX_DARKEN, COLFX_PERCENT, COLFX_THROUGH } from './image.ts';
import { Gfx, BX_FULLSCREEN, BX_MOVEABLE, BX_NOCLEAR, DX_ALWAYSINWORLD, DX_BLIT, DX_KEEP, DX_NOTINWORLD, FX_PUZZLE, PUZZLE_LETTER, PUZZLE_SHIFT, PUZZLE_WORD, type Bm } from './gfx.ts';
import { NODE_BITMAP, NODE_SCREEN, rect, W, H, type Node } from './scene.ts';

const EXTRA_BITS: Record<string, number> = {
  NOCLEAR: 0x1, FULLSCREEN: 0x2, SAVEFORSCRIPT: 0x8, FITTOTARGET: 0x10, FORCEBACKBUF: 0x20, EXTERNAL: 0x80, FREESPACE: 0x100,
  TOSCREEN: 0x200, DRAWONLY: 0x400, PARTLY: 0x800, MOVEABLE: 0x1000, COLREDUCTION: 0x2000,
};
const DX_BITS: Record<string, number> = { DXKEEP: DX_KEEP, DXBLIT: DX_KEEP | DX_BLIT, NOTINWORLD: DX_NOTINWORLD, ALWAYSINWORLD: DX_ALWAYSINWORLD };
const COLFX: Record<string, number> = { DARKEN: COLFX_DARKEN, BRIGHTEN: COLFX_BRIGHTEN, PERCENT: COLFX_PERCENT, THROUGH: COLFX_THROUGH, COMPLEMENT: COLFX_COMPLEMENT };
const FX: Record<string, number> = { FOLD: 1, ROLL: 2, BLIND: 3, EXPLODE: 4, '3D': 5, SIZE: 6, SNOW: 7, PUZZLE: 8 };
const PUZZLE: Record<string, number> = { SHIFT: 1, SWITCH: 2, TETRIS: 3, MOVING: 4, WORD: 5 };

/** Parsed Bitmap statement (FUN_0040986d). */
interface BitmapDef {
  type: string; name: string; file: string; rectText: string; level: number; extra: number; dxf: number;
  maskIndex: number; keyText: string; colfx: number; colorize: string; fx: number; puzzle: number; size: [number, number]; ref: string;
}

function parseDef(st: Stmt): BitmapDef {
  if (st.cache) return st.cache as BitmapDef;
  let extra = 0, dxf = 0, level = st.has('LEVEL') ? atoi(st.get('LEVEL')) : 0;
  for (const e of st.all('EXTRA')) {
    if (e in EXTRA_BITS) extra |= EXTRA_BITS[e];
    else if (e in DX_BITS) dxf |= DX_BITS[e];
    else if (e === 'FOREGROUND') level = -1;
    else if (e.startsWith('LEVEL')) level = atoi(e.slice(5));
  }
  // later LEVEL= wins over EXTRA order only by token order: re-scan for the last of both kinds
  for (const [k, v] of st.kv) {
    if (k === 'LEVEL') level = atoi(v);
    else if (k === 'EXTRA' && v === 'FOREGROUND') level = -1;
    else if (k === 'EXTRA' && v.startsWith('LEVEL') && v !== 'LEVEL') level = atoi(v.slice(5));
  }
  const type = st.get('TYPE') || 'STATIC';
  if (type === 'MOVEABLE') extra |= BX_MOVEABLE;
  const size = st.get('SIZE').split(',').map((v) => parseInt(v, 10) || 0);
  const def: BitmapDef = {
    type, name: st.get('NAME'), file: st.get('FILE'), rectText: st.get('RECT'), level, extra, dxf,
    maskIndex: st.has('MASKINDEX') ? atoi(st.get('MASKINDEX')) : -1, keyText: st.get('MASKINDEXCOLOR'),
    colfx: st.has('COLFX') ? COLFX[st.get('COLFX')] ?? COLFX_DARKEN : 0, colorize: st.get('COLORIZE'),
    fx: FX[st.get('FX')] ?? 0, puzzle: st.has('PUZZLE') ? PUZZLE[st.get('PUZZLE')] ?? 1 : 0, size: [size[0] ?? 0, size[1] ?? 0], ref: st.get('REF'),
  };
  st.cache = def;
  return def;
}

export class Bitmaps {
  private g: Gfx;
  /** Jigsaw: puzzle base name and snap tolerance (DAT_006a7368 / DAT_006a739c). */
  private jigsaw = { base: '', tol: 0 };
  private shift: ShiftPuzzle | null = null;

  constructor(g: Gfx) {
    this.g = g;
    g.vm.on('BITMAP', (st) => this.exec(st));
    g.vm.instr.set('BITMAP', (st) => this.instr(st));
    g.vm.instr.set('OBJECT', (st) => {
      switch (st.get('VALUE')) {
        case 'DISABLE': g.objectDisabled = true; break;
        case 'ENABLE': g.objectDisabled = false; break;
        case 'COLOR': g.scene.setWorld(Math.max(0, -atoi(g.vm.vars.sub(st.get('CONTENTS'))))); break;
      }
    });
  }

  // ---------------------------------------------------------------- statement

  private exec(st: Stmt) {
    const d = parseDef(st);
    const name = d.name;
    switch (d.type) {
      case 'KILL': this.kill(this.g.vm.vars.sub(name)); return;
      case 'PUT': case 'RANDOMIZE': case 'SCREEN': return; // unused in PLAYER.SCR (SCREEN: authoring template only)
      case 'BACKBUF': this.backbuf(d); return;
    }
    // a statement that runs again replaces its previous object
    const old = this.g.bitmaps.get(name);
    if (old) this.remove(old, false);
    const b = this.create(d);
    if (!b) return;
    if (d.type === 'POPUP') return; // name table only
    if (d.puzzle === PUZZLE_WORD && d.fx === FX_PUZZLE) { this.wordCreate(b); return; }
    if (d.fx === FX_PUZZLE && d.puzzle === PUZZLE_SHIFT) this.shift = new ShiftPuzzle(b);
    this.show(b);
  }

  /** Load and place a bitmap object (FUN_0040b1df + FUN_0040bfc0 start). */
  private create(d: BitmapDef, fileOverride?: string, nameOverride?: string): Bm | null {
    const g = this.g;
    const file = fileOverride ?? (d.file.startsWith('$') ? g.vm.vars.expand(d.file) : d.file);
    const img = g.loadImg(file);
    if (!img) return null;
    let xywh: number[];
    if (d.rectText.startsWith('$')) xywh = Gfx.nums(g.vm.vars.get(d.rectText) ?? '');
    else xywh = Gfx.nums(d.rectText);
    const key = parseRgb(d.keyText);
    let maskIndex = d.maskIndex;
    if (maskIndex === -2) maskIndex = img.indexOf(key);
    const b: Bm = {
      name: nameOverride ?? d.name, type: d.type, file, img, rect: rect(xywh[0], xywh[1], xywh[0] + img.w, xywh[1] + img.h),
      home: [xywh[0], xywh[1], xywh[2], xywh[3]], level: d.level, extra: d.extra, dxf: d.dxf, maskIndex, key,
      colfx: d.colfx, colorize: atoi(d.colorize), fx: d.fx, puzzle: d.puzzle, size: d.size, ref: d.ref, node: null, live: true,
    };
    if ((d.type !== 'POPUP' && !(d.dxf & DX_NOTINWORLD)) || d.dxf & DX_ALWAYSINWORLD) img.darken(g.scene.world, maskIndex);
    g.bitmaps.set(b.name, b);
    return b;
  }

  /** Register in the node lists and queue its rect (STATIC/MOVEABLE). */
  private show(b: Bm, type = NODE_BITMAP) {
    const g = this.g;
    const isPuzzle = () => b.fx === FX_PUZZLE && b.puzzle === PUZZLE_SHIFT && this.shift?.bm === b;
    const node: Node = {
      type, name: b.name, level: b.level, dx: !!(b.dxf & DX_BLIT), rect: b.rect, notInWorld: !!(b.dxf & DX_NOTINWORLD), owner: b,
      drawBG: (dst, clip) => { if (b.img) blitIndexed(dst, b.img, b.rect.l, b.rect.t, b.maskIndex, clip, b.colfx, b.colorize); },
      drawDX: (dst) => {
        if (isPuzzle()) { this.shift!.draw(dst); return; }
        if (b.img) blitKeyed(dst, b.img, b.rect.l, b.rect.t, b.key, undefined, b.colfx, b.colorize);
      },
      darken: (pct) => b.img?.darken(pct, b.maskIndex),
    };
    if (!node.dx && isPuzzle()) node.drawBG = (dst, clip) => this.shift!.draw(dst, clip);
    b.node = node;
    g.scene.add(node);
    g.scene.invalidate(b.rect);
  }

  /** Bitmap Type=KILL (FUN_0040bab3). */
  kill(name: string) {
    const b = this.g.bitmaps.get(name);
    if (!b) return;
    if (b.puzzle === PUZZLE_WORD) for (const l of this.letters(b)) this.remove(l, true);
    if (this.shift?.bm === b) this.shift = null;
    this.remove(b, true);
  }

  private remove(b: Bm, repaint: boolean) {
    const g = this.g;
    if (b.node) g.scene.remove(b.node);
    if (repaint && b.node && !(b.extra & BX_NOCLEAR)) g.scene.invalidate(b.rect);
    b.node = null;
    b.live = false;
    if (g.bitmaps.get(b.name) === b) g.bitmaps.delete(b.name);
  }

  /** Type=BACKBUF (FUN_0045197c): freeze the current back buffer as a new screen level. */
  private backbuf(d: BitmapDef) {
    const g = this.g;
    const s = new Surface(W, H);
    s.px.set(g.scene.back.px);
    const img = new Img(s);
    const b: Bm = {
      name: d.name, type: 'BACKBUF', file: '', img, rect: rect(0, 0, W, H), home: [0, 0, 0, 0], level: 0, extra: d.extra, dxf: 0,
      maskIndex: -1, key: -1, colfx: 0, colorize: 0, fx: 0, puzzle: 0, size: [0, 0], ref: '', node: null, live: true,
    };
    g.bitmaps.set(b.name, b);
    this.show(b, NODE_SCREEN);
  }

  /** Move a bitmap by (dx, dy) (FUN_0040ad99): old and new rect are repainted. */
  moveBy(b: Bm, dx: number, dy: number) {
    if (!dx && !dy) return;
    this.g.scene.invalidate(b.rect);
    b.rect.l += dx; b.rect.r += dx; b.rect.t += dy; b.rect.b += dy;
    this.g.scene.invalidate(b.rect);
  }

  // ---------------------------------------------------------------- Instruction Type=BITMAP (FUN_0040edc9)

  private instr(st: Stmt) {
    const vars = this.g.vm.vars;
    const name = vars.sub(st.get('NAME')), target = vars.sub(st.get('TARGET')), contents = vars.sub(st.get('CONTENTS'));
    switch (st.get('VALUE')) {
      case 'CHANGE': {
        const b = this.g.bitmaps.get(name);
        if (!b) return;
        if (target === 'FX') b.fx = FX[contents] ?? 0;
        else if (target === 'LEVEL' && b.node) { this.g.scene.relevel(b.node, atoi(contents)); b.level = atoi(contents); this.g.scene.invalidate(b.rect); }
        return;
      }
      case 'RANDOMIZE': this.randomize(name, target, contents); return;
      case 'COLOR': { const b = this.g.bitmaps.get(name); if (b) { b.img?.darken(Math.max(0, atoi(contents)), b.maskIndex); this.g.scene.invalidate(b.rect); } return; }
      case 'HIDE': { const b = this.g.bitmaps.get(name); if (b) this.g.scene.invalidate(b.rect); return; }
    }
  }

  // ---------------------------------------------------------------- puzzles

  private letters(word: Bm): Bm[] {
    const out: Bm[] = [];
    for (let i = 0; ; i++) {
      const l = this.g.bitmaps.get(`${word.file}${i}`);
      if (!l || l.puzzle !== PUZZLE_LETTER) break;
      out.push(l);
    }
    return out;
  }

  /** PUZZLE=WORD (FUN_0040d252): one MOVEABLE child bitmap per letter of the REF word. */
  private wordCreate(b: Bm) {
    const g = this.g;
    const word = (b.ref.startsWith('$') ? g.vm.vars.get(b.ref) ?? '' : b.ref).toUpperCase();
    this.jigsaw.tol = b.size[1];
    b.ref = word;
    const n = word.length;
    for (let i = 0; i < n; i++) {
      const def: BitmapDef = {
        type: 'MOVEABLE', name: `${b.file}${i}`, file: '', rectText: '', level: b.level, extra: b.extra & ~BX_MOVEABLE, dxf: b.dxf,
        maskIndex: -1, keyText: '', colfx: b.colfx, colorize: '', fx: 0, puzzle: PUZZLE_LETTER, size: [0, 0], ref: word[i],
      };
      const l = this.create(def, `${b.file}${word[i]}.BMP`);
      if (!l) continue;
      l.maskIndex = b.maskIndex >= 0 ? l.img!.indexOf(b.key) : -1;
      l.key = b.key;
      const x = b.home[0] + Math.trunc((i * b.home[2]) / n), y = b.home[1];
      l.rect = rect(x, y, x + l.img!.w, y + l.img!.h);
      l.home = [x, y, l.img!.w, l.img!.h];
      this.show(l);
    }
  }

  /** Instruction BITMAP Value=Randomize (FUN_0040edc9 case 0x23 / FUN_0040be93). */
  private randomize(name: string, target: string, contents: string) {
    const [tx, ty, tw, th] = Gfx.nums(target);
    const rnd = (n: number) => (n > 0 ? 1 + Math.floor(Math.random() * n) : 0);
    const word = this.g.bitmaps.get(name);
    if (word && word.puzzle === PUZZLE_WORD) {
      for (const l of this.letters(word)) {
        const nx = tw ? tx + rnd(tw) : l.rect.l, ny = th ? ty + rnd(th) : l.rect.t;
        this.moveBy(l, nx - l.rect.l, ny - l.rect.t);
        l.home = [l.rect.l, l.rect.t, l.home[2], l.home[3]];
        l.extra |= BX_MOVEABLE;
      }
      return;
    }
    // jigsaw: pieces <base>01..
    this.jigsaw = { base: name, tol: atoi(contents) };
    const pieces = this.pieces(name);
    for (const p of pieces) {
      this.moveBy(p, p.home[0] - p.rect.l, p.home[1] - p.rect.t);
      this.moveBy(p, tx + rnd(tw) - p.rect.l, ty + rnd(th) - p.rect.t);
      p.extra |= BX_MOVEABLE;
    }
    for (let i = 0; i < 99 && pieces.length; i++) {
      const p = pieces[rnd(pieces.length) - 1];
      if (p.node) this.g.scene.toFront(p.node);
    }
    this.g.scene.invalidate(null);
  }

  private pieces(base: string): Bm[] {
    const out: Bm[] = [];
    for (let i = 1; i <= 99; i++) {
      const p = this.g.bitmaps.get(`${base}${String(i).padStart(2, '0')}`);
      if (!p) break;
      out.push(p);
    }
    return out;
  }

  /** Drop of a dragged MOVEABLE bitmap (FUN_0040e9e5). */
  drop(b: Bm) {
    const vm = this.g.vm;
    const tol = this.jigsaw.tol;
    if (b.puzzle === PUZZLE_LETTER) {
      const word = [...this.g.bitmaps.values()].find((w) => w.puzzle === PUZZLE_WORD && w.live && this.letters(w).includes(b));
      if (!word) return;
      const dx = b.home[0] - b.rect.l, dy = b.home[1] - b.rect.t;
      if (Math.abs(dy) > tol || b.rect.l < word.home[0] || word.home[0] + word.home[2] < b.rect.r) this.moveBy(b, dx, dy);
      else { this.moveBy(b, 0, dy); b.home = [b.rect.l, b.rect.t, b.home[2], b.home[3]]; }
      const ls = this.letters(word).sort((a, c) => a.rect.l - c.rect.l);
      if (ls.map((l) => l.ref).join('') === word.ref) {
        for (const l of ls) l.extra &= ~BX_MOVEABLE;
        vm.event(word.name, 'SOLVED');
      }
      return;
    }
    const base = this.jigsaw.base;
    const dx = b.home[0] - b.rect.l, dy = b.home[1] - b.rect.t;
    if (tol < Math.abs(dx) || tol <= Math.abs(dy)) vm.runNew(base, 'PIECENOK', '');
    else {
      b.extra &= ~BX_MOVEABLE;
      this.moveBy(b, dx, dy);
      if (b.node) this.g.scene.toBack(b.node);
      vm.runNew(base, 'PIECEOK', '');
    }
    const pieces = this.pieces(base);
    if (pieces.length && pieces.every((p) => !(p.extra & BX_MOVEABLE))) vm.runNew(base, 'SOLVED', '');
    vm.pump();
  }

  /** Left press on a sliding-puzzle bitmap (FUN_004565be): CLICK, then SOLVED when solved. */
  pressShift(b: Bm, x: number, y: number) {
    const p = this.shift;
    if (!p || p.bm !== b || p.solved) return;
    p.click(x, y);
    this.g.scene.invalidate(b.rect);
    this.g.vm.runNew(b.name, 'CLICK', '');
    if (p.solved) this.g.vm.runNew(b.name, 'SOLVED', '');
    this.g.vm.pump();
  }

  isShift(b: Bm) {
    return this.shift?.bm === b;
  }
}

/** PUZZLE=SHIFT (FUN_00456115 / FUN_004565be / FUN_0045717c): a cols x rows sliding puzzle with the hole bottom-right. */
class ShiftPuzzle {
  readonly bm: Bm;
  cols: number;
  rows: number;
  cell: number[];
  hole: [number, number];
  solved = false;
  constructor(bm: Bm) {
    this.bm = bm;
    this.cols = Math.max(1, bm.size[0]);
    this.rows = Math.max(1, bm.size[1]);
    this.cell = Array.from({ length: this.cols * this.rows }, (_, i) => i);
    this.hole = [this.cols - 1, this.rows - 1];
    this.cell[this.cell.length - 1] = -1;
    for (let i = 0; i < 1000; i++) this.slide(Math.floor(Math.random() * this.cols), Math.floor(Math.random() * this.rows));
  }
  private at(c: number, r: number) { return r * this.cols + c; }
  private slide(c: number, r: number) {
    const [hc, hr] = this.hole;
    if (c === hc && r !== hr) {
      const s = r < hr ? -1 : 1;
      for (let y = hr; y !== r; y += s) this.cell[this.at(c, y)] = this.cell[this.at(c, y + s)];
    } else if (r === hr && c !== hc) {
      const s = c < hc ? -1 : 1;
      for (let x = hc; x !== c; x += s) this.cell[this.at(x, r)] = this.cell[this.at(x + s, r)];
    } else return;
    this.cell[this.at(c, r)] = -1;
    this.hole = [c, r];
  }
  click(x: number, y: number) {
    const img = this.bm.img!;
    const tw = Math.floor(img.w / this.cols), th = Math.floor(img.h / this.rows);
    const c = Math.floor((x - this.bm.rect.l) / tw), r = Math.floor((y - this.bm.rect.t) / th);
    if (c < 0 || r < 0 || c >= this.cols || r >= this.rows) return;
    this.slide(c, r);
    if (this.cell.every((v, i) => v === -1 || v === i)) {
      this.cell[this.at(...this.hole)] = this.at(...this.hole);
      this.solved = true;
    }
  }
  draw(dst: Surface, clip?: import('./scene.ts').Rect) {
    const img = this.bm.img!;
    const tw = Math.floor(img.w / this.cols), th = Math.floor(img.h / this.rows);
    for (let r = 0; r < this.rows; r++) for (let c = 0; c < this.cols; c++) {
      const id = this.cell[this.at(c, r)];
      const x = this.bm.rect.l + c * tw, y = this.bm.rect.t + r * th;
      if (id < 0) { dst.fillRect(x, y, x + tw, y + th, 0); continue; }
      blitPart(dst, img, (id % this.cols) * tw, Math.floor(id / this.cols) * th, tw, th, x, y, -1, clip);
    }
  }
}

export { BX_FULLSCREEN };
