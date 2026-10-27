// The sprite engine (docs/re/graphics.md Part B, spr-format.md, D1): the `Sprite` statement, `Instruction Type=SPRITE`, sprite clocks,
// animation / motion / AtEnd chaining, frame sounds, overlay and spawned children, drawing through scene nodes, hit testing, the held item
// (Sprite Type=MOUSE) and, in sprites/group.ts, the GROUP stone puzzles and the maze. Function addresses refer to Pardoes.c.
//
// Lookup API for other modules (DXSCREEN): `sprites.find(name)` -> `Sprite` with `x`, `y`, `w`, `h`, `visible`, `node`, `frame`;
// `sprites.frameBm(s)` (picture of the current frame), `sprites.setPos(s, x, y)`, `sprites.bm(frame.bmp)`.

import { atoi } from '../script/parse.ts';
import type { Result, Thread } from '../script/vm.ts';
import { SFX_CANINTERRUPT, SFX_PLAYONEATATIME } from '../script/sound.ts';
import type { Surface } from '../engine/surface.ts';
import { Gfx, type Bm, type SpriteHooks } from './gfx.ts';
import type { Commands } from './commands.ts';
import { NODE_SPRITE, rect, W, H, type Node, type Rect } from './scene.ts';
import { drawSprite, snowMask } from './sprites/draw.ts';
import { Groups } from './sprites/group.ts';
import { Sprite, type MoveRt } from './sprites/sprite.ts';
import { END_COORD, END_REPEAT, END_SFX, loadSpr, type Bmp, type Move } from './sprites/spr.ts';
import {
  F1_ALIGN, F1_BOUNDS, F1_CANBEOFFSCREEN, F1_CENTERTO, F1_COLIDE, F1_COMMAND, F1_DIRECTIONAL, F1_ACTIVE, F1_LOOPING, F1_NOSPAWNKILL, F1_REDUCTION,
  F1_SFXMUSTREPEAT, F1_VOLADJ, F2_ALLRECT, F2_BEFORE, F2_DX, F2_NOTINWORLD, T_CHANGE, T_HIDE, T_KILL, T_MOUSE, T_MOVEABLE, T_MOVING, T_SET, T_SHOW,
  T_STATIC, T_WAIT, nums4, parseSpriteStmt, type R4, type SpriteStmt,
} from './sprites/stmt.ts';
import type { Stmt as StmtT } from '../script/parse.ts';

export { Sprite } from './sprites/sprite.ts';
export type { MoveRt } from './sprites/sprite.ts';

const MAX_SPRITES = 110;
const FX: Record<string, number> = { FOLD: 1, ROLL: 2, BLIND: 3, EXPLODE: 4, '3D': 5, SIZE: 6, SNOW: 7, PUZZLE: 8 };

/** Draw geometry of one frame: source rect in the picture, destination rect on the screen. */
interface Layout { bm: Bm; src: R4; dst: R4 }

const rnd1 = (n: number) => (n > 0 ? 1 + Math.floor(Math.random() * n) : 0); // FUN_00420580: uniform 1..n
const rndRange = (a: number, b: number) => { const n = b - a; return (n > 0 ? rnd1(n) : n) + a; }; // FUN_004205c9: (a, b]
const cdiv = (a: number, b: number) => Math.trunc(a / b);

function blankStmt(): SpriteStmt {
  return {
    st: null, name: '', type: T_STATIC, file: '', move: '', timer: '', relative: '', background: '', startRaw: '', start: [0, 0, 0, 0], startSpec: false, startMouse: false,
    endRaw: '', end: [0, 0, 0, 0], endType: END_REPEAT, endSpec: false, atEnd: '', affect: '', affectRaw: '', affectPos: [0, 0, 0, 0], reductionRaw: '',
    reduction: [0, 0, 0, 0], sfx: '', volume: 0, level: -2, mouseOver: 0, align: 0x11, f1: 0, f2: 0, count: 1,
  };
}

export class Sprites implements SpriteHooks {
  readonly g: Gfx;
  private cmds: Commands;
  private slots: (Sprite | null)[] = new Array(MAX_SPRITES).fill(null);
  /** The sprite carried by the mouse (Type=MOUSE), if any. */
  private held: Sprite | null = null;
  private groups: Groups;
  private dxPump: ReturnType<typeof setInterval> | null = null;
  private warned = new Set<string>();

  constructor(g: Gfx, cmds: Commands) {
    this.g = g;
    this.cmds = cmds;
    this.groups = new Groups(this);
    g.vm.on('SPRITE', (st, t) => this.exec(st, t));
    g.vm.instr.set('SPRITE', (st, t) => this.instr(st, t));
    cmds.onDirectional = (c) => this.groups.directional(c);
  }

  // ---------------------------------------------------------------- lookup API

  /** FUN_00448faf: active sprite by name (`$VAR` names are resolved first; an unknown variable finds nothing). */
  find(name: string): Sprite | null {
    if (!name) return null;
    const n = name.startsWith('$') ? this.g.vm.vars.get(name) : name;
    if (n === undefined) return null;
    for (const s of this.slots) if (s && s.active && s.name === n) return s;
    return null;
  }

  /** The script bitmap (picture) a Bmp entry refers to. */
  bm(b: Bmp): Bm | null {
    return b.dib ? this.g.bitmap(b.dib) : null;
  }

  /** Picture of the current frame. */
  frameBm(s: Sprite): Bm | null {
    const f = s.frame;
    return f ? this.bm(f.bmp) : null;
  }

  /** Move a sprite (top-left, like Start=) and repaint. */
  setPos(s: Sprite, x: number, y: number) {
    this.touch(s);
    s.x = x; s.y = y;
    this.recomputeSize(s);
    this.moveOverlay(s);
    this.refresh(s);
  }

  all(): Sprite[] {
    return this.slots.filter((s): s is Sprite => !!s && s.active);
  }

  // ---------------------------------------------------------------- Sprite statement (FUN_0044a802)

