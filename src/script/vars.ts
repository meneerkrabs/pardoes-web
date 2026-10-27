// Script variables (docs/re/script-core.md s4). Strings only. Every variable exists from the start with the *raw* value
// text of its first Set in the file; Set values starting with + - * / (and without a comma) are arithmetic on the
// stored value, a leading | is the literal escape, a back-tick is a space.

import { atoi } from './parse.ts';

export class Vars {
  private val = new Map<string, string>();

  constructor(decls: Map<string, string>) {
    for (const [k, v] of decls) this.val.set(k, v);
  }

  /** The value (back-ticks as spaces), or undefined. */
  get(name: string): string | undefined {
    const v = this.val.get(name);
    return v === undefined ? undefined : v.replaceAll('`', ' ');
  }

  has(name: string) {
    return this.val.has(name);
  }

  /** Whole-token substitution (FUN_00413e9a): the token's value if it names a variable, else the token itself. */
  sub(tok: string): string {
    return this.get(tok) ?? tok;
  }

  /** Value expansion of Set values and Sfx File= (FUN_00414fd5): only for text starting with '$'; '\' joins. */
  expand(s: string): string {
    const trimSlash = (t: string) => (t.endsWith('\\') && !t.endsWith(':\\') ? t.replace(/\\+$/, '') : t);
    if (!s.startsWith('$')) return trimSlash(s);
    let out = '', name = '', collecting = true, tail = -1;
    let last: string | undefined;
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if (ch === '\\') {
        if (collecting) {
          last = this.get(name);
          if (last !== undefined) out += last;
          collecting = false;
        }
        if (out && last !== undefined && last !== '' && !out.endsWith('\\')) out += '\\';
        tail = i + 1;
      } else {
        if (ch === '$') { collecting = true; name = ''; }
        if (collecting) name += ch;
      }
    }
    if (!collecting) { if (tail >= 0) out += s.slice(tail); }
    else { last = this.get(name); if (last !== undefined) out += last; }
    return trimSlash(out);
  }

  /** Assignment of an expanded value (FUN_00414320); false when the variable does not exist. */
  assign(name: string, v: string): boolean {
    const cur = this.val.get(name);
    if (cur === undefined) return false;
    let out: string;
    const op = v[0];
    if ((op === '+' || op === '-' || op === '*' || op === '/') && !v.includes(',')) {
      const a = atoi(cur), b = atoi(v.slice(1));
      const r = op === '+' ? a + b : op === '-' ? a - b : op === '*' ? a * b : b ? Math.trunc(a / b) : a; // the original crashes on /0
      out = String(r | 0);
    } else if (op === '|') out = v.slice(1);
    else out = v;
    this.val.set(name, out.replaceAll('`', ' '));
    return true;
  }

  /** Text typed by the player (edit box): stored literally (the original sent it through assign(); see s9.3). */
  setLiteral(name: string, v: string): boolean {
    if (!this.val.has(name)) return false;
    this.val.set(name, v);
    return true;
  }

  /** Debug/test view. */
  snapshot(): Record<string, string> {
    return Object.fromEntries(this.val);
  }
}
