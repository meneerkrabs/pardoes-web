// Movie, Style, Tekst and EditBox statements (docs/re/graphics.md E.1, docs/re/script-core.md s9).

import { atoi, type Stmt } from '../script/parse.ts';
import type { Result, Thread } from '../script/vm.ts';
import { Surface, type FontSpec } from '../engine/surface.ts';
import { playMovie, type MoviePlayback } from '../engine/movie.ts';
import type { Display } from '../engine/vcl.ts';
import type { GameFiles } from '../files.ts';
import { Gfx } from './gfx.ts';
import type { Commands } from './commands.ts';
import { NODE_EDITBOX, NODE_TEKST, rect, W, H, type Node, type Rect } from './scene.ts';

interface MovieObj { name: string; pb: MoviePlayback; waiter: number; rect: Rect }

export class Media {
  private g: Gfx;
  private files: GameFiles;
  private display: Display;
  private cmds: Commands;
  /** The movie picture (drawn instead of the scene while a movie plays). */
  readonly movieSurface = new Surface(W, H);
  private movies = new Map<string, MovieObj>();
  private styles = new Map<string, FontSpec>();
  private texts = new Map<string, { node: Node; contents: string }>();
  private edits = new Map<string, HTMLInputElement>();

  constructor(g: Gfx, files: GameFiles, display: Display, cmds: Commands) {
    this.g = g;
    this.files = files;
    this.display = display;
    this.cmds = cmds;
    for (const st of g.vm.prog.styles) this.style(st);
    g.vm.on('MOVIE', (st, t) => this.movie(st, t));
    g.vm.on('TEKST', (st) => this.tekst(st));
    g.vm.on('EDITBOX', (st) => this.editbox(st));
    cmds.waitActive = () => [...this.movies.values()].some((m) => m.waiter >= 0);
    cmds.skip = () => { for (const m of [...this.movies.values()]) if (m.waiter >= 0) this.kill(m.name); };
  }

  /** A movie is on screen (the compositor is suspended). */
  get playing(): boolean {
    return this.movies.size > 0;
  }

  // ---------------------------------------------------------------- Movie (E.1)

  private movie(st: Stmt, t: Thread): Result {
    const name = st.get('NAME');
    switch (st.get('TYPE')) {
      case 'PLAY': {
        if (this.movies.has(name)) this.kill(name);
        const file = st.get('FILE').replace(/\\/g, '/').split('/').pop()!;
        const [x, y, w, h] = Gfx.nums(st.get('RECT'));
        const obj: MovieObj = { name, waiter: -1, rect: rect(x, y, w || W, h || H), pb: null as unknown as MoviePlayback };
        this.movies.set(name, obj);
        this.movieSurface.fillRect(0, 0, W, H, 0);
        this.g.scene.dirtyOff = true;
        const stream = new ReadableStream<Uint8Array>({
          start: async (ctl) => {
            const m = await this.files.media(file);
            if (!m) { ctl.close(); return; }
            const r = m.stream().getReader();
            for (;;) {
              const { done, value } = await r.read().catch(() => ({ done: true, value: undefined }));
              if (done || !value) break;
              ctl.enqueue(value);
            }
            ctl.close();
          },
        });
        obj.pb = playMovie(stream, this.movieSurface, x, y, { volume: atoi(st.get('VOLUME')), onFrame: () => (this.g.scene.changed = true) });
        void obj.pb.done.then(() => { if (this.movies.get(name) === obj) this.kill(name); });
        return 'cont';
      }
      case 'WAIT': {
        const m = this.movies.get(name);
        if (!m) return 'cont';
        m.waiter = t.id;
        return 'retry';
      }
      case 'PAUSE': return 'cont';
      default: this.kill(name); return 'cont'; // KILL (also the default)
    }
  }

  private kill(name: string) {
    const m = this.movies.get(name);
    if (!m) return;
    this.movies.delete(name);
    m.pb.stop();
    if (!this.movies.size) {
      this.g.scene.dirtyOff = false;
      this.g.scene.invalidate(m.rect);
    }
    if (m.waiter >= 0) { this.g.vm.resume(m.waiter); this.g.vm.pump(); }
  }

  // ---------------------------------------------------------------- Style / Tekst / EditBox (s9)