  exec(st: StmtT, t: Thread): Result {
    const d = parseSpriteStmt(st);
    this.prelude(d);
    const type = d.type;
    if (type & T_KILL) { this.destroy(this.find(d.name)); return 'cont'; }
    if (type & T_HIDE) {
      const s = this.find(d.name);
      if (s) {
        this.setVisible(s, false);
        if (!(s.f1 & F1_SFXMUSTREPEAT) && this.canInterrupt(s.sfx)) this.stopSfx(s);
      }
      return 'cont';
    }
    if (type & T_SHOW) { const s = this.find(d.name); if (s) { this.setVisible(s, true); this.refresh(s); } return 'cont'; }
    if (type & T_WAIT) {
      const s = this.find(d.name);
      if (!s) return 'cont';
      const rt = s.cur;
      if ((s.done || rt.breakFired) && (!this.hasSpawned(s) || s.visible)) { rt.breakFired = false; s.waiting = false; return 'cont'; }
      s.thread = t.id; s.waiting = true; s.waitThread = t.id;
      return 'retry';
    }
    if (!(type & (T_STATIC | T_MOVING | T_MOVEABLE))) {
      if (type & (T_CHANGE | T_SET)) this.change(d, t);
      return 'cont';
    }
    // STATIC / MOVING / MOVEABLE / MOUSE: create if absent, otherwise nothing at all
    if (!this.find(d.name)) {
      const s = this.instantiate(d, t.id);
      if (s) {
        if (d.startSpec) { s.x = d.start[0]; s.y = d.start[1]; }
        this.recomputeSize(s);
        if (type & T_MOUSE) { this.held = s; this.g.holding = true; this.cmds.setCursor(0x10); }
        if ((!(type & T_MOVING) || d.startSpec) && !(type & T_MOUSE)) this.tickSprite(s); // the one immediate tick (WM_USER+101)
        if (s.active) this.refresh(s);
      }
    }
    return 'cont';
  }

  /** Type=CHANGE / SET on an existing sprite (or `Name=GROUP`). */
  private change(d: SpriteStmt, t: Thread) {
    if (d.name === 'GROUP') { this.groups.exec(d, t); return; }
    const s = this.find(d.name);
    if (!s) return;
    if (s.waiting && s.waitThread !== -1) {
      this.stopSfx(s);
      this.killOverlay(s);
      this.g.vm.killThread(s.waitThread);
    }
    s.waiting = false;
    s.thread = t.id;
    if (!s.visible && (d.type & T_CHANGE)) s.visible = true;
    if (!(s.f1 & F1_NOSPAWNKILL)) this.killSpawned(s);
    this.touch(s);
    this.applyStatement(s, d);
    this.recomputeSize(s);
    // depth sorting against another sprite (RATTAR Level=-7 AffectPos=PARDOES)
    if (d.affectRaw && !d.affectRaw.startsWith('$')) {
      const o = this.find(d.affectRaw);
      if (o) {
        const lvl = Math.abs(d.level);
        if (s.y + s.h - s.offset[3] < o.bottom || s.y < o.y) this.setLevel(s, lvl - 1);
        else this.setLevel(s, lvl + 1);
      }
    }
    if (s.active) this.refresh(s);
  }

  /** The prelude of FUN_0044a802: random / list / @sprite / mouse starts and `$VAR` rectangles, resolved into the statement itself. */
  private prelude(d: SpriteStmt) {
    const vars = this.g.vm.vars;
    let v: string | undefined = d.startRaw;
    if (d.startRaw.startsWith('$')) v = vars.get(d.startRaw);
    if (v !== undefined && v.startsWith('R')) { // FUN_00449b88: R x1,y1,x2,y2 = random start
      const n = nums4(v.slice(1));
      let [x, y] = n;
      if (n[1] === n[3]) { x = rndRange(n[0], n[2]); d.end[0] = x; }
      else if (n[0] === n[2]) { y = rndRange(n[1], n[3]); d.end[1] = y; }
      else { y = rndRange(n[1], n[3]); x = rndRange(n[0], n[2]); }
      d.start = [x, y, n[2], n[3]];
    } else {
      if (d.startRaw.startsWith('$') && v !== undefined) {
        if (v.startsWith('L') || v.startsWith('F')) d.start = this.pickList(v, d.start);
        else d.start = nums4(v);
      }
      if (d.endRaw.startsWith('$')) { const e = vars.get(d.endRaw); if (e !== undefined) d.end = nums4(e); }
      if (d.startRaw === '#RANDOM') { d.start[0] = rndRange(0, 600); d.start[1] = rndRange(0, 440); }
      if (d.startMouse) { d.start[0] = this.g.mouseX; d.start[1] = this.g.mouseY; }
      if (d.startRaw.startsWith('@')) {
        const a = this.find(d.name), b = this.find(d.startRaw.slice(1));
        if (a && b) {
          const fa = this.frameBm(a);
          const fb = this.frameBm(b);
          if (fa?.img && fb?.img) d.start = [b.right - a.offset[2], b.bottom - a.h + a.offset[3], d.start[2], d.start[3]];
          else d.start = [b.x, b.y, d.start[2], d.start[3]];
        }
      }
    }
    if (d.affectRaw.startsWith('$')) { const a = vars.get(d.affectRaw); if (a !== undefined) d.affectPos = nums4(a); }
    if (d.reductionRaw.startsWith('$')) { const a = vars.get(d.reductionRaw); if (a !== undefined) d.reduction = nums4(a); }
  }

  /** `L<d>/<n>/x,y/x,y/...` (FUN_00449980): one of the listed points; like the original the first point is never chosen when there are several. */
  private pickList(v: string, fallback: R4): R4 {
    const parts = v.split('/').slice(2).filter((p) => p.length);
    if (!parts.length) return fallback;
    const i = parts.length === 1 ? 0 : rnd1(parts.length - 1);
    return nums4(parts[Math.min(i, parts.length - 1)]);
  }

  // ---------------------------------------------------------------- Instruction Type=SPRITE (FUN_0044e862)

  private instr(st: StmtT, _t: Thread): Result {
    const vars = this.g.vm.vars;
    const name = vars.sub(st.get('NAME')), target = vars.sub(st.get('TARGET')), contents = vars.sub(st.get('CONTENTS'));
    const value = st.get('VALUE');
    if (name === 'ALL') {
      for (const s of this.all()) this.instrOne(s.name, value, target, contents);
      return 'cont';
    }
    this.instrOne(name, value, target, contents);
    return 'cont';
  }

  private instrOne(name: string, value: string, target: string, contents: string) {
    if (value === 'PLAY' && name === 'MAPONLY') { this.groups.play(contents); return; }
    const s = this.find(name);
    switch (value) {
      case 'DISABLE': if (s) { s.enabled = false; const c = this.overlayOf(s); if (c) c.enabled = false; } return;
      case 'ENABLE': if (s) { s.enabled = true; const c = this.overlayOf(s); if (c) c.enabled = true; } return;
      case 'UPDATE':
        if (contents === 'COLIDE') { if (s) s.f1 |= F1_COLIDE; }
        else if (contents === 'NOCOLIDE') { if (s) s.f1 &= ~F1_COLIDE; }
        if (contents === 'COMMAND') { if (s) s.f1 |= F1_COMMAND; }
        else if (contents === 'NOCOMMAND') { if (s) s.f1 &= ~F1_COMMAND; }
        else if (contents === 'REDUCTION') { if (s) s.f1 |= F1_REDUCTION; }
        else if (contents === 'NOREDUCTION') { if (s) s.f1 &= ~F1_REDUCTION; }
        else if (contents === 'START') this.groups.enter(null, -4);
        else if (contents === 'END') this.groups.enter(null, -6);
        return;
      case 'KILL': this.destroy(s); return;
      case 'VOLUME': if (s) this.adjustVolume(s, atoi(contents), false); return;
      case 'MODVOLUME': if (s) this.adjustVolume(s, atoi(contents), true); /* falls through into CHANGE in the original (harmless) */ return;
      case 'COLOR': if (s) { s.color = atoi(contents); this.refresh(s); } return;
      case 'CHANGE': if (s) this.instrChange(s, target, contents); return;
    }
  }

