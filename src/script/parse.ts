// PLAYER.SCR parser, after PARDOES.EXE (docs/re/script-core.md s2-s3): the whole line is upper-cased, classified by a
// strncmp prefix list (no match = the line is ignored: that is how "/", "a", "q", "rjh" lines are disabled), split on
// blanks into key=value tokens, and filed into [ITEM] / #SECTION / @SEQUENCE. Names are cut to 19 characters.

/** Statement keywords in the EXE's test order (FUN_00415f71) with the compared length. */
const PREFIXES: [string, number][] = [
  ['[', 1], ['#', 1], ['@', 1], ['SET', 3], ['STYLE', 5], ['BITMAP', 6], ['COMMAND', 7], ['EXIT', 7], ['AREA', 4],
  ['FLYOVER', 7], ['TEKST', 5], ['INSTRUCTION', 11], ['INSTALL', 7], ['QUIZ', 4], ['PUZJAPANS', 9], ['DXSCREEN', 8],
  ['EXECUTE', 7], ['MOVIE', 5], ['SFX', 3], ['CDAUDIO', 7], ['WAVE', 4], ['MIDI', 4], ['SPRITE', 6], ['TIMER', 5],
  ['TIMELINE', 8], ['IF', 2], ['LISTBOX', 7], ['EDITBOX', 7], ['MESSAGE', 7],
];

/** strncmp(line, prefix, n) == 0 (a shorter line compares its terminating NUL). */
function prefixIs(line: string, p: string, n: number): boolean {
  for (let i = 0; i < n; i++) {
    const a = i < line.length ? line[i] : '\0', b = i < p.length ? p[i] : '\0';
    if (a !== b) return false;
    if (a === '\0') return true;
  }
  return true;
}

export function classify(line: string): string | null {
  for (const [p, n] of PREFIXES) if (prefixIs(line, p, n)) return p;
  return null;
}

export const NAME_MAX = 19;
export const cut = (s: string) => s.slice(0, NAME_MAX);

/** One statement: keyword and its key=value tokens in order (keys and values upper-cased). */
export class Stmt {
  readonly kw: string;
  readonly kv: [string, string][];
  readonly line: number;
  /** Parsed form cached by the statement's handler. */
  cache: unknown = undefined;
  constructor(kw: string, kv: [string, string][], line: number) {
    this.kw = kw;
    this.kv = kv;
    this.line = line;
  }
  /** Last value of a key ('' when absent). */
  get(key: string): string {
    let v = '';
    for (const [k, val] of this.kv) if (k === key) v = val;
    return v;
  }
  has(key: string): boolean {
    return this.kv.some(([k]) => k === key);
  }
  /** Every value of a repeated key (EXTRA= flags). */
  all(key: string): string[] {
    return this.kv.filter(([k]) => k === key).map(([, v]) => v);
  }
  /** Comma separated numbers; repeated keys add up component-wise (Rect on Tekst/EditBox/Command). */
  nums(key: string, accumulate = false): number[] {
    const vals = accumulate ? this.all(key) : this.has(key) ? [this.get(key)] : [];
    const out: number[] = [];
    for (const v of vals) v.split(',').forEach((s, i) => (out[i] = (out[i] ?? 0) + atoi(s)));
    return out;
  }
}

export interface Seq { name: string; stmts: Stmt[] }
export interface Section { name: string; seqs: Seq[] }
export interface Item { name: string; sections: Section[] }

export interface Program {
  items: Item[];
  /** First item of each name (later duplicates are dead code, FUN_004011ac). */
  byName: Map<string, Item>;
  /** Variables in declaration order: name -> raw value of the first Set (s4.1). */
  decls: Map<string, string>;
  /** Style records (parse time, global). */
  styles: Stmt[];
}

/** C atoi: leading blanks, optional sign, digits; anything else = 0. */
export function atoi(s: string): number {
  const m = /^\s*([+-]?)(\d+)/.exec(s);
  if (!m) return 0;
  const v = parseInt(m[2], 10);
  return m[1] === '-' ? -v : v;
}

/** A token split at the first '=' (or blank): the value restarts after every further '=' (FUN_00415d25). */
export function splitKv(tok: string): [string, string] {
  const i = tok.indexOf('=');
  if (i < 0) return [tok, ''];
  const rest = tok.slice(i + 1);
  return [tok.slice(0, i), rest.slice(rest.lastIndexOf('=') + 1)];
}

export function parseScript(text: string): Program {
  const items: Item[] = [];
  const byName = new Map<string, Item>();
  const decls = new Map<string, string>();
  const styles: Stmt[] = [];
  let item: Item | null = null, section: Section | null = null, seq: Seq | null = null;
  const lines = text.split(/\r\n|\r|\n/);
  const newItem = (name: string) => {
    item = { name: cut(name), sections: [] };
    items.push(item);
    if (!byName.has(item.name)) byName.set(item.name, item);
    section = null;
    seq = null;
  };
  for (let ln = 0; ln < lines.length; ln++) {
    const line = lines[ln].toUpperCase();
    const tag = classify(line);
    if (!tag) continue;
    if (tag === '[') { newItem(line.slice(1, -1)); continue; }
    if (!item) newItem('');
    const it = item as unknown as Item;
    if (tag === '#') { section = { name: cut(line.slice(1)), seqs: [] }; it.sections.push(section); seq = null; continue; }
    if (!section) { section = { name: '', seqs: [] }; it.sections.push(section); }
    const sec = section as Section;
    if (tag === '@') { seq = { name: cut(line.slice(1)), stmts: [] }; sec.seqs.push(seq); continue; }
    if (tag === 'STYLE') { styles.push(stmtOf(tag, line, ln)); continue; }
    if (!seq) { seq = { name: '', stmts: [] }; sec.seqs.push(seq); }
    const st = stmtOf(tag, line, ln);
    if (tag === 'SET') for (const [k, v] of st.kv) if (!decls.has(k)) decls.set(k, v);
    (seq as Seq).stmts.push(st);
  }
  return { items, byName, decls, styles };
}

function stmtOf(tag: string, line: string, ln: number): Stmt {
  const toks = line.split(/[ \t]+/).filter(Boolean).slice(1, 50); // token 0 (the keyword as written) is skipped
  return new Stmt(tag, toks.map(splitKv), ln + 1);
}

/** Lookup (FUN_004017ac): first item / section / sequence of that name; '' sequence = the first one; empty = not startable. */
export function findSeq(p: Program, item: string, section: string, seq: string): Seq | null {
  const it = p.byName.get(cut(item));
  if (!it) return null;
  const sec = it.sections.find((s) => s.name === cut(section));
  if (!sec) return null;
  const sq = seq === '' ? sec.seqs[0] : sec.seqs.find((s) => s.name === cut(seq));
  return sq && sq.stmts.length ? sq : null;
}
