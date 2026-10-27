// Commands (click regions), input, hit testing and the software cursor (docs/re/graphics.md C.2-C.8).
// A Command's enabled flag and visual state live in its statement and survive KILL/re-create.

import { atoi, type Stmt } from '../script/parse.ts';
import type { Surface } from '../engine/surface.ts';
import { blitIndexed, blitKeyed } from './image.ts';
import { Gfx, BX_MOVEABLE, DX_BLIT, FX_PUZZLE, type Bm } from './gfx.ts';
import type { Bitmaps } from './bitmaps.ts';
import { NODE_BITMAP, NODE_COMMAND, NODE_EDITBOX, NODE_SCREEN, NODE_SPRITE, NODE_TEKST, rect, W, H, type Node, type Rect } from './scene.ts';

const CX_MUSTCLICK = 0x01, CX_ONOFF = 0x10, CX_NOCLEAR = 0x20, CX_DIRECTIONAL = 0x40;
const CEXTRA: Record<string, number> = { MUSTCLICK: 0x01, USESMASK: 0x02, TOSCREEN: 0x04, FOREGROUND: 0x08, ONOFF: 0x10, NOCLEAR: 0x20, DIRECTIONAL: 0x40, DIR_START: 0x100, DIR_END: 0x200 };
const KEYS: Record<string, string> = {
  ENTER: 'Enter', ESCAPE: 'Escape', DELETE: 'Delete', INSERT: 'Insert', HOME: 'Home', END: 'End', PAGEUP: 'PageUp', PAGEDOWN: 'PageDown',
  UP: 'ArrowUp', DOWN: 'ArrowDown', LEFT: 'ArrowLeft', RIGHT: 'ArrowRight', ADD: '+', DIVIDE: '/', MULTIPLY: '*', SUBTRACT: '-',
};
for (let i = 1; i <= 12; i++) KEYS[`F${i}`] = `F${i}`;
const HIT_LOCK = new Set(['PARDOES', 'RATTAR', 'CMDSCREEN', 'INVTFLES']);

/** A Command statement (its runtime state is persistent, C.2.2). */
export interface Cmd {
  name: string;
  stmt: Stmt;
  type: string;
  extra: number;
  dxf: number;
  level: number;
  rectText: string;
  rect: Rect;
  up: string; down: string; disabledImg: string;
  mouseover: number;
  key: string;
  affect: string;
  enabled: boolean;
  /** 0 none, 1 UP, 2 pressed, 4 toggled on. */
  visual: number;
  node: Node | null;
  active: boolean;
  order: number;
}

const CURSORS = ['MUISNORMAL', 'MUISNORMAL', 'MUISUP', 'MUISRIGHT', 'MUISDOWN', 'MUISLEFT', 'MUISAPPLY', 'MUISPICKUP', 'MUISGOTO', 'MUISCLICK', 'MUISHOLDING', 'MUISPUTDOWN'];
const HOLD_CURSORS: Record<number, string> = { 0: 'MUISNORMAL', 1: 'MUISHOLDING', 6: 'MUISPUTDOWN' };

export class Commands {
  private g: Gfx;
  private bm: Bitmaps;
  private cmds = new Map<string, Cmd>();
  private order = 0;
  // input state
  private pressed: Node | null = null;
  private pressPos: [number, number] = [0, 0];
  private hover: Node | null = null;
  private hoverName = '';
  private drag: { b: Bm; ax: number; ay: number } | null = null;
  cursorId = 1;
  /** A skippable wait is active (movie WAIT, FUN_00422453): clicks only skip it, hover is frozen. */
  waitActive: (() => boolean) | null = null;
  /** Skip it (FUN_004247af). */
  skip: (() => void) | null = null;
  /** The player-name edit box has focus: game clicks are ignored. */
  inputBlocked = false;

  constructor(g: Gfx, bm: Bitmaps) {
    this.g = g;
    this.bm = bm;
    g.vm.on('COMMAND', (st) => this.exec(st));
    g.vm.instr.set('COMMAND', (st) => this.instr(st));
    g.scene.overlays.push((s) => this.drawCursor(s));
  }

  // ---------------------------------------------------------------- statement (FUN_004169b0 / FUN_00417bb0)