  private instrChange(s: Sprite, target: string, contents: string) {
    if (target === 'LEVEL') {
      const lvl = atoi(contents);
      if (s.level === lvl) return;
      this.touch(s);
      this.relevel(s, lvl);
      this.refresh(s);
    } else if (target === 'FX') {
      const bm = this.frameBm(s);
      if (!bm) return;
      if (contents in FX) bm.fx = FX[contents];
      else for (const b of s.tpl.bmps) { const o = this.bm(b); if (o && o.name !== 'ZWART') o.fx = 0; }
    } else if (target === 'REDUCTION') {
      s.f1 |= F1_REDUCTION;
      s.reduction = nums4(contents);
      this.refresh(s);
    } else if (contents === 'NOREDUCTION') s.f1 &= ~F1_REDUCTION;
  }

  /** FUN_0044e6c4 / FUN_0044e764: set / change the volume of the sprite's current sound. */
  private adjustVolume(s: Sprite, v: number, relative: boolean) {
    s.sfxVolume = relative ? s.sfxVolume + v : v;
    this.updateSfx(s);
  }

  // ---------------------------------------------------------------- creation (FUN_00445e21)

  private instantiate(d: SpriteStmt, thread: number): Sprite | null {
    const old = this.find(d.name);
    if (old) { old.enabled = true; return null; }
    // File= may name a variable (`File=$KPBORDFILE`): the original expands it with FUN_00414fd5 (graphics.md says "no resolution": wrong)
    const file = d.file.startsWith('$') ? this.g.vm.vars.expand(d.file) : d.file;
    if (!file) return null;
    const idx = this.slots.findIndex((s) => !s || !s.active);
    if (idx < 0) { console.warn('Maximum van actieve type Sprite bereikt'); return null; }
    const tpl = loadSpr(this.g.dat, file);
    if (!tpl) {
      if (!this.warned.has(file)) { this.warned.add(file); console.warn('sprite ontbreekt:', file); }
      return null;
    }
    const s = new Sprite();
    s.slot = idx;
    s.tpl = tpl;
    s.timer = s.defaultTimer = tpl.timer;
    s.moves = tpl.moves.map((m) => this.newRt(m));
    for (const rt of s.moves) if (!s.byKey.has(rt.m.key)) s.byKey.set(rt.m.key, rt);
    s.cur = s.moves[0];
    if (tpl.rect) { s.x = tpl.rect[0]; s.y = tpl.rect[1]; }
    s.offset = [tpl.offset[0], tpl.offset[1], tpl.offset[2], tpl.offset[3]];
    s.name = d.name;
    s.type = d.type;
    s.thread = thread;
    s.level = d.level === -2 ? -1 : d.level;
    s.reduction = [...d.reduction];
    s.pct = d.reduction[3];
    s.affectRect = [...d.affectPos];
    s.f1 |= d.f1;
    s.f2 |= d.f2 | (tpl.before ? F2_BEFORE : 0);
    s.file = d.file;
    if (!s.cur) { // a file without any Move: nothing to animate (the original would crash)
      console.warn('sprite zonder Move:', d.file);
      return null;
    }
    this.slots[idx] = s;
    this.applyStatement(s, d);
    if (!s.active) return null; // killed by an AtEnd=KILL move of the first tick (not possible here) / failed hide
    this.recomputeSize(s);
    this.addNode(s);
    s.visible = true;
    s.enabled = true;
    if (!(s.f2 & F2_NOTINWORLD)) s.color = this.g.scene.world;
    if (tpl.timer === 'DX' || d.timer === 'DX') this.ensureDxPump();
    return s;
  }

  private newRt(m: Move): MoveRt {
    return { m, cur: 0, prev: -1, fxPhase: 0, breakFired: false, spIdx: 0, spCur: m.special?.cur0 ?? 0, spInc: m.special?.inc0 ?? 1 };
  }

  private ensureDxPump() {
    if (this.dxPump) return;
    // the `DX` clock ticks once per presented frame; keep frames coming while a sprite uses it
    this.dxPump = setInterval(() => {
      if (this.slots.some((s) => s && s.active && s.timer === 'DX')) this.g.scene.changed = true;
      else { clearInterval(this.dxPump!); this.dxPump = null; }
    }, 16);
  }

  // ---------------------------------------------------------------- applyStatement (FUN_004452c3)

  private applyStatement(s: Sprite, d: SpriteStmt): boolean {
    const vars = this.g.vm.vars;
    s.bounds = false;
    if (d.f1 & F1_BOUNDS) { s.bounds = true; s.offset = [...d.affectPos]; }
    if (d.file) s.file = d.file;
    if (d.timer) {
      s.timer = d.timer === 'DEFAULT' ? s.defaultTimer : d.timer;
      if (s.timer === 'DX') this.ensureDxPump();
    }
    s.endType = d.endType;
    s.count = d.count;
    s.waiting = false;
    s.done = false;
    if (d.background) s.background = d.background;
    if (d.affect) s.affect = d.affect;
    s.stmtAtEnd = d.atEnd;
    if (d.startSpec) {
      let spec = true;
      if (d.startRaw.startsWith('$')) { const v = vars.get(d.startRaw); if (v !== undefined && v.length === 0) spec = false; }
      if (spec) {
        if (s.node) this.touch(s);
        s.x = d.start[0]; s.y = d.start[1];
        s.savedStart = [...d.start];
      }
    }
    if (d.mouseOver !== 0) s.cursor = d.mouseOver;
    if (d.f1 & F1_ALIGN) s.align = d.align;
    if (d.level > -2) this.setLevel(s, d.level);
    if (d.endSpec) s.endRect = [...d.end];
    if (d.relative) {
      const r = this.find(d.relative);
      if (r) { s.x += r.x; s.y += r.y; }
    }
    this.recomputeSize(s);
    if (d.move) {
      const name = this.resolveMoveName(s, d);
      if (!this.switchMove(s, name)) return false;
    }
    this.recomputeSize(s);
    if (s.f1 & F1_ALIGN) {
      const c = s.align;
      s.x -= c & 1 ? 0 : c & 2 ? s.w : cdiv(s.w, 2);
      s.y -= c & 0x10 ? 0 : c & 0x20 ? s.h : cdiv(s.h, 2);
    }
    this.recomputeSize(s);
    if (d.sfx) this.startSfx(s, d.sfx, d.volume);
    return true;
  }

