// The script machine (docs/re/script-core.md s5-s8): up to 30 cooperative threads, one instruction per scheduler turn,
// served FIFO like the original's WM_USER+100 messages. GOSUB pushes a frame in the same thread, RUN starts a new thread.
// A runnable chain runs to quiescence before the next input event, timer tick or frame (pump()).
// Statement kinds are handled by registered handlers (core ones here, graphics/sound in their own modules).

import { atoi, findSeq, type Program, type Seq, type Stmt } from './parse.ts';
import { Vars } from './vars.ts';

/** cont: next instruction on the next turn; retry: run this instruction again when resumed; block: done, wait for resume. */
export type Result = 'cont' | 'retry' | 'block';
export type Handler = (st: Stmt, t: Thread, vm: Vm) => Result | void;

interface Frame { seq: Seq; idx: number; ptr: number }

export class Thread {
  readonly id: number;
  frames: Frame[] = [];
  active = true;
  waiting = false;
  notify = -1;
  readonly triple: [string, string, string];
  constructor(id: number, triple: [string, string, string]) {
    this.id = id;
    this.triple = triple;
  }
}

interface TimerSlot {
  name: string;
  period: number;
  enabled: boolean;
  next: number;
  item: string; section: string; seq: string;
  waitThread: number;
}

const MAX_THREADS = 30;
const MAX_TIMERS = 20;

export class Vm {
  readonly prog: Program;
  readonly vars: Vars;
  private threads: (Thread | null)[] = new Array(MAX_THREADS).fill(null);
  private queue: number[] = [];
  private handlers = new Map<string, Handler>();
  /** `Instruction Type=X` handlers by type keyword (GOSUB, SPRITE, ...). */
  readonly instr = new Map<string, Handler>();
  /** Clocks ticked by timers without a script target (sprite animation clocks, by timer name). */
  onClock: ((name: string) => void) | null = null;
  /** Thread waiting in Instruction SFX WAIT (one global id, polled on every enabled timer tick). */
  soundWaitThread = -1;
  /** Last RUN target (FUN_0041341b): the "current item" for ITEM/ACTION commands. */
  lastRun: [string, string, string] = ['', '', ''];
  /** Called after a pump ran instructions (repaint). */
  onIdle: (() => void) | null = null;
  trace: ((t: Thread, st: Stmt) => void) | null = null;
  quit: (() => void) | null = null;

  constructor(prog: Program) {
    this.prog = prog;
    this.vars = new Vars(prog.decls);
    this.handlers.set('SET', setStmt);
    this.handlers.set('IF', ifStmt);
    this.handlers.set('INSTRUCTION', (st, t, vm) => {
      const type = st.get('TYPE');
      const h = vm.instr.get(type);
      return h ? h(st, t, vm) : 'cont';
    });
    this.handlers.set('TIMER', timerStmt);
    this.handlers.set('EXIT', (_st, _t, vm) => { vm.quit?.(); return 'block'; });
    this.instr.set('GOSUB', (st, t, vm) => { vm.gosub(t, vm.vars.sub(st.get('NAME')), vm.vars.sub(st.get('TARGET')), vm.vars.sub(st.get('CONTENTS'))); });
    this.instr.set('RUN', (st, _t, vm) => {
      const it = vm.vars.sub(st.get('NAME')), sec = vm.vars.sub(st.get('TARGET')), sq = vm.vars.sub(st.get('CONTENTS'));
      vm.runNew(it, sec, sq, { unique: atoi(st.get('VALUE')) !== 0 });
    });
    this.instr.set('RUNRANDOM', randomInstr(false));
    this.instr.set('SUBRANDOM', randomInstr(true));
    this.instr.set('WAIT', waitInstr);
    this.instr.set('USES', () => 'cont');
    this.instr.set('SCRIPT', () => 'cont'); // only DEBUG dumps in PLAYER.SCR
  }

