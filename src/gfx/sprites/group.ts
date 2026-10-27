// `Sprite Name=GROUP ...`: the stone puzzles (PIRANHA1 tree trunk, SPOOKSLOT3 gravestones) and the first-person maze (DH2), and the
// DIRECTIONAL walking of Pardoes between stones (docs/re/graphics.md D1.11; FUN_0044a710 / FUN_0044a374 / FUN_0044a4cc / FUN_0044b48d /
// FUN_0044b16f / FUN_0044b357 / FUN_0044b2a5 / FUN_0044c140 / FUN_004122e2 / FUN_00449ffa / FUN_0044a175 / FUN_00449f12 / FUN_00449c93).

import { Stmt } from '../../script/parse.ts';
import type { Thread } from '../../script/vm.ts';
import type { Cmd } from '../commands.ts';
import type { Sprites } from '../sprites.ts';
import type { Sprite } from './sprite.ts';
import { F1_ACTIVE, F1_DIRECTIONAL, type SpriteStmt } from './stmt.ts';

const COLS = 15, ROWS = 10;
const CX_DIRECTIONAL = 0x40, CX_DIR_START = 0x100;
/** View names of the maze tiles by relative wall mask (odd values), 16 = walked off the bottom, 17 = off the top (table at 0x474e40). */
const VIEWS = ['', 'D', '', 'L', '', 'V', '', 'TL', '', 'R', '', 'T', '', 'TR', '', 'K', 'START', 'END'];
const pad2 = (n: number) => String(n).padStart(2, '0');

export class Groups {
  private sp: Sprites;
  /** map[col][row]: 0..9 digits, -1 nothing, -2 start, -3 end (stone grids) or the 4-bit wall masks (maze). */
  private map: number[][] = [];
  private cell: (Sprite | null)[][] = [];
  /** GROUP BACKGROUND= prefix (item of the ENTER / CREATE events), the Move= and SFX= of the statement. */
  prefix = '';
  private moveName = '';
  private sfxName = '';
  private sinkSound = false;
  // maze
  private mazeCols = 0;
  private mazeRows = 0;
  private mx = 0;
  private my = 0;
  private facing = 0;

  constructor(sp: Sprites) {
    this.sp = sp;
    this.reset();
  }

  private reset() {
    this.map = Array.from({ length: COLS }, () => new Array<number>(ROWS).fill(-1));
    this.cell = Array.from({ length: COLS }, () => new Array<Sprite | null>(ROWS).fill(null));
  }

  /** GROUP statement (Type=CHANGE, FUN_0044a710). */
  exec(d: SpriteStmt, t: Thread) {
    this.reset();
    const g = this.sp.g;
    const file = g.vm.vars.sub(d.file);
    this.prefix = d.background;
    this.moveName = d.move;
    this.sfxName = d.sfx;
    if (d.move === 'MAPONLY') {
      this.mazeCols = d.start[0];
      this.mazeRows = d.start[1];
      this.loadMaze(file);
      this.mx = 0; this.my = this.mazeRows - 1; this.facing = 0;
      let x = 0;
      while (x < this.mazeCols && !((this.map[x]?.[this.my] ?? 0) & 1)) x++;
      this.mx = x;
      if (x !== this.mazeCols) this.view();
      return;
    }
    this.loadStones(file);
    this.assign(t);
    this.enter(null, -4);
  }

  // ---------------------------------------------------------------- stone grids

  /** FUN_0044a374 / FUN_0044a271: line = row, character = column; '0'..'9' value, 'E' -3, 'S' -2, 'X' -1; any other character leaves -1. */
  private loadStones(file: string) {
    const b = this.sp.g.dat.get(file);
    if (!b) { console.warn('bestand niet gevonden:', file); return; }
    const lines = new TextDecoder('latin1').decode(b).split('\n');
    for (let r = 0; r < lines.length && r < ROWS; r++) {
      const ln = lines[r];
      for (let c = 0; c < ln.length && c < COLS; c++) {
        const ch = ln[c];
        if (ch >= '0' && ch <= '9') this.map[c][r] = ch.charCodeAt(0) - 48;
        else if (ch === 'E') this.map[c][r] = -3;
        else if (ch === 'S') this.map[c][r] = -2;
        else if (ch === 'X') this.map[c][r] = -1;
      }
    }
  }