  /** The `?` / `??` chooser (Pardoes' walking steps), `%` / `&` left-right suffixes, `$VAR` (FUN_004452c3). */
  private resolveMoveName(s: Sprite, d: SpriteStmt): string {
    let name = d.move;
    if (name.startsWith('$')) name = this.g.vm.vars.get(name) ?? name;
    if (name[0] === '?') {
      const dbl = name[1] === '?';
      const prefix = name.slice(dbl ? 2 : 1);
      const area = d.affectPos;
      const cands: MoveRt[] = [];
      let best = -1, bestDist = 1000;
      for (const rt of s.moves) {
        const m = rt.m;
        if (!m.key.startsWith(prefix)) continue;
        // size of the first frame whose picture is not LEEG (FUN_00445d5f "!LEEG")
        const fb = m.frames.find((f) => f.bmp.name !== 'LEEG') ?? m.frames[0];
        const bm = fb ? this.bm(fb.bmp) : null;
        const w = bm?.img?.w ?? 0, h = bm?.img?.h ?? 0;
        if (dbl) {
          const right = s.x + cdiv(w, 2);
          const cx = area[0] + cdiv(area[2] - area[0], 2);
          const dist = Math.abs(cx - right - m.dir[0]);
          if (dist < Math.abs(cx - right)) { cands.push(rt); if (dist < bestDist) { bestDist = dist; best = cands.length - 1; } }
        } else {
          const right = s.x + w, bottom = s.y + h;
          if (area[0] < s.x + m.dir[0] && right + m.dir[0] < area[2] && area[1] < bottom + m.dir[1] && bottom + m.dir[1] < area[3]) cands.push(rt);
        }
      }
      if (cands.length) name = (best === -1 ? cands[cands.length - 1] : cands[best]).m.key;
    } else if (name[0] === '%') {
      name = name.slice(1) + (this.g.mouseX < s.x + cdiv(s.w, 2) ? 'L' : 'R');
    } else if (name[0] === '&') {
      name = name.slice(1) + (s.x + cdiv(s.w, 2) < 320 ? 'L' : 'R');
    }
    return name;
  }

  // ---------------------------------------------------------------- switchMove (FUN_00444c6b)

  /** Make `name` the current move (or hide / kill the sprite for HIDE / VERDWIJN / KILL). false = failure: the caller aborts. */
  switchMove(s: Sprite, nameIn: string | null): boolean {
    if (!s.moves.length) return false;
    if (!nameIn) { s.cur = s.moves[0]; return true; }
    let name = nameIn;
    if (name[0] === '$') name = this.g.vm.vars.get(name) ?? name;
    if (name.startsWith('RANDOM')) name = name.slice(0, 7) + rnd1(atoi(name.slice(7)));
    if (name === 'VERDWIJN') { this.setVisible(s, false); return false; }
    if (name === 'HIDE') {
      this.setVisible(s, false);
      if (!(s.f1 & F1_SFXMUSTREPEAT) && this.canInterrupt(s.sfx)) this.stopSfx(s);
      return false;
    }
    if (name === 'KILL') {
      this.touch(s);
      const p = s.parent;
      if (p && p.active && p.waiting && (p.done || p.cur.breakFired) && !p.visible) this.wake(p);
      this.destroy(s);
      return false;
    }
    const rt = s.byKey.get(name);
    if (!rt) return false;
    rt.cur = 0;
    s.cur = rt;
    rt.prev = -1;
    s.pendX = s.pendY = 0;
    this.applyFramePos(s);
    s.endType = rt.m.end;
    s.count = rt.m.count;
    s.done = false;
    s.lastFlag = false;
    if (rt.m.level !== -1) this.setLevel(s, rt.m.level);
    this.recomputeSize(s);
    if (rt.m.overlay) this.overlay(s, rt.m.overlay);
    const f = rt.m.frames[0];
    if (f) {
      if (f.spawn) this.spawn(s, f.spawn);
      if (f.bmp.spawn) this.spawn(s, f.bmp.spawn);
      if (f.bmp.sfx) this.startSfx(s, f.bmp.sfx, f.bmp.volume);
    }
    return true;
  }

  // ---------------------------------------------------------------- clocks and ticks

  /** A clock ticked (timer name or the per-frame pseudo clock `DX`): FUN_0044c4a2. */
  tick(clock: string) {
    for (let i = 0; i < this.slots.length; i++) {
      const s = this.slots[i];
      if (s && s.active && s.timer === clock && s.enabled && s.visible) this.tickSprite(s);
    }
    if (clock === 'DX') this.g.vm.pump();
  }

  /** FUN_0044dd28 */
  private tickSprite(s: Sprite) {
    if (!s.enabled || !s.active) return;
    const f = s.frame;
    if (!f) return;
    try {
      if (!this.animate(s)) return;
      if (s.hasOverlay) { const c = this.overlayOf(s); if (c) this.animate(c); }
      if (!s.active) return;
      if (s.type & T_STATIC) this.stepStatic(s);
      else if (s.type & T_MOVING) this.stepMoving(s);
      else if (s.type & T_MOVEABLE) this.stepMoveable(s);
    } catch (e) {
      console.error('sprite', s.name, e);
    }
    if (s.active) {
      this.refresh(s);
      const c = this.overlayOf(s);
      if (c) this.refresh(c);
    }
    if (s === this.held) this.g.scene.changed = true;
  }

  private wake(s: Sprite) {
    if (s.thread >= 0) this.g.vm.resume(s.thread);
  }