  on(kw: string, h: Handler) {
    this.handlers.set(kw, h);
  }

  // ---------------------------------------------------------------- threads

  private alloc(triple: [string, string, string]): Thread | null {
    const i = this.threads.findIndex((t) => !t || !t.active);
    if (i < 0) return null;
    const t = new Thread(i, triple);
    this.threads[i] = t;
    return t;
  }

  /** RUN (FUN_004019f3): a new thread; -1 when the target does not exist / is empty / no slot is free. */
  runNew(item: string, section: string, seq: string, opts: { unique?: boolean } = {}): number {
    if (opts.unique && this.threads.some((t) => t?.active && t.triple[0] === item && t.triple[1] === section && t.triple[2] === seq)) return -1;
    const s = findSeq(this.prog, item, section, seq);
    if (!s) return -1;
    const t = this.alloc([item, section, seq]);
    if (!t) return -1;
    t.frames.push({ seq: s, idx: 0, ptr: 0 });
    this.lastRun = [item, section, seq];
    this.queue.push(t.id);
    return t.id;
  }

  /** Does a script section exist (for engine events that check first)? */
  exists(item: string, section: string, seq = ''): boolean {
    return findSeq(this.prog, item, section, seq) !== null;
  }

  /** GOSUB (FUN_00401a7b): synchronous call in the same thread; a failed call reproduces the original's frame drift. */
  gosub(t: Thread, item: string, section: string, seq: string): boolean {
    const s = findSeq(this.prog, item, section, seq);
    if (s) { t.frames.push({ seq: s, idx: 0, ptr: 0 }); return true; }
    this.popUp(t, false); // the child that could not start is torn down: parent.idx += 1 (the caller loses its last instruction)
    return false;
  }

  /** FUN_004018c1: drop the deepest frame (unless `dropFirst` is false), advance the parent, repeat while it is past its end. */
  private popUp(t: Thread, dropFirst = true): Frame | null {
    if (dropFirst) t.frames.pop();
    for (;;) {
      const p = t.frames[t.frames.length - 1];
      if (!p) return null;
      p.idx++;
      if (p.idx <= p.seq.stmts.length) return p;
      t.frames.pop();
    }
  }

  /** Wake a blocked thread (sprite/movie/sound finished, timer, click on a wait). */
  resume(tid: number) {
    const t = this.threads[tid];
    if (!t || !t.active || !t.waiting) return;
    t.waiting = false;
    this.queue.push(tid);
  }

  /** Terminate a thread without notifying anyone (FUN_00404557: a CHANGE takes over a sprite another thread is waiting on). */
  killThread(tid: number) {
    const t = this.threads[tid];
    if (!t || !t.active) return;
    t.active = false;
    t.waiting = false;
    t.frames.length = 0;
  }

  private finish(t: Thread) {
    t.active = false;
    if (t.notify >= 0) this.resume(t.notify);
  }

  private step(tid: number) {
    const t = this.threads[tid];
    if (!t || !t.active) return;
    t.waiting = false;
    let f = t.frames[t.frames.length - 1];
    if (!f) { this.finish(t); return; }
    f.idx++;
    if (f.seq.stmts.length < f.idx) {
      t.frames.pop();
      const p = this.popUp(t, false);
      if (!p) { this.finish(t); return; }
      f = p; // FUN_004018c1 advanced the parent; it runs its next instruction in this same step

    }
    const st = f.seq.stmts[f.ptr];
    if (!st) { t.frames.length = 0; this.finish(t); return; }
    this.trace?.(t, st);
    const h = this.handlers.get(st.kw);
    let r: Result | void = 'cont';
    try {
      r = h ? h(st, t, this) : 'cont';
    } catch (e) {
      console.error(`script line ${st.line}`, e);
    }
    if (r === 'retry') { f.idx--; t.waiting = true; return; }
    f.ptr++;
    if (r === 'block') { t.waiting = true; return; }
    this.queue.push(t.id);
  }

