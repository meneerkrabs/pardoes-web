#!/usr/bin/env python3
"""Reference simulation of the variable engine of PARDOES.EXE.

Implements exactly (from the decompile) what `Set` does:
  FUN_00413e10  every Set token creates one record (name, raw value) at *parse* time;
                the variable's storage is the FIRST record with that name.
  FUN_00414fd5  value expansion ($VAR with '\\' path-join, only if the value starts with '$')
  FUN_00414320  assignment: leading + - * / (and no comma) = arithmetic on the stored value,
                leading '|' = literal, otherwise plain; then backtick -> space.
  FUN_00413e9a  read: user variable (display value) else builtin else None.

It then executes the unnamed section of item [INIT] (the lines before the first '#')
and prints the resulting values of a few variables, so the quirks documented in
script-core.md s4 can be checked.

usage: set_sim.py PLAYER.SCR [VAR ...]
"""
import sys, re
sys.path.insert(0, __file__.rsplit('/', 1)[0])
import scr_inventory as S


def c_atoi(s):
    m = re.match(r'\s*([+-]?)(\d*)', s)
    if not m or m.group(2) == '':
        return 0
    v = int(m.group(2))
    return -v if m.group(1) == '-' else v


class Vars:
    def __init__(self):
        self.val = {}          # name -> raw value (+0x14); first declaration wins

    def declare(self, name, raw):
        if name not in self.val:
            self.val[name] = raw

    def read(self, name):      # FUN_00413e9a (user variables only)
        v = self.val.get(name)
        return None if v is None else v.replace('`', ' ')

    def expand(self, s):       # FUN_00414fd5
        if not s.startswith('$'):
            return s.rstrip('\\') if s.endswith('\\') and not s.endswith(':\\') else s
        out = ''
        name = ''       # current $name buffer (None = not collecting)
        collecting = True
        tail = None
        last = None
        for i, ch in enumerate(s):
            if ch == '\\':
                if collecting:
                    last = self.read(name)
                    if last is not None:
                        out += last
                    collecting = False
                if out and last is not None and last != '' and not out.endswith('\\'):
                    out += '\\'
                tail = i + 1
            else:
                if ch == '$':
                    collecting = True
                    name = ''
                if collecting:
                    name += ch
        if not collecting:
            if tail is not None:
                out += s[tail:]
        else:
            last = self.read(name)
            if last is not None:
                out += last          # ('..' handling omitted: unused in PLAYER.SCR)
        return out.rstrip('\\') if out.endswith('\\') and not out.endswith(':\\') else out

    def assign(self, name, expanded):   # FUN_00414320
        if name not in self.val:
            return False
        cur = self.val[name]
        if expanded[:1] in ('+', '-', '*', '/') and ',' not in expanded:
            n = c_atoi(expanded[1:])
            c = c_atoi(cur)
            op = expanded[0]
            c = {'*': lambda: c * n, '+': lambda: c + n, '-': lambda: c - n,
                 '/': lambda: int(c / n) if n else (_ for _ in ()).throw(ZeroDivisionError(name))}[op]()
            new = str(c)
        elif expanded[:1] == '|':
            new = expanded[1:]
        else:
            new = expanded
        self.val[name] = new.replace('`', ' ')
        return True


def main(path, want):
    raw = open(path, 'rb').read().decode('latin1').split('\n')
    v = Vars()
    stmts = []         # all Set statements in file order (parse time)
    cur_item = None
    cur_sec = ''
    init_lines = []
    for ln in raw:
        ln = ln.rstrip('\r').upper()
        kw = S.classify(ln)
        if kw == 'ITEM':
            cur_item = ln[1:-1]
            cur_sec = ''
        elif kw == 'SECTION':
            cur_sec = ln[1:]
        elif kw == 'SET':
            for t in S.tokens(ln)[1:]:
                k, val = S.split_kv(t)
                v.declare(k, val)         # parse time: first record wins
                if cur_item == 'INIT' and cur_sec == '':
                    init_lines.append((k, val))
                stmts.append((k, val))
    # run the INIT unnamed section's Set statements in order
    errors = 0
    for k, val in init_lines:
        try:
            v.assign(k, v.expand(val))
        except ZeroDivisionError:
            errors += 1
    print('Set tokens in file:', len(stmts), '| in [INIT] unnamed section:', len(init_lines), '| errors:', errors)
    for n in want or ['$VOLMUSICNORMAL', '$VOLMUSICDOWN', '$VOLMUSICINC', '$VOLMUSICDEC', '$VOLMAX',
                      '$VOLIDC', '$VOLDEC', '$VOLINC', '$TIMERTIJD', '$FALSE', '$TRUE', '$ISPARDOESRUNNING',
                      '$BUIDELMUSIC', '$ALG_STAR1', '$INVENT1', '$CURREDUCTIONRECT', '$ROOTDIR']:
        print(f'{n:22s} after-INIT={v.val.get(n)!r}')
    # path-join demo
    v2 = Vars()
    v2.declare('$A', 'KRING1')
    v2.declare('$EXT', 'A')
    print('expand("$A\\\\$EXT") =', repr(v2.expand('$A\\$EXT')))
    return v


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2:])