  /** FUN_0044d3d0: advance one frame, count passes, chain AtEnd. false = the tick ends here. */
  private animate(s: Sprite): boolean {
    const rt = s.cur, m = rt.m;
    const frames = m.frames;
    const f = frames[rt.cur];
    if (!f) return false;
    if (frames.length === 1 && rt.cur === 0 && m.count === -1 && !m.special) return false;
    this.updatePct(s);
    this.touch(s); // (the original skips this for overlay children: its parent's draw covers them; here a child has its own node)
    const fbm = this.bm(f.bmp);
    if (fbm && (fbm.fx & 7) !== 0) { // bitmap FX (SNOW): every frame is held for 5 ticks
      rt.fxPhase++;
      if (rt.fxPhase < 5) return true;
      rt.fxPhase = 0;
      rt.prev = rt.cur;
    }
    const atLast = rt.cur === frames.length - 1;
    let done: boolean;
    if (atLast) {
      s.lastFlag = true;
      done = this.endCheck(s, 0);
      if (!done) { rt.cur = 0; this.applyFramePos(s); s.lastFlag = false; }
    } else {
      done = this.endCheck(s, 1);
      if (!done) { rt.cur = rt.cur + 1; s.lastFlag = false; this.applyFramePos(s); }
    }
    if (done) {
      if (!m.click && (m.atEnd || s.stmtAtEnd)) {
        s.lastFlag = false;
        let nm = s.stmtAtEnd;
        if (nm[0] === '$') nm = this.g.vm.vars.get(nm) ?? '';
        if (m.end !== END_COORD) nm = '';
        s.skipSpawnOnce = true;
        if (nm === '') { if (!this.switchMove(s, m.atEnd)) return false; }
        else if (!this.switchMove(s, nm === 'HIDE' ? 'HIDE' : `${nm}${m.count}`)) return false;
        if (s.waiting && s.cur.m.breakWait) { s.cur.breakFired = true; this.wake(s); }
      } else {
        if (s.waiting) { this.wake(s); return false; }
        if (s.f1 & F1_LOOPING) { s.count = m.count; s.x = s.savedStart[0]; s.y = s.savedStart[1]; }
      }
    }
    this.recomputeSize(s);
    const sp = s.cur.m.special;
    if (sp) {
      const c = s.cur;
      c.spIdx += sp.step;
      if (c.spIdx >= sp.n) c.spIdx = 0;
      c.spCur += c.spInc;
      if (sp.max <= c.spCur) c.spInc = -c.spInc;
      if (c.spCur <= sp.min) c.spInc = -c.spInc;
    }
    return true;
  }

  /** FUN_0044daf4: has the current move finished? (only MOVING sprites ever finish) */
  private endCheck(s: Sprite, p: number): boolean {
    if (!s.moving) return false;
    if (!s.done) {
      switch (s.endType) {
        case END_REPEAT:
          if (p === 0) {
            if (s.count < 0) s.done = false;
            else if (s.count === 0) s.done = true;
            else if (s.lastFlag) { s.count--; if (s.count === 0) s.done = true; }
          }
          break;
        case END_SFX:
          if (!this.g.snd.isPlaying(s.sfx)) s.done = true;
          break;
        case END_COORD:
          if (p === 0) {
            const cx = s.x + cdiv(s.w, 2), r = s.endRect;
            if (r[0] < cx && cx < r[2] && r[1] < s.bottom && s.bottom <= r[3]) s.done = true;
            else if (s.lastFlag) {
              const m = s.cur.m;
              s.lastFlag = false;
              if (!this.switchMove(s, `${m.family}${m.count}`)) return false;
            }
          }
          break;
        default:
          if (p === 0 && s.lastFlag) s.done = true;
      }
    }
    return s.done;
  }

  /** FUN_0044d369 + FUN_0044c24d: the POS of the current frame becomes pending displacement (x scaled by the reduction percent). */
  private applyFramePos(s: Sprite) {
    const f = s.frame;
    if (!f) return;
    let dx = f.pos[0];
    const dy = f.pos[1];
    if (s.pct !== 0) dx = cdiv(dx * s.pct, 100);
    this.addPending(s, dx, dy);
  }

  /** FUN_0044c24d */
  private addPending(s: Sprite, dx: number, dy: number): boolean {
    if (s.moving && dx === 0 && dy === 0) return false;
    s.pendX += dx;
    s.pendY += dy;
    this.moveOverlay(s);
    return true;
  }

  /** FUN_0044de5b: STATIC sprites animate in place and are hidden when they leave the screen. */
  private stepStatic(s: Sprite) {
    if (s.done || s.hasOverlay) return;
    s.pendX = s.pendY = 0;
    this.recomputeSize(s);
    if (s.x + s.w < 0 || s.x >= W || s.y + s.h < 0 || s.y >= H) {
      s.waiting = true;
      this.setVisible(s, false);
    }
  }

  /** FUN_0044c627 (Type=MOVEABLE, unused by PLAYER.SCR) */
  private stepMoveable(s: Sprite) {
    s.x += s.pendX; s.y += s.pendY;
    this.recomputeSize(s);
    this.moveOverlay(s);
    s.pendX = s.pendY = 0;
    this.updateSfx(s);
  }

  /** FUN_0044df76 */
  private stepMoving(s: Sprite) {
    if (s.done) return;
    const f = s.frame!;
    if (!s.skipSpawnOnce) {
      if (f.spawn) this.spawn(s, f.spawn);
      if (f.bmp.spawn) this.spawn(s, f.bmp.spawn);
      if (f.bmp.sfx) this.startSfx(s, f.bmp.sfx, f.bmp.volume);
    } else s.skipSpawnOnce = false;
    if (!s.bounds) {
      if (!(s.f1 & F1_CENTERTO) || !s.affect) { s.x += s.pendX; s.y += s.pendY; }
      else {
        const t = this.find(s.affect);
        if (t) {
          const tb = t.frame!.bmp, sb = f.bmp;
          s.x = t.x + tb.center[0] + tb.shift[0] - sb.center[0];
          s.y = t.y + tb.center[1] + tb.shift[1] - sb.center[1];
        }
      }
    } else {
      const b = s.offset;
      const nx = s.x + s.pendX, ny = s.y + s.pendY;
      s.x = nx < b[0] ? b[0] : b[2] < nx ? b[2] : nx;
      s.y = ny < b[1] ? b[1] : b[3] < ny ? b[3] : ny;
    }
    s.pendX = s.pendY = 0;
    this.recomputeSize(s);
    if (s.x + s.w < 0 || s.x > W || s.y + s.h < 0 || s.y > H) {
      if (!(s.f1 & F1_LOOPING)) {
        if (!(s.f1 & F1_CANBEOFFSCREEN)) {
          if (s.frame!.bmp.name !== 'LEEG') {
            s.done = true;
            s.count = 0;
            this.setVisible(s, false);
            if (s.waiting) this.wake(s);
          }
          return;
        }
      } else {
        s.x = s.savedStart[0]; s.y = s.savedStart[1];
        this.recomputeSize(s);
      }
    }
    this.moveOverlay(s);
    this.updateSfx(s);
    if (s.visible && (s.f1 & F1_COLIDE)) {
      const t = this.find(s.affect);
      if (t) {
        const a = s.hitRect(), b = t.hitRect();
        if (a.l <= b.r && b.l <= a.r && a.t <= b.b && b.t <= a.b) this.postEvent(s.name, 'COLIDE');
      }
    }
  }

