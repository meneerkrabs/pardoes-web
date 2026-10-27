// The DXSCREEN "Tuffer" driving game (scene OLDTIMER2, docs/re/graphics.md Part D2): a side-scrolling world of 64 x 8 tiles
// (5120 x 480 px) shown through a 640 x 480 window. The car stays at screen x = 346, the world scrolls past it. While the
// game runs the scene's normal compositor is bypassed (`scene.presentHook`, `scene.dirtyOff`): the scroller draws the whole
// frame itself (ground tiles, objects behind the car, car and colliders, objects in front, HUD) and the cursor goes on top.
//
// The world advances once per presented frame of the original (60 Hz, no delta time). Here the world step runs on a fixed
// 60 Hz clock (accumulated real time, catching up when the browser is slow) and the latest state is rendered per browser
// frame. Function addresses refer to Pardoes.c: FUN_004584e0 statement, FUN_004592d6 reset, FUN_00459ee6 UPDATE load,
// FUN_0045a9e5 per-frame, FUN_0045a78c car move, FUN_0045a350 collision, FUN_0045b498 collider, FUN_0045c960 Instruction DX.

import { atoi, type Stmt } from '../script/parse.ts';
import { Surface } from '../engine/surface.ts';
import type { Bm, Gfx } from './gfx.ts';
import { blitKeyed, type Img } from './image.ts';
import type { Sprite, Sprites } from './sprites.ts';

const STEP_MS = 1000 / 60;
const MAX_CATCHUP_MS = 400;

interface Rc { x1: number; y1: number; x2: number; y2: number }
const touch = (a: Rc, b: Rc) => !(a.x2 < b.x1 || b.x2 < a.x1 || a.y2 < b.y1 || b.y2 < a.y1); // FUN_004134d4: inclusive edges

/** A bitmap placed in the world (OVERLAYB/F/OBSTACLE map line): world rect = POS + bitmap size. */
interface Obj extends Rc { bm: Bm }

interface Collider {
  spr: Sprite;
  /** 1 = NEW (Egel), 2 = BOUNCE (Rattar) */
  flags: number;
  dx: number; dy: number; dx0: number; dy0: number;
  started: boolean;
}

/** The statement's parameters (the original's world object DAT_0137df00, D2.3.1). */
interface Cfg {
  name: string;
  tile: [number, number];
  screen: [number, number];
  map: [number, number];
  borderY1: number; borderY2: number;
  start: boolean;
  files: { ground: string; front: string; behind: string; obstacle: string; collider: string };
  sprite: string;
  hud: { time: string; gauge: string; pos: string; dir: string };
}

export class DxScreen {
  private g: Gfx;
  private cfg: Cfg | null = null;

  // ---- world state (reset by the statement)
  scrollX = 0;
  scrollY = 0;
  vx = 0;
  vy = 0;
  finished = false;
  /** Section of item DXTUFFER to fire on the next frame (Instruction DX UPDATE Contents=...). */
  event = '';
  private ground: Int16Array = new Int16Array(0);
  private tiles: (Bm | null)[] = [];
  private behind: Obj[] = [];
  private front: Obj[] = [];
  private obstacles: Obj[] = [];
  private colliders: Collider[] = [];
  private hud: { time: Bm | null; gauge: Bm | null; pos: Bm | null; dir: Bm | null } = { time: null, gauge: null, pos: null, dir: null };
  private needleX = 0;

  // ---- presentation
  /** The scroller owns the present step (Instruction DX UPDATE .. KILL). */
  active = false;
  private buf = new Surface(640, 480);
  private cmds: (() => void)[] = [];
  private drawn = false;
  private acc = 0;
  private last = 0;
  /** Count of world steps run (tests / debugging). */
  steps = 0;
  private events: [string, string][] = [];

  constructor(g: Gfx) {
    this.g = g;
    g.vm.on('DXSCREEN', (st) => this.statement(st));
    g.vm.instr.set('DX', (st) => this.instr(st));
  }

  // ---------------------------------------------------------------- statement (FUN_004584e0 + FUN_004592d6)

