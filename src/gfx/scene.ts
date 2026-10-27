// The screen as PARDOES.EXE builds it (docs/re/graphics.md A.2/A.3, C.1/C.5): retained-mode composition with dirty
// rectangles and no clearing. Objects live in node lists: 10 levels + a foreground list (Level -1 / outside 0..9), one
// "DX" set for EXTRA=DXBLIT objects (always above everything else) and per screen level a "BG" set.
//
// Per frame: every pending dirty rect is re-rendered into the back buffer from the BG lists (levels 0..9, then FG, in list
// order), the rects are copied to the work surface, and if anything was copied all DX objects are blitted whole onto
// the work surface. The output is the work surface plus the held item and the software cursor.

import { Surface } from '../engine/surface.ts';

export const W = 640, H = 480;

/** l,t inclusive; r,b exclusive for drawing. */
export interface Rect { l: number; t: number; r: number; b: number }
export const rect = (l: number, t: number, r: number, b: number): Rect => ({ l, t, r, b });
export const SCREEN_RECT: Rect = rect(0, 0, W, H);

export const NODE_BITMAP = 1, NODE_COMMAND = 3, NODE_SPRITE = 7, NODE_TEKST = 6, NODE_EDITBOX = 9, NODE_SCREEN = 10;

export interface Node {
  type: number;
  name: string;
  /** 0..9, else the foreground list. */
  level: number;
  /** In the DX set (EXTRA=DXBLIT). */
  dx: boolean;
  /** Screen rect (hit rect: l <= x <= r, t <= y < b). */
  rect: Rect;
  /** Excluded from the world darkness (NOTINWORLD). */
  notInWorld?: boolean;
  /** BG pass: draw the part inside `clip` into the back buffer. */
  drawBG?(dst: Surface, clip: Rect): void;
  /** DX pass: draw the whole object onto the work surface (colour keyed). */
  drawDX?(dst: Surface): void;
  /** World darkness changed (percent 0..100). */
  darken?(pct: number): void;
  /** The owning object (bitmap, command, sprite ...). */
  owner: unknown;
}

const listIndex = (level: number) => (level >= 0 && level < 10 ? level : 10);
const newSet = () => Array.from({ length: 11 }, () => [] as Node[]);

export class Scene {
  readonly back = new Surface(W, H); // the 24-bit back buffer DIB (starts black)
  readonly work = new Surface(W, H); // the DirectDraw work surface
  readonly out = new Surface(W, H); // what is shown (work + held item + cursor)
  private dx = newSet();
  private bg = [newSet(), newSet(), newSet()];
  screenLevel = 0;
  private dirty: Rect[] = [rect(0, 0, W, H)];
  /** Dirty-rect accumulation switched off (movie playing, DXSCREEN active). */
  dirtyOff = false;
  /** World darkness in percent (Instruction OBJECT COLOR). */
  world = 0;
  /** Overlays drawn after composition: held item, cursor (set by the input layer). */
  overlays: ((s: Surface) => void)[] = [];
  /** Replaces the work -> output copy (DXSCREEN scroller draws its own frame). */
  presentHook: ((out: Surface) => void) | null = null;
  /** Once per presented frame (the `DX` sprite clock). */
  onFrame: (() => void) | null = null;
  /** A frame needs presenting. */
  changed = true;

  private set(n: Node) {
    return n.dx ? this.dx : this.bg[this.screenLevel];
  }

  /**
   * Register a node (FUN_004111e7/FUN_00411343): appended at the tail of its list; `head` inserts at the head (sprites
   * with EXTRA=BEFORE); `beforeCommands` inserts before the trailing run of Command nodes (DIRECTIONAL sprites).
   */
  add(n: Node, mode: 'tail' | 'head' | 'beforeCommands' = 'tail') {
    if (n.type === NODE_SCREEN && !n.dx) this.screenLevel = Math.min(2, this.screenLevel + 1);
    const list = this.set(n)[listIndex(n.level)];
    if (mode === 'head') list.unshift(n);
    else if (mode === 'beforeCommands') {
      let i = list.length;
      while (i > 0 && list[i - 1].type === NODE_COMMAND) i--;
      list.splice(i, 0, n);
    } else list.push(n);
  }