  // ---------------------------------------------------------------- overlay and spawned children

  overlayOf(s: Sprite): Sprite | null {
    return s.hasOverlay ? this.find(`${s.name}O`) : null;
  }

  /** FUN_0044c1ca: the overlay sits at parent position + its own SPR offset + the parent frame's shift. */
  private moveOverlay(s: Sprite) {
    const c = this.overlayOf(s);
    const f = s.frame;
    if (!c || !f) return;
    c.x = s.x + c.offset[0] + f.bmp.shift[0];
    c.y = s.y + c.offset[1] + f.bmp.shift[1];
    this.recomputeSize(c);
  }

  /** FUN_0044c9b4: Overlay=<file.spr> / KILL of the move being entered. */
  private overlay(s: Sprite, file: string) {
    if (s.hasOverlay) {
      const c = this.overlayOf(s);
      if (!c) s.hasOverlay = false;
      else if (file === 'KILL') { this.killOverlay(s); return; }
      else if (c.file !== file) this.killOverlay(s);
    }
    if (!s.hasOverlay && file && file !== 'KILL') {
      const d = blankStmt();
      d.name = `${s.name}O`;
      d.type = s.type;
      d.file = file;
      d.relative = s.name;
      d.level = s.level;
      d.mouseOver = s.cursor;
      d.align = s.align;
      d.f1 = s.f1 & 1;
      d.f2 = s.f2 & 0xf;
      d.count = -1;
      const c = this.instantiate(d, s.thread);
      if (c) {
        s.hasOverlay = true;
        c.parent = s;
        c.isChild = true;
        c.file = file;
        this.moveOverlay(s);
        c.visible = true;
        this.refresh(c);
      }
    }
  }

  private killOverlay(s: Sprite) {
    const c = this.overlayOf(s);
    if (c) this.destroy(c);
    s.hasOverlay = false;
  }

  /** FUN_0044ce95: `Spawn=<file.spr>` starts an independent child sprite `<name>S<k>`; `Spawn=KILL` kills them all. */
  private spawn(s: Sprite, file: string) {
    if (file === 'KILL') { this.killSpawned(s); return; }
    if (!file) return;
    let k = 0;
    while (this.find(`${s.name}S${k}`)) k++;
    const d = blankStmt();
    d.name = `${s.name}S${k}`;
    d.type = s.type;
    d.file = file;
    d.relative = s.name;
    d.level = s.level;
    d.mouseOver = s.cursor;
    d.align = s.align;
    d.f1 = s.f1 & 0x2009;
    d.f2 = s.f2 & 0xf;
    d.reduction = [0, 0, 0, s.pct];
    d.count = 1;
    const c = this.instantiate(d, s.thread);
    if (c) {
      this.updatePct(s);
      c.pct = s.pct;
      c.parent = s;
      c.visible = true;
      s.hasSpawn = true;
      this.refresh(c);
    }
  }

  /** FUN_0044920f */
  private hasSpawned(s: Sprite): boolean {
    for (let i = 0; i < 10; i++) if (this.find(`${s.name}S${i}`)) return true;
    s.hasSpawn = false;
    return false;
  }

  /** FUN_00449283 */
  private killSpawned(s: Sprite) {
    for (let i = 0; i < 10; i++) { const c = this.find(`${s.name}S${i}`); if (c) this.destroy(c); }
    s.hasSpawn = false;
  }

  // ---------------------------------------------------------------- visibility, level, destroy

  /** FUN_00444b74 */
  private setVisible(s: Sprite, v: boolean) {
    this.touch(s);
    s.visible = v;
    if (!v && s.waiting) {
      s.done = true;
      if (!this.hasSpawned(s)) this.wake(s);
    }
    if (s.node) this.syncRect(s);
  }

  /** FUN_004449ca: change the draw level (the node is re-filed at the end of its new level list); the overlay follows. */
  private setLevel(s: Sprite, level: number) {
    if (s.level === level) return;
    this.relevel(s, level);
    const c = this.overlayOf(s);
    if (c) this.setLevel(c, level);
  }

  private relevel(s: Sprite, level: number) {
    const n = s.node;
    if (n) this.g.scene.remove(n);
    s.level = level;
    if (n) { n.level = level; this.addToScene(s, n); }
  }

  /** FUN_0044933f */
  destroy(s: Sprite | null) {
    if (!s || !s.active) return;
    s.active = false;
    if (s === this.held) { this.held = null; this.g.holding = false; this.cmds.setCursor(0); }
    s.x -= s.pendX; s.y -= s.pendY;
    s.timer = '';
    if (s.node) { this.g.scene.invalidate(s.node.rect); this.g.scene.remove(s.node); }
    if (s.waiting) this.wake(s);
    const c = s.hasOverlay ? this.find(`${s.name}O`) : null;
    if (c) this.destroy(c);
    this.killSpawned(s);
    if (s.isChild && s.parent) s.parent.hasOverlay = false;
    if (s.sfx) this.g.snd.stop(s.sfx);
    s.node = null;
    if (s.slot >= 0 && this.slots[s.slot] === s) this.slots[s.slot] = null;
  }

  // ---------------------------------------------------------------- sound (FUN_00449620, FUN_0044e56c, FUN_0044e49d)

  private canInterrupt(name: string): boolean {
    return !!name && ((this.g.snd.slot(name)?.flags ?? 0) & SFX_CANINTERRUPT) !== 0;
  }

  stopSfx(s: Sprite) {
    if (s.sfx) this.g.snd.stop(s.sfx);
  }

  /** The sprite sound starts: frame `Sfx=`/`Volume=` or the statement's SFX=. Names that are not loaded stay silent. */
  startSfx(s: Sprite, name: string, volume: number) {
    if (!name) return;
    const snd = this.g.snd;
    const def = snd.slot(name);
    if (def && snd.isPlaying(name) && (def.flags & SFX_PLAYONEATATIME)) return;
    if (s.sfx && this.canInterrupt(s.sfx)) snd.stop(s.sfx);
    if (name === 'KILL') return;
    s.sfx = name;
    s.sfxVolume = volume;
    const m = s.cur.m;
    const loop = s.endType !== END_SFX && (m.speed !== 0 || (s.f1 & F1_SFXMUSTREPEAT) !== 0 || m.count === -1);
    snd.play(name, this.sfxVol(s, volume), loop);
    snd.setPan(name, this.sfxPan(s));
  }

  private sfxVol(s: Sprite, v: number): number {
    const pct = s.pct > 0 ? s.pct : 100;
    return v + (100 - pct) * -20;
  }