  private statement(st: Stmt) {
    const n2 = (k: string, d: [number, number]): [number, number] => { const v = st.nums(k); return st.has(k) ? [v[0] ?? 0, v[1] ?? 0] : d; };
    const b = st.nums('BORDERS');
    const type = st.get('TYPE');
    if (type === 'KILL' || type === 'REALIZE') return; // only GLOBAL does anything
    this.cfg = {
      name: st.get('NAME'),
      tile: n2('BMPSIZE', [0, 0]), screen: n2('SCREENSIZE', [0, 0]), map: n2('MAPSIZE', [0, 0]),
      borderY1: st.has('BORDERS') ? b[1] ?? 0 : 0, borderY2: st.has('BORDERS') ? b[3] ?? 0 : 480,
      start: st.has('START'),
      files: { ground: st.get('GROUNDMAP'), front: st.get('OVERLAYFMAP'), behind: st.get('OVERLAYBMAP'), obstacle: st.get('OBSTACLEMAP'), collider: st.get('COLIDERMAP') },
      sprite: st.get('SPRITE'),
      hud: { time: st.get('BMPTIME'), gauge: st.get('BMPGAUGE'), pos: st.get('BMPPOS'), dir: st.get('BMPDIR') },
    };
    // FUN_004592d6: reset
    this.finished = false;
    this.event = '';
    this.vx = 0;
    this.vy = 0;
    this.behind = []; this.front = []; this.obstacles = []; this.colliders = [];
    this.tiles = [];
    this.ground = new Int16Array(0);
    const c = this.cfg;
    this.scrollX = c.start ? c.map[0] * c.tile[0] - c.screen[0] * c.tile[0] : 0;
    this.scrollY = c.start ? c.map[1] * c.tile[1] - c.screen[1] * c.tile[1] : 0;
  }

  // ---------------------------------------------------------------- Instruction Type=DX (FUN_0045c960)

  private instr(st: Stmt) {
    const contents = this.g.vm.vars.sub(st.get('CONTENTS'));
    switch (st.get('VALUE')) {
      case 'UPDATE':
        if (contents === '') this.start();
        else this.event = contents;
        break;
      case 'KILL': this.kill(); break;
      case 'SPEED':
        this.vx += atoi(contents);
        if (this.vx > 3) this.vx = 3;
        this.vy = 0;
        break;
      case 'TEST': this.vy = this.vy === 0 ? atoi(contents) : 0; break;
      case 'COUNT': this.count(atoi(contents)); break;
      // DISABLE / ENABLE / SIZE / SWITCH / WAIT: general display functions, not used for DXTUFFER
    }
  }

  /** Needle of the time gauge (FUN_0045cc1b): x = rawX - (rawW - rawW * pct / 100), C integer division. */
  private count(pct: number) {
    const b = this.hud.gauge;
    if (!b) return;
    this.needleX = b.home[0] - (b.home[2] - Math.trunc((b.home[2] * pct) / 100));
  }

  /** UPDATE without Contents (FUN_00459ee6): load maps / lists / HUD bitmaps; the scroller takes over the present step. */
  private start() {
    const c = this.cfg;
    if (!c) return;
    const g = this.g;
    this.finished = false;
    // tile table: Bitmap lines with DXREF=n and EXTRA=DXKEEP (FUN_0045948c)
    this.tiles = [];
    for (const [ref, name] of this.dxRefs()) {
      const bm = g.bitmaps.get(name);
      if (bm && (bm.dxf & 1) && ref >= 0) this.tiles[ref > 109 ? 0 : ref] = bm;
    }
    this.ground = this.loadGround(c.files.ground, c.map[0] * c.map[1]);
    this.behind = this.loadObjects(c.files.behind);
    this.front = this.loadObjects(c.files.front);
    this.obstacles = this.loadObjects(c.files.obstacle);
    this.colliders = this.loadColliders(c.files.collider);
    const h = (n: string) => (n ? g.bitmap(n) : null);
    this.hud = { time: h(c.hud.time), gauge: h(c.hud.gauge), pos: h(c.hud.pos), dir: h(c.hud.dir) };
    this.needleX = this.hud.gauge ? this.hud.gauge.home[0] : 0;
    // present step: the scroller draws, the dirty-rect system is off (FUN_00450c78)
    this.active = true;
    g.scene.dirtyOff = true;
    g.scene.presentHook = (out) => this.present(out);
    this.acc = STEP_MS; // the first presented frame already runs one step
    this.last = performance.now();
    this.drawn = false;
    this.cmds = [];
    this.buf.px.fill(0);
    requestAnimationFrame(() => this.drive());
  }