  remove(n: Node) {
    for (const set of [this.dx, ...this.bg]) {
      for (const list of set) {
        const i = list.indexOf(n);
        if (i >= 0) {
          list.splice(i, 1);
          if (n.type === NODE_SCREEN && !n.dx) this.screenLevel = Math.max(0, this.screenLevel - 1);
          return true;
        }
      }
    }
    return false;
  }

  /** Bring to front (FUN_00411615) / send to back (FUN_00411437) inside its own list. */
  toFront(n: Node) {
    if (this.remove(n)) this.add(n, 'tail');
  }
  toBack(n: Node) {
    if (this.remove(n)) this.add(n, 'head');
  }

  /** Re-file a node after its level changed. */
  relevel(n: Node, level: number) {
    this.remove(n);
    n.level = level;
    this.add(n);
  }

  /** First node with that name and type, in hit-test order (FUN_00411780). */
  find(name: string, type?: number): Node | null {
    for (const list of this.order()) for (let i = list.length - 1; i >= 0; i--) {
      const n = list[i];
      if (n.name === name && (type === undefined || n.type === type)) return n;
    }
    return null;
  }

  /** Lists in hit-test order (topmost first): DX FG, DX 9..0, BG FG, BG 9..0. */
  *order(): Generator<Node[]> {
    const lv = [10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0];
    for (const i of lv) yield this.dx[i];
    for (const i of lv) yield this.bg[this.screenLevel][i];
  }

  /** Every node (for darkness, debugging). */
  *all(): Generator<Node> {
    for (const l of this.dx) yield* l;
    for (const l of this.bg[this.screenLevel]) yield* l;
  }

  // ---------------------------------------------------------------- dirty rects (FUN_00450d63)

  invalidate(r: Rect | null = null) {
    this.changed = true;
    if (this.dirtyOff) return;
    if (!r) { this.dirty = [rect(0, 0, W, H)]; return; }
    const c = rect(Math.max(0, Math.min(r.l, r.r)), Math.max(0, Math.min(r.t, r.b)), Math.min(W, Math.max(r.l, r.r)), Math.min(H, Math.max(r.t, r.b)));
    if (c.r <= c.l || c.b <= c.t) return;
    for (let i = this.dirty.length - 1; i >= 0; i--) {
      const d = this.dirty[i];
      if (d.l <= c.l && d.t <= c.t && d.r >= c.r && d.b >= c.b) return; // contained
      if (c.l <= d.l && c.t <= d.t && c.r >= d.r && c.b >= d.b) this.dirty.splice(i, 1); // containing
    }
    if (this.dirty.length > 64) { this.dirty = [rect(0, 0, W, H)]; return; }
    this.dirty.push(c);
  }

  /** World darkness (Instruction OBJECT COLOR, FUN_00413c4b): every non-NOTINWORLD object, then a full repaint. */
  setWorld(pct: number) {
    if (pct === this.world) return;
    this.world = pct;
    for (const n of this.all()) if (!n.notInWorld) n.darken?.(pct);
    this.invalidate(null);
  }

  // ---------------------------------------------------------------- frame

  /** Compose: render dirty rects (BG), flush to work, DX pass, then the overlays. */
  compose(): Surface {
    this.onFrame?.();
    const rects = this.dirty;
    this.dirty = [];
    const bgSet = this.bg[this.screenLevel];
    for (const R of rects) {
      for (let li = 0; li <= 10; li++) for (const n of bgSet[li]) {
        if (!n.drawBG || n.rect.r <= R.l || n.rect.l >= R.r || n.rect.b <= R.t || n.rect.t >= R.b) continue;
        n.drawBG(this.back, R);
      }
    }
    for (const R of rects) copyRect(this.back, this.work, R);
    if (rects.length) for (let li = 0; li <= 10; li++) for (const n of this.dx[li]) n.drawDX?.(this.work);
    if (this.presentHook) this.presentHook(this.out);
    else this.out.px.set(this.work.px);
    for (const o of this.overlays) o(this.out);
    this.changed = false;
    return this.out;
  }
}

export function copyRect(src: Surface, dst: Surface, R: Rect) {
  const l = Math.max(0, R.l), r = Math.min(src.width, R.r);
  for (let y = Math.max(0, R.t); y < Math.min(src.height, R.b); y++) {
    const o = y * src.width;
    dst.px.set(src.px.subarray(o + l, o + r), o + l);
  }
}