  private def(st: Stmt): Cmd {
    const name = st.get('NAME');
    let c = this.cmds.get(name);
    if (c) return c; // one GLOBAL statement per name in PLAYER.SCR: it owns the persistent state
    let extra = 0, dxf = 0;
    for (const e of st.all('EXTRA')) {
      if (e in CEXTRA) extra |= CEXTRA[e];
      else if (e === 'DXBLIT') dxf |= 2;
      else if (e === 'DXKEEP') dxf |= 1;
      else if (e === 'NOTINWORLD') dxf |= 4;
    }
    const state = st.get('STATE');
    const r = st.nums('RECT', true);
    const rectText = st.all('RECT').find((v) => v === 'SCREEN' || v.startsWith('$')) ?? '';
    c = {
      name, stmt: st, type: st.get('TYPE') || 'GLOBAL', extra, dxf, level: st.has('LEVEL') ? atoi(st.get('LEVEL')) : 0, rectText,
      rect: rect(r[0] ?? 0, r[1] ?? 0, (r[0] ?? 0) + (r[2] ?? 0), (r[1] ?? 0) + (r[3] ?? 0)),
      up: st.get('UP'), down: st.get('DOWN'), disabledImg: st.get('DISABLED'), mouseover: atoi(st.get('MOUSEOVER')),
      key: KEYS[st.get('KEY')] ?? '', affect: st.get('AFFECT'),
      enabled: state !== 'DISABLED', visual: state === 'DISABLED' ? 0 : state === 'OFF' ? 4 : 1, node: null, active: false, order: 0,
    };
    this.cmds.set(name, c);
    return c;
  }

  private exec(st: Stmt) {
    if (st.get('TYPE') === 'KILL') { this.kill(st.get('NAME')); return; }
    const c = this.def(st);
    if (c.active && c.node) { this.g.scene.remove(c.node); c.node = null; }
    // rect (FUN_00417fb8): summed RECT, or SCREEN / $VAR
    let x = c.rect.l, y = c.rect.t, w = c.rect.r - c.rect.l, h = c.rect.b - c.rect.t;
    if (c.rectText === 'SCREEN') [x, y, w, h] = [0, 0, W, H];
    else if (c.rectText.startsWith('$')) [x, y, w, h] = Gfx.nums(this.g.vm.vars.get(c.rectText) ?? '');
    const r = rect(x < 0 ? -x : x, y < 0 ? -y : y, 0, 0);
    const img = this.image(c);
    r.r = r.l + (img?.img ? img.img.w : w);
    r.b = r.t + (img?.img ? img.img.h : h);
    c.active = true;
    c.order = ++this.order;
    const node: Node = {
      type: NODE_COMMAND, name: c.name, level: c.level, dx: !!(c.dxf & DX_BLIT), rect: r, owner: c, notInWorld: !!(c.dxf & 4),
      drawBG: (dst, clip) => { const b = this.image(c); if (b?.img) blitIndexed(dst, b.img, r.l, r.t, b.maskIndex, clip); },
      drawDX: (dst) => { const b = this.image(c); if (b?.img) blitKeyed(dst, b.img, r.l, r.t, b.key); },
    };
    c.node = node;
    this.g.scene.add(node);
    if (img) this.g.scene.invalidate(r);
  }

  /** Image for the command's current state (C.2.4). */
  private image(c: Cmd): Bm | null {
    let n = '';
    if (!c.enabled && c.disabledImg) n = c.disabledImg;
    else if (c.visual === 1) n = c.up;
    else if (c.visual === 2 || c.visual === 4) n = c.down;
    return n ? this.g.bitmap(n) : null;
  }

  private kill(name: string) {
    const c = this.cmds.get(name);
    if (!c || !c.active) return;
    if (c.node) {
      this.g.scene.remove(c.node);
      if (!(c.extra & CX_NOCLEAR) && this.image(c)) this.g.scene.invalidate(c.node.rect);
    }
    if (this.hover === c.node) this.hover = null;
    if (this.pressed === c.node) this.pressed = null;
    c.node = null;
    c.active = false;
  }

  private redraw(c: Cmd) {
    if (c.node && (c.up || c.disabledImg || c.down)) this.g.scene.invalidate(c.node.rect);
  }