  /** DXREF=n of the script's Bitmap statements (the Bm object does not keep it). */
  private dxRefCache: [number, string][] | null = null;
  private dxRefs(): [number, string][] {
    if (this.dxRefCache) return this.dxRefCache;
    const out: [number, string][] = [];
    for (const it of this.g.vm.prog.items) for (const sec of it.sections) for (const sq of sec.seqs) for (const st of sq.stmts) {
      if (st.kw === 'BITMAP' && st.has('DXREF')) out.push([atoi(st.get('DXREF')), st.get('NAME')]);
    }
    return (this.dxRefCache = out);
  }

  /** Instruction DX KILL: the normal compositor again, the lists freed (FUN_0045914c). */
  private kill() {
    const sc = this.g.scene;
    const wasActive = this.active;
    this.active = false;
    this.behind = []; this.front = []; this.obstacles = []; this.colliders = [];
    this.cmds = [];
    this.events = [];
    if (wasActive) {
      sc.presentHook = null;
      sc.dirtyOff = false;
      sc.invalidate(null); // the next scene composes over a clean full repaint (the original leaves the old work surface)
    }
  }

  // ---------------------------------------------------------------- data files

  private text(name: string): string {
    return name ? this.g.dat.text(name) : '';
  }

  private loadGround(file: string, n: number): Int16Array {
    const out = new Int16Array(n).fill(-1);
    const nums = this.text(file).split(/\s+/).filter((s) => s !== '');
    for (let i = 0; i < n && i < nums.length; i++) out[i] = parseInt(nums[i], 10) || 0;
    return out;
  }

  /** `KEY=value` tokens of one map line (upper-cased). */
  private tokens(line: string): [string, string][] {
    return line.trim().toUpperCase().split(/\s+/).filter((t) => t).map((t) => { const i = t.indexOf('='); return i < 0 ? [t, ''] : [t.slice(0, i), t.slice(i + 1)]; });
  }

  /** FUN_00459c7c / FUN_0045a108: `BMP=<name> POS=x,y [EXTRA=...]`, appended in file order. */
  private loadObjects(file: string): Obj[] {
    const out: Obj[] = [];
    for (const line of this.text(file).split(/\r?\n/)) {
      const t = this.tokens(line);
      if (!t.length || t[0][0] !== 'BMP') continue;
      const bm = this.g.bitmaps.get(t[0][1]);
      if (!bm?.img) { console.warn(`ADDSCREENOBJECT: Dib does not exist (${t[0][1]})`); continue; }
      let x1 = 0, y1 = 0;
      for (const [k, v] of t.slice(1)) if (k === 'POS') { const [a, b] = v.split(','); x1 = atoi(a ?? ''); y1 = atoi(b ?? ''); }
      out.push({ bm, x1, y1, x2: x1 + bm.img.w, y2: y1 + bm.img.h });
    }
    return out;
  }

  /** FUN_00459946 / FUN_0045a227: `SPRITE=<name> POS=.. EXTRA=CANCOLIDE|INFRONT COLDIR=dx,dy ATEND=BOUNCE|NEW`. POS is unused. */
  private loadColliders(file: string): Collider[] {
    const out: Collider[] = [];
    for (const line of this.text(file).split(/\r?\n/)) {
      const t = this.tokens(line);
      if (!t.length || t[0][0] !== 'SPRITE') continue;
      const spr = this.sprites().find(t[0][1]);
      if (!spr) { console.warn(`ADDSCREENCOLIDER: Dib does not exist (${t[0][1]})`); continue; }
      const c: Collider = { spr, flags: 0, dx: 0, dy: 0, dx0: 0, dy0: 0, started: false };
      for (const [k, v] of t.slice(1)) {
        if (k === 'EXTRA') { if (v === 'CANCOLIDE') c.flags |= 1; else if (v === 'INFRONT') c.flags |= 2; }
        else if (k === 'COLDIR') { const [a, b] = v.split(','); c.dx = c.dx0 = atoi(a ?? ''); c.dy = c.dy0 = atoi(b ?? ''); }
        else if (k === 'ATEND') { if (v === 'BOUNCE') c.flags |= 2; else if (v === 'NEW') c.flags |= 1; }
      }
      out.push(c);
    }
    return out;
  }

  // ---------------------------------------------------------------- presentation (fixed 60 Hz world clock)