  private pumping = false;
  /** Run every runnable thread until all are blocked or finished. */
  pump() {
    if (this.pumping) return;
    this.pumping = true;
    let n = 0;
    try {
      while (this.queue.length) {
        this.step(this.queue.shift()!);
        if (++n > 200000) { console.warn('script: >200000 steps without rest; continuing later'); setTimeout(() => this.pump(), 0); break; }
      }
    } finally {
      this.pumping = false;
    }
    if (n) this.onIdle?.();
  }

  /** Raise an engine event: RUN [item] #section (if it exists), then pump. */
  event(item: string, section: string): boolean {
    const id = this.runNew(item, section, '');
    this.pump();
    return id >= 0;
  }

  threadInfo() {
    return this.threads.filter((t): t is Thread => !!t?.active).map((t) => ({ id: t.id, triple: t.triple.join('/'), waiting: t.waiting, depth: t.frames.length }));
  }

  // ---------------------------------------------------------------- timers (s8)

  readonly timers = new Map<string, TimerSlot>();
  private timerOrder: string[] = [];

  timerStatic(name: string, period: number, item = '', section = '', seq = ''): boolean {
    if (this.timers.has(name)) return false; // re-issuing Static does nothing
    if (this.timers.size >= MAX_TIMERS) { console.warn('script: max. 20 timers'); return false; }
    this.timers.set(name, { name, period: Math.max(1, period), enabled: true, next: performance.now() + period, item, section, seq, waitThread: -1 });
    this.timerOrder.push(name);
    return true;
  }
  timerKill(name: string) {
    this.timers.delete(name);
    this.timerOrder = this.timerOrder.filter((n) => n !== name);
  }
  timerEnable(name: string, on: boolean) {
    const s = this.timers.get(name);
    if (s) s.enabled = on;
  }

  /** Fire due timers (WM_TIMER coalesces: at most one tick per timer per call). */
  tickTimers(now = performance.now()) {
    for (const name of [...this.timerOrder]) {
      const s = this.timers.get(name);
      if (!s || now < s.next) continue;
      s.next = now + s.period;
      if (!s.enabled) continue;
      if (this.soundWaitThread >= 0) this.resume(this.soundWaitThread);
      if (s.item) this.runNew(s.item, s.section, s.seq);
      else if (s.waitThread < 0) this.onClock?.(s.name);
      else { const w = s.waitThread; this.timerKill(name); this.resume(w); }
      this.pump();
    }
  }

  /** One-shot wait timer for Instruction WAIT (MODIFIER<tid>). */
  sleep(t: Thread, ms: number) {
    const name = `MODIFIER${t.id}`;
    if (this.timers.has(name)) return;
    this.timerStatic(name, ms);
    this.timers.get(name)!.waitThread = t.id;
  }
}

// ------------------------------------------------------------------ core statements

function setStmt(st: Stmt, _t: Thread, vm: Vm) {
  for (const [k, v] of st.kv) vm.vars.assign(k, vm.vars.expand(v));
}

const IF_KEYS = new Set(['ITEM', 'SECTION', 'SEQUENCE', 'NAME', 'TYPE', 'COMPARE', 'OPERATOR', 'COUNT', 'EXTRA']);