  /** Instruction Type=COMMAND Target=<name> Value=... (FUN_00418718). */
  private instr(st: Stmt) {
    const vars = this.g.vm.vars;
    const target = vars.sub(st.get('TARGET'));
    if (st.get('VALUE') === 'KILL' && target === 'ALL') { for (const c of this.cmds.values()) this.kill(c.name); return; }
    const c = this.cmds.get(target);
    if (!c) return;
    switch (st.get('VALUE')) {
      case 'DISABLE': if (c.enabled) { c.enabled = false; if (!(c.extra & CX_ONOFF)) this.redraw(c); } break;
      case 'ENABLE': if (!c.enabled) { c.enabled = true; if (!(c.extra & CX_ONOFF)) this.redraw(c); } break;
      case 'SWITCH':
        if (c.extra & CX_ONOFF && c.enabled) c.visual = c.visual === 1 ? 4 : 1;
        this.redraw(c);
        break;
      case 'SELECT':
        if (c.extra & CX_ONOFF && c.enabled) { c.visual = atoi(vars.sub(st.get('CONTENTS'))) === 0 ? 1 : 4; this.redraw(c); }
        break;
      case 'UPDATE': this.redraw(c); break;
    }
  }

  // ---------------------------------------------------------------- hit test (FUN_00411f0f / FUN_0041201f)

  hit(x: number, y: number): Node | null {
    const g = this.g;
    let blocked = false;
    for (const list of g.scene.order()) {
      for (let i = list.length - 1; i >= 0; i--) {
        const n = list[i];
        if (n.type === NODE_SCREEN) break;
        if (g.objectDisabled && HIT_LOCK.has(n.name)) continue;
        const r = n.rect;
        if (x < r.l || x > r.r || y < r.t || y >= r.b) continue;
        switch (n.type) {
          case NODE_COMMAND: if ((n.owner as Cmd).enabled) return n; break;
          case NODE_TEKST: break;
          case NODE_EDITBOX: return n;
          case NODE_SPRITE: if (!blocked && g.sprites?.hit(n, x, y)) return n; break;
          case NODE_BITMAP: {
            const b = n.owner as Bm;
            const opaque = !!b.img && b.img.opaqueAt(x - b.rect.l, y - b.rect.t, b.maskIndex);
            if (b.extra & BX_MOVEABLE || b.fx === FX_PUZZLE) { if (opaque) return n; }
            else if (opaque) blocked = true;
            break;
          }
        }
      }
    }
    return null;
  }

  // ---------------------------------------------------------------- mouse (C.4 / C.6)

  private fire(item: string, section: string) {
    this.g.vm.runNew(item, section, '');
  }

  mouseDown(x: number, y: number, ctrlShift = false) {
    this.g.mouseX = x; this.g.mouseY = y;
    if (this.waitActive?.()) { this.skip?.(); this.g.vm.pump(); return; }
    if (this.inputBlocked) return;
    const vm = this.g.vm;
    const n = this.hit(x, y);
    this.pressed = n;
    this.pressPos = [x, y];
    if (!n) return;
    if (n.type === NODE_COMMAND) {
      const c = n.owner as Cmd;
      if (!(c.extra & CX_ONOFF)) { c.visual = 2; this.redraw(c); }
      if (!(c.extra & CX_MUSTCLICK)) this.release(x, y, x, y, ctrlShift);
      else {
        if (c.extra & CX_DIRECTIONAL) this.walk(c);
        this.fire(c.name, 'MOUSEDOWN');
      }
    } else if (n.type === NODE_BITMAP) {
      const b = n.owner as Bm;
      if (this.bm.isShift(b)) this.bm.pressShift(b, x, y);
      else if (b.extra & BX_MOVEABLE) { this.drag = { b, ax: x, ay: y }; this.g.scene.toFront(n); }
    } else if (n.type === NODE_SPRITE) this.g.sprites?.press(n, x, y);
    vm.pump();
  }

  mouseUp(x: number, y: number, ctrlShift = false) {
    this.g.mouseX = x; this.g.mouseY = y;
    if (this.drag) { const d = this.drag; this.drag = null; this.bm.drop(d.b); this.flyover(x, y); return; }
    const [px, py] = this.pressPos;
    this.release(px, py, x, y, ctrlShift);
    this.g.vm.pump();
  }