  private style(st: Stmt) {
    const face = st.get('FACENAME').replace(/_/g, ' ');
    const base = st.get('BASE');
    const name = face ? face.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()) : base === 'SWISS' ? 'Arial' : 'Times New Roman';
    const [r, g, b] = Gfx.nums(st.get('COLOR'));
    this.styles.set(st.get('NAME'), {
      name, px: st.has('H') ? atoi(st.get('H')) : 14, bold: (st.has('W') ? atoi(st.get('W')) : 400) >= 600,
      italic: st.has('ITALIC'), underline: st.has('UNDERLINE'), color: (b << 16) | (g << 8) | r,
    });
  }

  private font(st: Stmt): FontSpec {
    const f = this.styles.get(st.get('STYLE')) ?? this.styles.values().next().value ?? { name: 'Arial', px: 14, color: 0 };
    const c = st.get('COLOR');
    if (c && c !== '0,0,0') { const [r, g, b] = Gfx.nums(c); return { ...f, color: (b << 16) | (g << 8) | r }; }
    return f;
  }

  private tekst(st: Stmt) {
    const name = st.get('NAME');
    const old = this.texts.get(name);
    if (old) { this.g.scene.remove(old.node); this.g.scene.invalidate(old.node.rect); this.texts.delete(name); }
    const type = st.get('TYPE') || 'SINGLE';
    if (type === 'KILL') return;
    let [x1, y1, x2, y2] = Gfx.nums(st.get('RECT'));
    if (x2 < x1) x2 = x1 + 20;
    if (y2 < y1) y2 = y1 + 20;
    const font = this.font(st);
    const align = st.get('ALIGN') || 'LEFTTOP';
    const contents = st.get('CONTENTS');
    const vars = this.g.vm.vars;
    const node: Node = {
      type: NODE_TEKST, name, level: st.has('LEVEL') ? atoi(st.get('LEVEL')) : 0, dx: false, rect: rect(x1, y1, x2, y2), owner: null,
      drawBG: (dst) => {
        const text = contents.startsWith('$') ? vars.get(contents) ?? '' : contents;
        if (!text) return;
        const hi = Surface.hiResText;
        Surface.hiResText = false; // rasterise into the pixels (the text layer of the Display is not used here)
        const m = dst.textOut(-10000, -10000, text, font);
        const tx = align.includes('RIGHT') && !align.startsWith('LEFT') ? x2 - m.w : align.startsWith('CENTER') ? (x1 + x2 - m.w) / 2 : x1;
        const ty = align.endsWith('BOTTOM') ? y2 - m.h : align.endsWith('CENTER') ? (y1 + y2 - m.h) / 2 : y1;
        dst.textOut(Math.round(tx), Math.round(ty), text, font);
        Surface.hiResText = hi;
      },
    };
    this.texts.set(name, { node, contents });
    this.g.scene.add(node);
    this.g.scene.invalidate(node.rect);
  }

  private editbox(st: Stmt) {
    const name = st.get('NAME');
    const type = st.get('TYPE') || 'UPDATE';
    const vars = this.g.vm.vars;
    const target = st.get('COPYTARGET');
    if (type === 'KILL') {
      this.edits.get(name)?.remove();
      this.edits.delete(name);
      this.cmds.inputBlocked = false;
      return;
    }
    if (type !== 'CREATE') return;
    this.edits.get(name)?.remove();
    const [x, y, w, h] = Gfx.nums(st.get('RECT'));
    const f = this.font(st);
    const el = document.createElement('input');
    el.type = 'text';
    el.className = 'pd-edit';
    el.maxLength = st.has('MAXLEN') ? atoi(st.get('MAXLEN')) : 255;
    el.spellcheck = false;
    el.autocomplete = 'off';
    el.value = vars.get(target) ?? '';
    const col = `rgb(${f.color & 255},${(f.color >> 8) & 255},${(f.color >> 16) & 255})`;
    Object.assign(el.style, { background: 'transparent', border: 'none', outline: 'none', color: col, fontFamily: `"${f.name}", Arial, sans-serif`, fontWeight: f.bold ? '600' : '400', padding: '0', caretColor: col });
    const sizeFont = () => { el.style.fontSize = `${(f.px * el.getBoundingClientRect().height) / Math.max(1, h)}px`; };
    el.oninput = () => { vars.setLiteral(target, el.value); };
    el.onkeydown = (e) => {
      if (e.key === 'Enter' || e.key === 'Escape') { e.preventDefault(); this.cmds.keyDown(e.key); }
      e.stopPropagation();
    };
    el.onpointerdown = (e) => e.stopPropagation();
    this.display.attachControl(el, x, y, w, h);
    requestAnimationFrame(sizeFont);
    addEventListener('resize', sizeFont);
    this.edits.set(name, el);
    setTimeout(() => el.focus(), 0);
    const node: Node = { type: NODE_EDITBOX, name, level: 0, dx: false, rect: rect(x, y, x + w, y + h), owner: el };
    void node;
  }
}