  /** (x + w/2 - 320) * (3000 / 320) hundredths of a dB: sprites on the left pan left. */
  private sfxPan(s: Sprite): number {
    return (s.x + cdiv(s.w, 2) - 320) * 9;
  }

  /** Re-apply volume (by scale) and pan (by x) while the sprite moves. */
  private updateSfx(s: Sprite) {
    const snd = this.g.snd;
    if (s.sfx && snd.isPlaying(s.sfx)) {
      snd.setVolume(s.sfx, this.sfxVol(s, s.sfxVolume));
      snd.setPan(s.sfx, this.sfxPan(s));
    }
    // Extra=VOLUMEADJUSTTOFX (FM1_HUIS): the sound named by Affect= follows the Special strength
    const sp = s.cur.m.special;
    if ((s.f1 & F1_VOLADJ) && s.affect && sp && sp.max) snd.setVolume(s.affect, -1500 + (100 - cdiv(s.cur.spCur * 100, sp.max)) * -20);
  }

  // ---------------------------------------------------------------- geometry, nodes, drawing

  /** FUN_00444a5e: size of the current frame (a LEEG frame has the size of the first Bmp of the file). */
  private recomputeSize(s: Sprite) {
    const f = s.frame;
    if (!f) return;
    let bm = this.bm(f.bmp);
    if (bm && bm.name === 'LEEG') { const first = s.tpl.bmps[0]; bm = first ? this.bm(first) : null; }
    s.w = bm?.img?.w ?? 0;
    s.h = bm?.img?.h ?? 0;
    if (s.node) s.node.rect = this.nodeRect(s);
  }

  /** FUN_0044b8c0: the REDUCTION scale for the current feet position (b == 0 keeps the last value). */
  private updatePct(s: Sprite): number {
    const [a, b, c] = s.reduction;
    if (b !== 0) {
      const t = 100 - cdiv(c - (s.y + s.h - s.offset[3]), b);
      s.pct = t < 100 ? Math.max(0, 100 - (100 - t) * a) : 0;
    }
    return s.pct;
  }

  /** FUN_0044c0a1: foot point of the topmost parent (reference of scaled children). */
  private rootBase(s: Sprite): [number, number] {
    let r = s;
    while (r.parent) r = r.parent;
    return [r.x, r.y + r.h - r.offset[3]];
  }

  /** FUN_0044b970: source and destination rectangle of the frame (shift, REDUCTION scaling, clipping to the screen). */
  private layout(s: Sprite, fi = s.cur.cur): Layout | null {
    const f = s.cur.m.frames[fi];
    if (!f) return null;
    const bm = this.bm(f.bmp);
    const img = bm?.img;
    if (!bm || !img) return null;
    const x0 = s.x + f.bmp.shift[0], y0 = s.y + f.bmp.shift[1];
    let src: R4 = [0, 0, img.w, img.h];
    let dst: R4 = [x0, y0, x0 + img.w, y0 + img.h];
    const lr = s.cur.m.lr;
    const pct = s.f1 & F1_REDUCTION ? this.updatePct(s) : 0;
    if (!(s.f1 & F1_REDUCTION)) {
      // FUN_0044b7b0: Extra=LEFT crops the opposite side when clipped horizontally
      if (dst[2] > W) { const e = dst[2] - W; dst[2] -= e; if (lr === 0) src[0] += e; else src[2] -= e; }
      if (dst[3] > H) { const e = dst[3] - H; dst[3] -= e; src[3] -= e; }
      if (dst[0] < 0) { const e = -dst[0]; dst[0] = 0; if (lr === 0) src[2] -= e; else src[0] += e; }
      if (dst[1] < 0) { const e = -dst[1]; dst[1] = 0; src[1] += e; }
    } else {
      if (pct !== 0) {
        const dw = cdiv(img.w * pct, 100), dh = cdiv(img.h * pct, 100);
        const left = s.x + cdiv(img.w - dw, 2) + f.bmp.shift[0];
        let top: number;
        if (!s.parent) top = s.y - cdiv(s.offset[3] * pct, 100) + (img.h - dh);
        else { const by = this.rootBase(s)[1]; top = by - cdiv((by - s.y) * pct, 100); }
        top += f.bmp.shift[1];
        dst = [left, top, left + dw, top + dh];
      }
      // proportional clipping to the screen
      const dw = dst[2] - dst[0], dh = dst[3] - dst[1];
      if (dw > 0 && dh > 0) {
        const sw = src[2] - src[0], sh = src[3] - src[1];
        if (dst[2] > W) { const e = dst[2] - W; src[2] -= Math.round((e * sw) / dw); dst[2] = W; }
        if (dst[3] > H) { const e = dst[3] - H; src[3] -= Math.round((e * sh) / dh); dst[3] = H; }
        if (dst[0] < 0) { const e = -dst[0]; src[0] += Math.round((e * sw) / dw); dst[0] = 0; }
        if (dst[1] < 0) { const e = -dst[1]; src[1] += Math.round((e * sh) / dh); dst[1] = 0; }
      }
    }
    return { bm, src, dst };
  }

  /** Bounding rect of what the node can be hit at or draw at (the scene culls and the hit test pre-filters with it). */
  private nodeRect(s: Sprite): Rect {
    const h = s.hitRect();
    let r = rect(Math.min(h.l, h.r), Math.min(h.t, h.b), Math.max(h.l, h.r), Math.max(h.t, h.b));
    const L = s.visible ? this.layout(s) : null;
    if (L && L.bm.name !== 'LEEG') {
      r = rect(Math.min(r.l, L.dst[0]), Math.min(r.t, L.dst[1]), Math.max(r.r, L.dst[2]), Math.max(r.b, L.dst[3]));
      // a dissolving frame also draws the previous picture
      const rt = s.cur;
      if ((L.bm.fx & 7) !== 0 && rt.prev >= 0 && rt.prev !== rt.cur) {
        const P = this.layout(s, rt.prev);
        if (P) r = rect(Math.min(r.l, P.dst[0]), Math.min(r.t, P.dst[1]), Math.max(r.r, P.dst[2]), Math.max(r.b, P.dst[3]));
      }
    }
    return r;
  }

  private makeNode(s: Sprite): Node {
    return {
      type: NODE_SPRITE, name: s.name, level: s.level, dx: (s.f2 & F2_DX) !== 0, rect: this.nodeRect(s), owner: s, notInWorld: (s.f2 & F2_NOTINWORLD) !== 0,
      drawBG: (dst, clip) => this.draw(s, dst, false, clip),
      drawDX: (dst) => this.draw(s, dst, true),
      darken: (pct) => { s.color = pct; },
    };
  }