  /** FUN_004129dd */
  private release(px: number, py: number, x: number, y: number, ctrlShift: boolean) {
    const pn = this.pressed;
    this.pressed = null;
    if (!pn || pn.type !== NODE_COMMAND) return;
    const n1 = this.hit(px, py), n2 = this.hit(x, y);
    if (n1 !== pn) return;
    const c = pn.owner as Cmd;
    if (!c.enabled) return;
    if (!(c.extra & CX_ONOFF) && (c.visual === 1 || c.visual === 4)) return;
    if (c.visual === 2) { c.visual = 1; this.redraw(c); }
    if (c.extra & CX_DIRECTIONAL && !(c.extra & CX_MUSTCLICK)) this.walk(c);
    if (n1 === n2) {
      if (!(ctrlShift && this.g.vm.exists(c.name, 'CLICKHAHA') && this.g.vm.runNew(c.name, 'CLICKHAHA', '') >= 0)) this.fire(c.name, 'CLICK');
    } else this.fire(c.name, 'MOUSEUP');
  }

  /** DIRECTIONAL commands make the AFFECT sprite walk (sprite engine). */
  private walk(c: Cmd) {
    this.onDirectional?.(c);
  }
  onDirectional: ((c: Cmd) => void) | null = null;

  mouseMove(x: number, y: number) {
    this.g.mouseX = x; this.g.mouseY = y;
    this.g.scene.changed = true;
    if (this.drag) {
      const d = this.drag;
      this.bm.moveBy(d.b, x - d.ax, y - d.ay);
      d.ax = x; d.ay = y;
      return;
    }
    if (this.waitActive?.()) return;
    this.flyover(x, y);
    this.g.vm.pump();
  }

  /** FUN_00411b1e: cursor + FLYOVER on every move over a command, ENDFLYOVER when the hovered node changes. */
  private flyover(x: number, y: number) {
    this.setCursor(1);
    const n = this.hit(x, y);
    if (this.hover && n !== this.hover && this.hoverName) this.fire(this.hoverName, 'ENDFLYOVER');
    this.hover = n;
    if (!n) return;
    this.hoverName = n.name;
    if (n.type === NODE_COMMAND) {
      const c = n.owner as Cmd;
      if (!c.enabled || c.visual === 2) { this.hover = null; return; }
      if (c.type === 'GLOBAL') {
        if (c.mouseover) this.setCursor(c.mouseover);
        this.fire(c.name, 'FLYOVER');
      }
    } else if (n.type === NODE_BITMAP) {
      const b = n.owner as Bm;
      if (b.extra & BX_MOVEABLE || b.fx === FX_PUZZLE) this.setCursor(9);
    } else if (n.type === NODE_SPRITE) {
      const id = this.g.sprites?.cursor(n, x, y) ?? 0;
      if (id) this.setCursor(id);
    }
  }

  /** Re-run the hover logic without moving (after a scene change). */
  refreshHover() {
    this.flyover(this.g.mouseX, this.g.mouseY);
  }

  keyDown(key: string) {
    if (this.waitActive?.()) this.skip?.(); // the key also reaches the key commands
    // FUN_00418baa: the first activated command with that key, ignoring enabled/rect
    let best: Cmd | null = null;
    for (const c of this.cmds.values()) if (c.active && c.key && c.key === key && (!best || c.order < best.order)) best = c;
    if (best) { this.fire(best.name, 'CLICK'); this.g.vm.pump(); }
  }

  // ---------------------------------------------------------------- cursor (C.8)

  setCursor(id: number) {
    this.cursorId = id;
    this.g.scene.changed = true;
  }

  private drawCursor(out: Surface) {
    const g = this.g;
    if (this.hideCursor) return;
    if (g.holding) g.sprites?.drawHeld(out, g.mouseX, g.mouseY);
    const name = g.holding ? HOLD_CURSORS[this.cursorId] ?? CURSORS[this.cursorId] : CURSORS[this.cursorId] ?? CURSORS[1];
    const b = g.bitmap(name ?? 'MUISNORMAL');
    if (!b?.img) return;
    blitKeyed(out, b.img, g.mouseX - b.home[0], g.mouseY - b.home[1], b.key);
  }
  hideCursor = false;
}