  /** FUN_0044a4cc: the sprites PREFIX01..PREFIX149 take the cells with a digit, row by row (missing numbers are skipped). */
  private assign(t: Thread) {
    let r = 0, c = 0;
    for (; r < ROWS; r++) {
      c = 0;
      while (c < COLS && this.map[c][r] < 0) c++;
      if (c !== COLS) break;
    }
    for (let n = 1; n <= 149; n++) {
      const s = this.sp.find(`${this.prefix}${pad2(n)}`);
      if (!s || r >= ROWS) continue;
      s.waiting = false;
      s.thread = t.id;
      s.waitThread = -1;
      s.done = false;
      this.cell[c][r] = s;
      c++;
      if (c === COLS) { c = 0; r++; }
      scan: for (; r !== ROWS; r++) {
        do {
          if (this.map[c][r] >= 0) break scan;
          c++;
        } while (c !== COLS);
        c = 0;
      }
    }
  }

  private command(name: string, enable: boolean) {
    const g = this.sp.g;
    const st = new Stmt('INSTRUCTION', [['TYPE', 'COMMAND'], ['TARGET', name], ['VALUE', enable ? 'ENABLE' : 'DISABLE']], 0);
    g.vm.instr.get('COMMAND')?.(st, null as unknown as Thread, g.vm);
  }

  /** FUN_0044b16f: a stone sprite gets / loses the "clickable now" flag, a start / end cell enables / disables its command. */
  private setCell(c: number, r: number, on: boolean): boolean {
    const s = this.cell[c][r];
    if (!s) {
      const v = this.map[c][r];
      if (v < -1) this.command(`${this.prefix}${v === -2 ? 'START' : 'END'}`, on);
      return false;
    }
    if (s.f1 & F1_DIRECTIONAL) {
      if (on) s.f1 |= F1_ACTIVE; else s.f1 &= ~F1_ACTIVE;
      return true;
    }
    return false;
  }