  /** Keep browser frames coming while the game runs (the compositor only paints when something changed). */
  private drive() {
    if (!this.active) return;
    this.g.scene.changed = true;
    requestAnimationFrame(() => this.drive());
  }

  private present(out: Surface) {
    if (this.active) {
      const now = performance.now();
      this.acc += Math.min(MAX_CATCHUP_MS, Math.max(0, now - this.last));
      this.last = now;
      while (this.acc >= STEP_MS && this.active) {
        this.acc -= STEP_MS;
        this.frame();
      }
      if (this.drawn) { this.render(); this.drawn = false; }
    }
    out.px.set(this.buf.px);
    // script events of this window (WIN / LOOSE / COLIDE / START) run between frames, like the original's posted messages
    if (this.events.length) { this.events = []; this.g.vm.pump(); }
  }

  private render() {
    for (const c of this.cmds) c();
  }

  private fire(item: string, section: string): boolean {
    const id = this.g.vm.runNew(item, section, '');
    if (id >= 0) this.events.push([item, section]);
    return id >= 0;
  }

  // ---------------------------------------------------------------- one world step (FUN_0045a9e5)

  private sprites(): Sprites {
    return this.g.sprites as unknown as Sprites;
  }

  private frame() {
    const c = this.cfg!;
    this.steps++;
    const tw = c.tile[0], th = c.tile[1];
    const worldW = c.map[0] * tw, viewW = c.screen[0] * tw, viewH = c.screen[1] * th;
    this.scrollX += this.vx; // 1: always, even when finished
    if (this.finished) return; // 2: nothing is drawn, the last picture stays
    if (this.event !== '') { // 3
      if (this.fire(c.name, this.event)) { this.finished = true; return; }
      this.scrollX = 0; // could not start: falls through to WIN
    }
    if (this.scrollX < 1) { this.fire(c.name, 'WIN'); this.finished = true; return; } // 4
    if (worldW <= this.scrollX + viewW) { this.vx = 0; this.scrollX = worldW - viewW; } // 5
    const S = this.scrollX;
    const vp: Rc = { x1: S, y1: this.scrollY, x2: S + viewW, y2: this.scrollY + viewH };
    const cmds: (() => void)[] = [];
    this.cmds = cmds;
    this.drawn = true;
    cmds.push(() => this.drawGround(S)); // 7
    for (const o of this.behind) if (touch(o, vp)) cmds.push(() => this.blitObj(o, S, this.scrollY)); // 8
    const car = this.sprites().find(c.sprite);
    if (!car) return; // 9
    for (const o of this.front) if (touch(o, vp) && o.y2 <= car.bottom) cmds.push(() => this.blitObj(o, S, this.scrollY)); // 10
    // 11: colliders and the car in the original's three-slot order (8.3)
    if (this.colliders.length === 0) this.moveCar(car);
    else {
      const o: (Sprite | null)[] = [null, null, null], nd: (Collider | null)[] = [null, null, null];
      let n = 0;
      for (const col of this.colliders) {
        if (col.spr.y > car.y) { o[n] = car; o[n + 1] = col.spr; nd[n + 1] = col; } else { o[n] = col.spr; o[n + 1] = car; nd[n] = col; }
        n++;
      }
      for (let i = 0; i < 3; i++) if (o[i]) { const k = nd[i]; if (k) this.moveCollider(k); else this.moveCar(car); }
    }
    const S2 = this.scrollX; // the scroll may have been undone by a collision
    const vp2: Rc = { x1: S2, y1: this.scrollY, x2: S2 + viewW, y2: this.scrollY + viewH };
    for (const o of this.front) if (touch(o, vp2) && car.bottom <= o.y2) cmds.push(() => this.blitObj(o, S2, this.scrollY)); // 12
    cmds.push(() => this.drawHud(S2)); // 13
  }

  /** FUN_0045a78c: vertical step, collision, undo; the car is drawn at its screen position. */
  private moveCar(car: Sprite) {
    const c = this.cfg!;
    const sp = this.sprites();
    const move = (dy: number) => { if (dy !== 0) sp.setPos(car, car.x, car.y + dy); };
    let dy = 0;
    const a0 = Math.abs(this.vx);
    if (car.y + a0 * this.vy < c.borderY1) { dy = c.borderY1 - car.y; this.vy = 0; move(dy); }
    const a = Math.abs(this.vx);
    if (car.bottom + a * this.vy > c.borderY2) { dy = c.borderY2 - car.bottom; this.vy = 0; move(dy); }
    else {
      dy = Math.abs(this.vx) * this.vy;
      if (this.vx === 0 && this.vy !== 0) { dy = this.vy; this.vy = 0; }
      move(dy);
    }
    if (this.collide(car, true)) {
      move(-dy);
      this.scrollX -= this.vx;
      this.vx = 0;
    }
    this.cmds.push(() => this.drawSprite(car, 0, 0));
  }