function ifStmt(st: Stmt, t: Thread, vm: Vm) {
  if (st.get('TYPE') === 'KILL') return;
  let l = '', r = '';
  for (const [k, v] of st.kv) if (!IF_KEYS.has(k)) { l = k; r = v; }
  const L = vm.vars.sub(l), R = vm.vars.sub(r);
  const cmp = st.get('COMPARE') || 'RTOL';
  const op = st.get('OPERATOR') || 'EQUAL';
  let ok = false;
  if (cmp === 'EXACT') {
    switch (op) {
      case 'NOT': ok = L !== R; break;
      case 'GT': ok = atoi(L) > atoi(R); break;
      case 'GTE': ok = atoi(L) >= atoi(R); break;
      case 'LT': ok = atoi(L) < atoi(R); break;
      case 'LTE': ok = atoi(L) <= atoi(R); break;
      default: ok = L === R;
    }
  } else if (cmp === 'LTOR') {
    const n = atoi(st.get('COUNT'));
    const eq = n <= 0 || L.slice(0, n) === R.slice(0, n);
    ok = op === 'NOT' ? !eq : op === 'EQUAL' || !['GT', 'GTE', 'LT', 'LTE'].includes(op) ? eq : false;
  } else { // RTOL: compare the common suffix
    const n = Math.min(L.length, R.length);
    const eq = L.slice(L.length - n) === R.slice(R.length - n);
    ok = op === 'NOT' ? !eq : ['GT', 'GTE', 'LT', 'LTE'].includes(op) ? false : eq;
  }
  if (!ok) return;
  const it = vm.vars.sub(st.get('ITEM')), sec = vm.vars.sub(st.get('SECTION')), sq = vm.vars.sub(st.get('SEQUENCE'));
  if (st.get('EXTRA') === 'GOSUB') vm.gosub(t, it, sec, sq);
  else vm.runNew(it, sec, sq);
}

function timerStmt(st: Stmt, _t: Thread, vm: Vm) {
  const name = st.get('NAME');
  switch (st.get('TYPE')) {
    case 'KILL': vm.timerKill(name); return;
    case 'DISABLE': vm.timerEnable(name, false); return;
    case 'ENABLE': vm.timerEnable(name, true); return;
  }
  // STATIC (default): Interval is resolved at parse time in the original; the declarations precede every use
  let interval = st.has('INTERVAL') ? atoi(vm.vars.sub(st.get('INTERVAL'))) : 1000;
  const v = st.get('VARIABLE');
  if (v) interval = atoi(vm.vars.get(v) ?? '0');
  const mult = st.has('MULTIPLIER') ? atoi(st.get('MULTIPLIER')) : 1;
  vm.timerStatic(name, interval * mult, st.get('ITEM'), st.get('SECTION'), st.get('SEQUENCE'));
}

// RUNRANDOM / SUBRANDOM (s5.3.3): never the same number twice in a row per Target (kept in localStorage)
const lastRandom: Record<string, number> = (() => {
  try { return JSON.parse(localStorage.getItem('pardoes-randomizer') ?? '{}'); } catch { return {}; }
})();
const rand1 = (n: number) => 1 + Math.floor(Math.random() * n);

function randomInstr(sub: boolean): Handler {
  return (st, t, vm) => {
    const target = vm.vars.sub(st.get('TARGET'));
    let contents = vm.vars.sub(st.get('CONTENTS'));
    let n = atoi(st.get('VALUE'));
    if (n === 0) { n = atoi(contents); contents = ''; }
    const last = lastRandom[target] ?? 0;
    let r: number;
    if (n < 2) r = 1;
    else if (n === 2) r = last > 0 ? (last === 1 ? 2 : 1) : rand1(2);
    else do r = rand1(n); while (r === last);
    r = Math.min(r, n);
    if (r < 1) r = n;
    lastRandom[target] = r;
    try { localStorage.setItem('pardoes-randomizer', JSON.stringify(lastRandom)); } catch { /* private mode */ }
    const item = vm.vars.sub(st.get('NAME'));
    if (sub) vm.gosub(t, item, target + r, contents);
    else vm.runNew(item, target + r, contents);
  };
}

function waitInstr(st: Stmt, t: Thread, vm: Vm): Result {
  const v = atoi(st.get('VALUE'));
  if (v > 0) { vm.sleep(t, v); return 'block'; }
  if (v < 0) { vm.sleep(t, -v); return 'block'; } // the original busy-waits (freezing everything); unused
  return 'block'; // Value=0: next click/key (unused in PLAYER.SCR)
}