  /**
   * FUN_0044b48d(sprite, code): clear every flag, then enable the cell of `sprite` (or of every cell with value `code`: -2 start,
   * -3 end) and its 8 neighbours, sinking the unsafe (0) neighbour stones. Codes -4 / -6 only (re)enable the start / end command.
   * Returns true when a cell was found (a click on a stone fires ENTER).
   */
  enter(sprite: Sprite | null, code: number): boolean {
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) this.setCell(c, r, false);
    if (!sprite && code > -2) return false; // (never used: the first branch of the original scans for a standing stone)
    for (let r = 0; r < ROWS; r++) {
      let found = false;
      for (let c = 0; c < COLS; c++) {
        const matched = sprite ? this.cell[c][r] === sprite : this.map[c][r] === code;
        if (!matched) {
          if (!sprite && code === -4 && this.map[c][r] === -2) { this.setCell(c, r, true); found = true; }
          else if (!sprite && code === -6 && this.map[c][r] === -3) { this.setCell(c, r, true); found = true; }
          continue;
        }
        this.setCell(c, r, true);
        for (const [dc, dr] of NEIGH) {
          const cc = c + dc, rr = r + dr;
          if (cc >= 0 && cc < COLS && rr >= 0 && rr < ROWS) this.setCell(cc, rr, true);
        }
        this.sink(c, r);
        found = true;
        if (sprite) return true;
      }
      if (found) return true;
    }
    return false;
  }

  /** FUN_0044b357 / FUN_0044b2a5: unsafe (0) neighbour stones lose DIRECTIONAL and play the GROUP move; the first one plays the sound. */
  private sink(c: number, r: number) {
    this.sinkSound = true;
    for (const [dc, dr] of NEIGH) {
      const cc = c + dc, rr = r + dr;
      if (cc < 0 || cc >= COLS || rr < 0 || rr >= ROWS) continue;
      const s = this.cell[cc][rr];
      if (!s || this.map[cc][rr] !== 0 || !(s.f1 & F1_DIRECTIONAL)) continue;
      s.f1 &= ~F1_DIRECTIONAL;
      if (!this.sinkSound) this.sp.switchMove(s, this.moveName);
      else {
        this.sinkSound = false;
        this.sp.switchMove(s, this.moveName);
        this.sp.startSfx(s, this.sfxName, s.sfxVolume);
      }
    }
  }

  /** A click on an active stone (FUN_004123a5 case 7): ENTER on the GROUP item, then the AFFECT sprite walks to the stone. */
  clickStone(s: Sprite) {
    const found = this.enter(s, 0);
    if (found) this.sp.postEvent(this.prefix, 'ENTER');
    let x: number, y: number;
    if (s.affectRect[2] === 0) { x = s.x + Math.trunc(s.w / 2); y = s.y + Math.trunc(s.h / 2); }
    else { x = s.x + s.affectRect[0] + Math.trunc(s.affectRect[2] / 2); y = s.y + s.affectRect[1] + Math.trunc(s.affectRect[3] / 2); }
    this.sp.walkTo(s.affect, x, y);
  }

  /** DIRECTIONAL command (FUN_004122e2): enable the cells around the start / end cells, then walk to the middle of the command. */
  directional(c: Cmd) {
    if (!(c.extra & CX_DIRECTIONAL)) return;
    this.enter(null, c.extra & CX_DIR_START ? -2 : -3);
    const r = c.node?.rect ?? c.rect;
    this.sp.walkTo(c.affect, r.l + Math.trunc((r.r - r.l) / 2), r.t + Math.trunc((r.b - r.t) / 2));
  }

  // ---------------------------------------------------------------- maze

  /** FUN_00449ffa: whitespace separated ints, row-major, `cols` per row. */
  private loadMaze(file: string) {
    const b = this.sp.g.dat.get(file);
    if (!b) { console.warn('bestand niet gevonden:', file); return; }
    const vals = new TextDecoder('latin1').decode(b).split(/\s+/).filter(Boolean).map((v) => parseInt(v, 10));
    let c = 0, r = 0;
    for (const v of vals) {
      if (r >= this.mazeRows) break;
      if (c < COLS && r < ROWS) this.map[c][r] = v;
      c++;
      if (c >= this.mazeCols) { c = 0; r++; }
    }
  }

  /** FUN_00449f12: pick the tile view from the walls around the player, rotated by the facing, and fire [DH2_<view>] #CREATE. */
  private view() {
    let code: number;
    if (this.my < 0) code = 17;
    else if (this.my < this.mazeRows) {
      const v = (this.map[this.mx]?.[this.my] ?? 0) << (this.facing & 31);
      code = ((v & 0xf0) >> 4) | (v & 0xf);
    } else code = 16;
    this.sp.postEvent(`${this.prefix}${VIEWS[code] ?? ''}`, 'CREATE');
  }

  /** Instruction Sprite Value=PLAY Name=MAPONLY Contents=FORWARD|LEFT|RIGHT|BACK (FUN_00449c93; walls are not checked). */
  play(dir: string) {
    const d = dir === 'FORWARD' ? 0 : dir === 'LEFT' ? 1 : dir === 'RIGHT' ? 3 : dir === 'BACK' ? 2 : -1;
    if (d >= 0) {
      // relative direction -> absolute facing: 0 north (y-1), 1 west (x-1), 2 south (y+1), 3 east (x+1)
      const abs = (this.facing + d) & 3;
      if (abs === 0) this.my--;
      else if (abs === 1) this.mx--;
      else if (abs === 2) this.my++;
      else this.mx++;
      this.facing = abs;
    }
    this.view();
  }
}

const NEIGH: [number, number][] = [[-1, 0], [1, 0], [0, -1], [-1, -1], [1, -1], [0, 1], [-1, 1], [1, 1]];