  /** FUN_0045a350: obstacles (pixel test), then colliders. */
  private collide(car: Sprite, report: boolean): boolean {
    const c = this.cfg!;
    const sp = this.sprites();
    const S = this.scrollX;
    const vp: Rc = { x1: S, y1: this.scrollY, x2: S + c.screen[0] * c.tile[0], y2: this.scrollY + c.screen[1] * c.tile[1] };
    const cw: Rc = { x1: car.x + S, y1: car.y + this.scrollY, x2: car.right + S, y2: car.bottom + this.scrollY };
    const carBm = sp.frameBm(car);
    for (const o of this.obstacles) {
      if (touch(o, vp) && touch(o, cw)) {
        if (pixelHit(o.bm.img, o, carBm?.img ?? null, cw)) {
          if (report) this.fire(o.bm.name, 'COLIDE');
          return true;
        }
      }
    }
    for (const col of this.colliders) {
      const s = col.spr;
      const r: Rc = { x1: s.x, y1: s.y, x2: s.right, y2: s.bottom };
      if (touch(r, vp) && touch(r, cw)) {
        const cb = sp.frameBm(s);
        // Rattar's frame bitmap IS the car's (OT2_TUFS): both rects are the car's, so any overlap hits (bounding box)
        const hit = cb !== null && cb === carBm ? true : pixelHit(cb?.img ?? null, r, carBm?.img ?? null, cw);
        if (hit) {
          if (!(col.flags & 2)) col.dy = 0;
          else {
            col.dy = -col.dy;
            let step = Math.abs(col.dx) * col.dy;
            if (step === 0) step = col.dy;
            sp.setPos(s, s.x + col.dx, s.y + step);
          }
          if (report) this.fire(s.name, 'COLIDE');
          return true;
        }
      }
    }
    return false;
  }

  /** FUN_0045b498: update + draw one collider (only while its rect touches the viewport). */
  private moveCollider(col: Collider) {
    const c = this.cfg!;
    const sp = this.sprites();
    const s = col.spr;
    const S = this.scrollX;
    const vp: Rc = { x1: S, y1: this.scrollY, x2: S + c.screen[0] * c.tile[0], y2: this.scrollY + c.screen[1] * c.tile[1] };
    if (!touch({ x1: s.x, y1: s.y, x2: s.right, y2: s.bottom }, vp)) return;
    if (!col.started) {
      col.started = true;
      col.dx = col.dx0; col.dy = col.dy0;
      this.fire(s.name, 'START');
      s.visible = true;
    }
    const mx = col.dx;
    const a = Math.abs(col.dx);
    const move = (my: number) => sp.setPos(s, s.x + mx, s.y + my);
    if (s.y + a * col.dy < c.borderY1) {
      if (col.flags & 2) { const my = c.borderY1 - s.y; col.dy = -col.dy; move(my); }
      else if (col.flags & 1) move(c.borderY2 - c.borderY1);
    } else if (s.bottom + a * col.dy > c.borderY2) {
      if (col.flags & 2) { const my = c.borderY2 - s.bottom; col.dy = -col.dy; move(my); }
      else if (col.flags & 1) { let my = a * col.dy; if (my === 0) my = col.dy; move(my); }
    } else {
      let my = a * col.dy;
      if (my === 0) my = col.dy;
      move(my);
    }
    const sx = this.scrollX, sy = this.scrollY;
    this.cmds.push(() => this.drawSprite(s, -sx, -sy));
  }

  // ---------------------------------------------------------------- drawing

  private bmKey(bm: Bm, x: number, y: number) {
    if (bm.img) blitKeyed(this.buf, bm.img, x, y, bm.key);
  }

  private blitObj(o: Obj, sx: number, sy: number) {
    this.bmKey(o.bm, o.x1 - sx, o.y1 - sy);
  }