  /** FUN_004111e7 / FUN_00411343: at the end of its level list, BEFORE at the head, DIRECTIONAL before the trailing Command nodes. */
  private addToScene(s: Sprite, n: Node) {
    this.g.scene.add(n, s.f2 & F2_BEFORE ? 'head' : s.f1 & F1_DIRECTIONAL ? 'beforeCommands' : 'tail');
  }

  private addNode(s: Sprite) {
    if (s.type & T_MOUSE) return; // the carried sprite is drawn by drawHeld
    const n = this.makeNode(s);
    s.node = n;
    this.addToScene(s, n);
    this.g.scene.invalidate(n.rect);
  }

  /** Queue the area the sprite currently occupies (before a change). */
  private touch(s: Sprite) {
    if (s.node) this.g.scene.invalidate(s.node.rect);
    if (s === this.held) this.g.scene.changed = true;
  }

  private syncRect(s: Sprite) {
    if (!s.node) return;
    s.node.rect = this.nodeRect(s);
    this.g.scene.invalidate(s.node.rect);
  }

  /** After a change: recompute the node rect and queue the new area. */
  private refresh(s: Sprite) {
    this.syncRect(s);
    if (s === this.held) this.g.scene.changed = true;
  }

  private draw(s: Sprite, dst: Surface, dx: boolean, clip?: Rect) {
    if (!s.visible || !s.active || (s.type & T_MOUSE)) return;
    const L = this.layout(s);
    if (!L || L.bm.name === 'LEEG') return;
    const rt = s.cur;
    const bm = L.bm;
    const sp = rt.m.special;
    if ((bm.fx & 7) !== 0 && rt.prev >= 0 && rt.prev !== rt.cur && rt.fxPhase < 4) { // FX=SNOW: dissolve from the previous frame
      const P = this.layout(s, rt.prev);
      if (P && P.bm.name !== 'LEEG') this.blit(s, P, dst, dx, clip, null, snowMask(3 - rt.fxPhase));
      this.blit(s, L, dst, dx, clip, null, snowMask(rt.fxPhase));
      return;
    }
    // the DX path is a plain colour-keyed Blt: no ColFX and no Special (those only exist in the software path)
    this.blit(s, L, dst, dx, clip, sp && !dx ? { table: sp.table, idx: rt.spIdx, p: Math.abs(rt.spCur) } : null, null);
  }

  private blit(s: Sprite, L: Layout, dst: Surface, dx: boolean, clip: Rect | undefined, sp: { table: number[]; idx: number; p: number } | null, mask: ((x: number, y: number) => boolean) | null) {
    const bm = L.bm, img = bm.img!;
    const pct = Math.max(0, Math.min(100, s.color));
    if (img.pct !== pct) img.darken(pct, bm.maskIndex);
    drawSprite(dst, img, L.src, L.dst, {
      dx, maskIndex: bm.maskIndex, key: bm.key, colfx: dx ? 0 : bm.colfx, p: sp ? sp.p : bm.colorize, clip, shear: sp?.table, shearIdx: sp?.idx, mask,
    });
  }

  /** The carried item (Sprite Type=MOUSE), centred on the mouse, drawn after everything (FUN_0044f0bf). */
  drawHeld(out: Surface, mx: number, my: number) {
    const s = this.held;
    if (!s || !s.active || !s.visible) return;
    const bm = this.frameBm(s);
    const img = bm?.img;
    if (!bm || !img) return;
    s.x = mx - cdiv(img.w, 2);
    s.y = my - cdiv(img.h, 2);
    const L = this.layout(s);
    if (!L || bm.name === 'LEEG') return;
    this.blit(s, L, out, true, undefined, null, null);
  }

  // ---------------------------------------------------------------- hit testing, press, cursor (FUN_004450ff, FUN_004123a5, FUN_00411b1e)

  hit(node: Node, x: number, y: number): boolean {
    const s = node.owner as Sprite;
    if (!s || !s.active || !s.visible) return false;
    if (!(s.type & T_MOVEABLE) && !(s.f1 & F1_DIRECTIONAL) && !(s.f1 & F1_COMMAND)) return false;
    const r = s.hitRect();
    if (x < r.l || x > r.r || y < r.t || y >= r.b) return false;
    if (s.f2 & F2_ALLRECT) return true;
    const bm = this.frameBm(s);
    const img = bm?.img;
    if (!bm || !img) return false;
    const lx = x - s.x, ly = y - s.y;
    if (!img.opaqueAt(lx, ly, bm.maskIndex)) return false;
    const trigs = s.tpl.triggers;
    if (!trigs.length) return true;
    const px = cdiv(lx * 100, img.w), py = cdiv(ly * 100, img.h);
    for (const t of trigs) {
      const tx = t.posFixed ? lx : px, ty = t.posFixed ? ly : py;
      if (t.area[0] <= tx && tx <= t.area[2] && t.area[1] <= ty && ty < t.area[3]) { s.curTrigger = t; return true; }
    }
    return false;
  }

  press(node: Node, _x: number, _y: number) {
    const s = node.owner as Sprite;
    if (!s || !s.active) return;
    if (s.type & T_MOVEABLE) return; // dragging sprites: not used by PLAYER.SCR
    if ((s.f1 & F1_DIRECTIONAL) && (s.f1 & F1_ACTIVE)) { this.groups.clickStone(s); return; }
    if (s.f1 & F1_COMMAND) {
      if (!s.cur.m.click) this.postEvent(s.name, s.curTrigger ? s.curTrigger.name : 'CLICK');
      else this.switchMove(s, s.cur.m.atEnd);
      if (s.active) this.refresh(s);
    }
  }

  cursor(node: Node, _x: number, _y: number): number {
    const s = node.owner as Sprite;
    if (!s) return 0;
    if ((s.f1 & F1_DIRECTIONAL) && (s.f1 & F1_ACTIVE)) return 8;
    if (s.f1 & F1_COMMAND) return s.curTrigger ? s.curTrigger.mouseOver : s.cursor || 9;
    return 0;
  }

  // ---------------------------------------------------------------- events and walking

  /** An engine event for the script: a new thread running [item] #section (nothing when it does not exist). */
  postEvent(item: string, section: string) {
    this.g.vm.runNew(item, section, '');
  }

  /** FUN_0044c140: the sprite `name` is displaced so that its feet (x + frame centre, bottom) end up at (x, y). */
  walkTo(name: string, x: number, y: number) {
    const s = this.find(name);
    if (!s) return;
    const f = s.frame;
    if (!f) return;
    this.addPending(s, x - (s.x + f.bmp.center[0]), y - (s.y + s.h));
  }
}