  /** Ground tiles (7): partial tiles at both ends when the scroll is not a multiple of the tile width. */
  private drawGround(S: number) {
    const c = this.cfg!;
    const tw = c.tile[0], th = c.tile[1], cols = c.screen[0], rows = c.screen[1], mapCols = c.map[0];
    const col0 = Math.trunc(S / tw), rem = S % tw;
    const tile = (row: number, col: number): Img | null => {
      const id = this.ground[col + row * mapCols];
      return id === undefined || id < 0 ? null : this.tiles[id]?.img ?? null;
    };
    for (let row = 0; row < rows; row++) {
      const y = row * th;
      if (rem === 0) {
        for (let k = 0; k < cols; k++) this.tile(tile(row, col0 + k), 0, tw, k * tw, y, th);
      } else {
        this.tile(tile(row, col0), rem, tw - rem, 0, y, th);
        for (let k = 0; k < cols - 1; k++) this.tile(tile(row, col0 + k + 1), 0, tw, k * tw + tw - rem, y, th);
        this.tile(tile(row, col0 + cols), 0, rem, (cols - 1) * tw + tw - rem, y, th);
      }
    }
  }

  /** BltFast with source colour key of the part [sx, sx + w) of a tile. */
  private tile(img: Img | null, sx: number, w: number, dx: number, dy: number, h: number) {
    if (!img || w <= 0) return;
    const dst = this.buf.px, sp = img.px;
    const key = 0xffffff; // tiles use the default key (white); none of them contains white
    for (let row = 0; row < h && row < img.h; row++) {
      const y = dy + row;
      if (y < 0 || y >= 480) continue;
      let s = row * img.w + sx, d = y * 640 + dx;
      for (let i = 0; i < w; i++, s++, d++) {
        if (dx + i < 0 || dx + i >= 640) continue;
        const v = sp[s];
        if (v !== key) dst[d] = v;
      }
    }
  }

  /** A sprite (and its overlay child) at its position shifted by (ox, oy): base frame first, the overlay on top. */
  private drawSprite(s: Sprite, ox: number, oy: number) {
    const sp = this.sprites();
    const one = (t: Sprite) => {
      const bm = sp.frameBm(t);
      if (!bm?.img || bm.name === 'LEEG') return;
      const sh = t.frame?.bmp.shift ?? [0, 0];
      blitKeyed(this.buf, bm.img, t.x + ox + sh[0], t.y + oy + sh[1], bm.key);
    };
    one(s);
    const c = sp.overlayOf(s);
    if (c) one(c);
  }

  /** HUD (13): gauge frame, needle, progress car, steering wheel. */
  private drawHud(S: number) {
    const c = this.cfg!;
    const { time, gauge, pos, dir } = this.hud;
    if (time) this.bmKey(time, time.home[0], time.home[1]);
    if (gauge) this.bmKey(gauge, this.needleX, gauge.home[1]);
    if (pos) {
      const span = c.map[0] * c.tile[0] - c.screen[0] * c.tile[0];
      const pct = span ? Math.trunc((S * 100) / span) : 0;
      this.bmKey(pos, pos.home[0] - (pos.home[2] - Math.trunc((pos.home[2] * pct) / 100)), pos.home[1]);
    }
    if (dir) this.bmKey(dir, dir.home[0], dir.home[1]);
  }
}

/**
 * FUN_0041049b: the "pixel" test ANDs the raw 8-bit palette indices of both bitmaps inside the intersection of their rects
 * (Win32 IntersectRect: exclusive right/bottom). So a pixel only counts when the other bitmap's index is odd for the car
 * mask (indices 0/1). Replicated on purpose (D2.0 point 4).
 */
function pixelHit(a: Img | null, ra: Rc, b: Img | null, rb: Rc): boolean {
  if (!a?.idx || !b?.idx) return false;
  const l = Math.max(ra.x1, rb.x1), t = Math.max(ra.y1, rb.y1), r = Math.min(ra.x2, rb.x2), btm = Math.min(ra.y2, rb.y2);
  for (let y = t; y < btm; y++) {
    for (let x = l; x < r; x++) {
      const ax = x - ra.x1, ay = y - ra.y1, bx = x - rb.x1, by = y - rb.y1;
      if (ax >= a.w || ay >= a.h || bx >= b.w || by >= b.h) continue;
      if ((a.idx[ay * a.w + ax] & b.idx[by * b.w + bx]) !== 0) return true;
    }
  }
  return false;
}
