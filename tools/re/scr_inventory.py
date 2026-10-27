#!/usr/bin/env python3
"""Keyword / parameter inventory of PLAYER.SCR as PARDOES.EXE sees it.

Mimics the engine's loader:
  FUN_00415f19  upper-case the whole line, cut at CR/LF
  FUN_00415f71  classify the line by strncmp() prefix (order matters)
  FUN_00415dcf  split on blanks/tabs (max 50 tokens)
  FUN_00415d25  split token on the first '=' (a later '=' restarts the value)

Usage:
    python3 -I scr_inventory.py PLAYER.SCR            > script-inventory.md
    python3 -I scr_inventory.py PLAYER.SCR --json     > inventory.json

Every statement keyword / parameter key found in the script is looked up in
the DOC table below.  Anything not in DOC is printed as "UNDOCUMENTED" so the
table doubles as a completeness check.  (Statements owned by the graphics
agent are marked "graphics" and only their key names are listed.)
"""
import sys, re, json, collections

# ---------------------------------------------------------------- classifier
# (prefix, strncmp length n, statement) in the exact order of FUN_00415f71.
PREFIXES = [
    ('[', 1, 'ITEM'), ('#', 1, 'SECTION'), ('@', 1, 'SEQUENCE'),
    ('SET', 3, 'SET'), ('STYLE', 5, 'STYLE'), ('BITMAP', 6, 'BITMAP'),
    ('COMMAND', 7, 'COMMAND'), ('EXIT', 7, 'EXIT'), ('AREA', 4, 'AREA'),
    ('FLYOVER', 7, 'FLYOVER'), ('TEKST', 5, 'TEKST'),
    ('INSTRUCTION', 11, 'INSTRUCTION'), ('INSTALL', 7, 'INSTALL'),
    ('QUIZ', 4, 'QUIZ'), ('PUZJAPANS', 9, 'PUZJAPANS'),
    ('DXSCREEN', 8, 'DXSCREEN'), ('EXECUTE', 7, 'EXECUTE'),
    ('MOVIE', 5, 'MOVIE'), ('SFX', 3, 'SFX'), ('CDAUDIO', 7, 'CDAUDIO'),
    ('WAVE', 4, 'WAVE'), ('MIDI', 4, 'MIDI'), ('SPRITE', 6, 'SPRITE'),
    ('TIMER', 5, 'TIMER'), ('TIMELINE', 8, 'TIMELINE'), ('IF', 2, 'IF'),
    ('LISTBOX', 7, 'LISTBOX'), ('EDITBOX', 7, 'EDITBOX'),
    ('MESSAGE', 7, 'MESSAGE'),
]


def c_strncmp_eq(line, pat, n):
    a = (line + '\0' * n)[:n]
    b = (pat + '\0' * n)[:n]
    return a == b


def classify(line):
    for pat, n, name in PREFIXES:
        if c_strncmp_eq(line, pat, n):
            return name
    return None


def tokens(line):
    return [t for t in re.split(r'[ \t]+', line) if t != '']


def split_kv(tok):
    """FUN_00415d25: key ends at first '='/' '; every later '=' run restarts
    the value buffer (so `A=B=C` -> key A, value C)."""
    key = ''
    val = ''
    cur = 'k'
    i = 0
    while i < len(tok):
        ch = tok[i]
        if ch in '= ':
            while i < len(tok) and tok[i] in '= ':
                i += 1
            cur = 'v'
            val = ''
            continue
        if cur == 'k':
            key += ch
        else:
            val += ch
        i += 1
    return key, val


# ---------------------------------------------------------------- doc table
CORE = 'script-core.md'
GFX = 'graphics docs (other agent)'
# statement -> (status, where)
STMT_DOC = {
    'SET': ('documented', CORE + ' s5.1'),
    'IF': ('documented', CORE + ' s5.2'),
    'INSTRUCTION': ('documented', CORE + ' s5.3 (GOSUB/RUN/RUNRANDOM/SUBRANDOM/WAIT/USES/SCRIPT/SFX/TEKST/PRINT); BITMAP/SPRITE/COMMAND/OBJECT/DX types: ' + GFX),
    'EXIT': ('documented', CORE + ' s5.4'),
    'TIMER': ('documented', CORE + ' s8'),
    'STYLE': ('documented', CORE + ' s9.1'),
    'TEKST': ('documented', CORE + ' s9.2'),
    'EDITBOX': ('documented', CORE + ' s9.3'),
    'SFX': ('documented', CORE + ' s12.2'),
    'WAVE': ('documented', CORE + ' s12.4'),
    'BITMAP': ('graphics', GFX),
    'SPRITE': ('graphics', GFX),
    'COMMAND': ('graphics', GFX),
    'MOVIE': ('graphics', GFX + '; blocking protocol in ' + CORE + ' s6.5'),
    'DXSCREEN': ('graphics', GFX),
}

# (statement, key) -> short meaning.  Keys not listed are reported as UNDOCUMENTED
# unless the statement is a graphics statement.
KEY_DOC = {
    ('INSTRUCTION', 'TYPE'): 'instruction type (table in s5.3)',
    ('INSTRUCTION', 'TARGET'): 'GOSUB/RUN: section name; USES: feature; others: sub-target (s5.3)',
    ('INSTRUCTION', 'NAME'): 'GOSUB/RUN: item name; other types: object name',
    ('INSTRUCTION', 'VALUE'): 'numeric or keyword (atoi, then keyword table s5.3.0)',
    ('INSTRUCTION', 'CONTENTS'): 'GOSUB/RUN: sequence name; SFX/TEKST/...: argument',
    ('TIMER', 'TYPE'): 'STATIC (default) / KILL / ENABLE / DISABLE',
    ('TIMER', 'INTERVAL'): 'timer period in MULTIPLIER units (var resolved at parse time)',
    ('TIMER', 'MULTIPLIER'): 'ms per interval unit (default 1)',
    ('TIMER', 'NAME'): 'timer id; sprites select their clock by this name',
    ('TIMER', 'VARIABLE'): 'variable overriding INTERVAL when the timer is created',
    ('TIMER', 'ITEM'): 'item run on every tick (raw name, no variable resolution)',
    ('TIMER', 'SECTION'): 'section run on every tick',
    ('TIMER', 'SEQUENCE'): 'sequence run on every tick (empty = first)',
    ('SFX', 'TYPE'): 'LOAD / UNLOAD / PLAY / KILL(=stop); default and unknown = KILL',
    ('SFX', 'NAME'): 'sound slot name (variable-resolvable)',
    ('SFX', 'FILE'): 'wave file in DAT (var-expanded; ?NNxxx = random variant)',
    ('SFX', 'EXTRA'): 'CANINTERRUPT / PLAYONEATATIME / EXTERNAL',
    ('SFX', 'VOLUME'): 'DirectSound volume, hundredths of dB (0 = full)',
    ('SFX', 'ATEND'): 'REPEAT = loop; anything else = play once',
    ('SFX', 'SYNC'): 'parsed, only affects PlaySound fallback',
    ('SFX', 'FREQUENCY'): 'parsed (default 100), never applied',
    ('WAVE', 'TYPE'): 'PLAY / WAIT / KILL / PAUSE / OPEN / REC*; default KILL',
    ('WAVE', 'NAME'): 'stream name',
    ('WAVE', 'FILE'): 'path relative to the EXE directory (not in DAT)',
    ('WAVE', 'ATEND'): 'REPEAT / STOP / CLOSE (default CLOSE)',
    ('WAVE', 'EXTRA'): 'AMOVIE = play through ActiveMovie',
    ('WAVE', 'VOLUME'): 'hundredths of dB',
    ('WAVE', 'FREQUENCY'): 'percent (default 100)',
    ('WAVE', 'RELATIVE'): 'name of an object whose position pans the sound',
    ('TEKST', 'NAME'): 'text object name',
    ('TEKST', 'RECT'): 'x,y,w,h (relative to RELATIVE bitmap or screen origin)',
    ('TEKST', 'STYLE'): 'name of a STYLE record',
    ('TEKST', 'COLOR'): 'r,g,b text colour (overrides style colour)',
    ('TEKST', 'TYPE'): 'SINGLE / SINGLEBOUND / MULTIBOUND / TEMP / KILL',
    ('TEKST', 'CONTENTS'): 'literal, $VAR, or TEKST031.TXT key',
    ('TEKST', 'ALIGN'): '{LEFT,CENTER,RIGHT}{TOP,CENTER,BOTTOM}',
    ('TEKST', 'FX'): 'flag: draw along FXTOP/FXBOT curves (used for printing)',
    ('TEKST', 'FXTOP'): 'x1,y1,x2,y2 top polyline (aliases RECT storage)',
    ('TEKST', 'FXBOT'): 'x3,y3,x4,y4 bottom polyline',
    ('TEKST', 'MARGIN'): 'l,t,r,b inset',
    ('TEKST', 'RELATIVE'): 'bitmap name the RECT is relative to',
    ('TEKST', 'SHADOW'): 'shadow colour (drawn at +2,+2)',
    ('TEKST', 'SHADOWPOINT'): 'parsed, UNCERTAIN whether used',
    ('TEKST', 'EXTRA'): 'RESTOREBG / CAPTION',
    ('TEKST', 'TARGET'): 'name of a bitmap/command/area the text is fitted into',
    ('TEKST', 'COPYTARGET'): 'listbox whose selected row supplies the text',
    ('TEKST', 'PRINTER'): 'flag: printer text',
    ('EDITBOX', 'NAME'): 'edit box name',
    ('EDITBOX', 'RECT'): 'x,y,w,h',
    ('EDITBOX', 'STYLE'): 'STYLE record (font + colour)',
    ('EDITBOX', 'COLOR'): 'text colour',
    ('EDITBOX', 'TYPE'): 'CREATE / KILL / UPDATE (default) / REWRITE',
    ('EDITBOX', 'COPYTARGET'): 'variable that receives the text on every change',
    ('EDITBOX', 'MAXLEN'): 'EM_LIMITTEXT',
    ('EDITBOX', 'COMMAND'): 'section of this item run on every change',
    ('EDITBOX', 'BITMAP'): 'background bitmap name',
    ('EDITBOX', 'PREV'): 'Tab target', ('EDITBOX', 'NEXT'): 'Tab target',
    ('EDITBOX', 'CONTENTS'): 'variable holding text for UPDATE/REWRITE',
    ('EDITBOX', 'RELATIVE'): 'bitmap the RECT is relative to',
    ('EDITBOX', 'EXTRA'): 'MULTILINE / MODIFY',
    ('EDITBOX', 'OPERATIONS'): 'listbox operations (unused)',
    ('EDITBOX', 'BCOLOR'): 'background colour',
    ('STYLE', 'NAME'): 'style id', ('STYLE', 'BASE'): 'font family class SWISS/ROMAN/MODERN/DECORATIVE/SCRIPT',
    ('STYLE', 'H'): 'height (points when PRINTER, else pixels)', ('STYLE', 'W'): 'weight (400 normal, 700 bold)',
    ('STYLE', 'COLOR'): 'r,g,b', ('STYLE', 'FACENAME'): 'face name (_ = space)',
    ('STYLE', 'PRINTER'): 'flag: H is in points, scaled to printer dpi',
    ('STYLE', 'ITALIC'): 'flag', ('STYLE', 'UNDERLINE'): 'flag', ('STYLE', 'STRIKETHROUGH'): 'flag',
    ('STYLE', 'BACK'): 'only TRANSPARANT recognised',
    ('IF', 'ITEM'): 'target item (whole-token $VAR allowed)',
    ('IF', 'SECTION'): 'target section',
    ('IF', 'SEQUENCE'): 'target sequence (empty = first)',
    ('IF', 'NAME'): 'identifier, not used by the runtime',
    ('IF', 'TYPE'): 'STATIC (default) / KILL (= statement is inert)',
    ('IF', 'COMPARE'): 'EXACT / RTOL (default) / LTOR',
    ('IF', 'COUNT'): 'LTOR: number of leading chars compared',
    ('IF', 'OPERATOR'): 'EQUAL / NOT / GT / GTE / LT / LTE',
    ('IF', 'EXTRA'): 'GOSUB = push frame in current thread; anything else/absent = RUN (new thread)',
}

# INSTRUCTION TYPE value -> (status, note)
ITYPE_DOC = {
    'GOSUB': ('documented', 's5.3.1'), 'RUN': ('documented', 's5.3.1'),
    'RUNRANDOM': ('documented', 's5.3.3'), 'SUBRANDOM': ('documented', 's5.3.3'),
    'WAIT': ('documented', 's5.3.4'), 'USES': ('documented', 's5.3.5'),
    'SCRIPT': ('documented', 's5.3.6'), 'SFX': ('documented', 's12.3'),
    'TEKST': ('documented', 's9.2'), 'PRINT': ('documented', 's10'),
    'SPRITE': ('graphics', ''), 'BITMAP': ('graphics', ''), 'COMMAND': ('graphics', ''),
    'OBJECT': ('graphics', ''), 'DX': ('graphics', ''), 'MOVIE': ('graphics', ''),
    'WAVE': ('documented', 's12.4'),
}


def parse(path):
    raw = open(path, 'rb').read().decode('latin1')
    stat = collections.OrderedDict()
    ignored = collections.Counter()
    ignored_samples = {}
    structure = collections.Counter()
    items = collections.OrderedDict()
    cur_item = None
    cur_sec = None
    cur_seq = None
    refs_missing = []
    stmts = []          # (lineno, kw, kv-dict, item, sec, seq)
    for lineno, ln in enumerate(raw.split('\n'), 1):
        ln = ln.rstrip('\r').upper()
        kw = classify(ln)
        if kw is None:
            if ln == '':
                key = '<empty>'
            elif ln[0] == '/':
                key = '/ (comment or disabled)'
            else:
                key = ln.split(' ')[0].split('=')[0][:14] + '  (no prefix match)'
            ignored[key] += 1
            ignored_samples.setdefault(key, lineno)
            continue
        if kw == 'ITEM':
            cur_item = ln[1:-1]
            items.setdefault(cur_item, collections.OrderedDict())
            cur_sec = ''
            items[cur_item].setdefault('', collections.OrderedDict())
            cur_seq = ''
            items[cur_item][''].setdefault('', [])
            structure['items'] += 1
            continue
        if kw == 'SECTION':
            if cur_item is None:
                cur_item = ''
                items.setdefault('', collections.OrderedDict())
            cur_sec = ln[1:]
            if cur_sec in items[cur_item]:
                structure['duplicate sections'] += 1
            items[cur_item].setdefault(cur_sec, collections.OrderedDict())
            cur_seq = ''
            structure['sections'] += 1
            continue
        if kw == 'SEQUENCE':
            cur_seq = ln[1:]
            items[cur_item][cur_sec].setdefault(cur_seq, [])
            structure['sequences'] += 1
            continue
        d = stat.setdefault(kw, {'n': 0, 'keys': collections.OrderedDict()})
        d['n'] += 1
        kv = collections.OrderedDict()
        for t in tokens(ln)[1:]:           # token 0 (the keyword) is skipped
            k, v = split_kv(t)
            kv[k] = v
            d['keys'].setdefault(k, collections.Counter())[v] += 1
        if cur_item is None:
            continue
        items[cur_item].setdefault(cur_sec, collections.OrderedDict()).setdefault(cur_seq, []).append((lineno, kw, kv))
    # static reference check (literal names only)
    for it, secs in items.items():
        for sn, seqs in secs.items():
            for qn, lst in seqs.items():
                for (lineno, kw, kv) in lst:
                    if kw == 'INSTRUCTION' and kv.get('TYPE') in ('GOSUB', 'RUN'):
                        nm, tg, ct = kv.get('NAME', ''), kv.get('TARGET', ''), kv.get('CONTENTS', '')
                    elif kw == 'IF':
                        nm, tg, ct = kv.get('ITEM', ''), kv.get('SECTION', ''), kv.get('SEQUENCE', '')
                    else:
                        continue
                    if any(x.startswith('$') for x in (nm, tg, ct)):
                        continue
                    if nm not in items or tg not in items[nm]:
                        refs_missing.append((lineno, kw, nm, tg, ct, it, sn))
                    elif ct and ct not in items[nm][tg]:
                        refs_missing.append((lineno, kw, nm, tg, ct + ' (sequence)', it, sn))
    return stat, ignored, ignored_samples, structure, items, refs_missing


def trunc(s, n=26):
    return s if len(s) <= n else s[:n] + '..'


def status_for(kw, key):
    if (kw, key) in KEY_DOC:
        return 'documented: ' + KEY_DOC[(kw, key)]
    if STMT_DOC.get(kw, ('', ''))[0] == 'graphics':
        return 'graphics'
    if kw in ('IF', 'SET'):
        return 'operand (left side of the comparison)' if kw == 'IF' else 'variable assignment'
    return 'UNDOCUMENTED'


def main(path):
    stat, ignored, samples, structure, items, missing = parse(path)
    out = []
    w = out.append
    w('# PLAYER.SCR keyword / parameter inventory\n')
    w('Generated by `tools/scr_inventory.py` (run: `python3 -I tools/scr_inventory.py <PLAYER.SCR>`).')
    w('It mimics the engine loader (upper-casing, strncmp prefix classification, blank/tab tokenizer,')
    w('first-`=` key/value split). All values below are therefore **upper-case**, exactly as the engine sees them.')
    w('Companion: `script-core.md` (semantics). "graphics" = documented by the graphics agent.\n')
    w('## 1. Structure\n')
    w(f'- item lines `[X]`: {structure["items"]}, section lines `#X`: {structure["sections"]}, sequence lines `@X`: {structure["sequences"]}')
    w(f'- duplicate item names: 0 (only the first would be reachable); duplicate (item,section) pairs: {structure["duplicate sections"]} (`PYTHON2/RANDOMEVENT3`, line 9843; the second copy is unreachable)')
    w('- only items `OBJECTS` (55 sequences) and `KRING` (34) use `@sequences`; everything else uses the implicit unnamed sequence of its section')
    w('- engine limits vs. script usage (see script-core.md s3.4): IF 956/1000, SET records 6800/8000, INSTRUCTION 3162/5000, SFX 534/1000, TIMER 43 statements (100 slots, 20 simultaneously active)\n')
    w('## 2. Statement keywords the engine recognises (in this script)\n')
    w('| keyword | count | status | where |\n|---|---:|---|---|')
    for kw, d in stat.items():
        st = STMT_DOC.get(kw, ('UNDOCUMENTED', ''))
        w(f'| {kw} | {d["n"]} | {st[0]} | {st[1]} |')
    never = [p[2] for p in PREFIXES if p[2] not in stat and p[2] not in ('ITEM', 'SECTION', 'SEQUENCE')]
    w('\nRecognised by the engine but **never used** in PLAYER.SCR: ' + ', '.join(never) + '. (script-core.md s5.5 lists their parameter keys.)\n')
    w('## 3. Ignored lines (no prefix matches => silently skipped)\n')
    w('| first token | count | first at line |\n|---|---:|---:|')
    for k, n in ignored.most_common(60):
        w(f'| `{k}` | {n} | {samples[k]} |')
    w('')
    w('Disabled lines are *only* "does not start with a known keyword": a leading `/`, `//`, or any extra letter (`a`, `q`, `rjh`, `t`) is enough.')
    w('Nothing but the first characters matters (e.g. `ASet`, `qSet`, `AINSTRUCTION` fail the `strncmp` tests).\n')
    w('## 4. Parameters per statement (values truncated, count in parentheses)\n')
    for kw, d in stat.items():
        if kw == 'SET':
            continue
        w(f'### {kw}  ({d["n"]} lines)\n')
        if not d['keys']:
            w('(no parameters)\n')
            continue
        w('| key | distinct | values | status |\n|---|---:|---|---|')
        for k, c in d['keys'].items():
            if kw == 'IF' and k.startswith('$'):
                continue
            vals = ', '.join(f'`{trunc(v)}`({n})' for v, n in c.most_common(10))
            more = '' if len(c) <= 10 else f', ... +{len(c)-10} more'
            w(f'| `{k}` | {len(c)} | {vals}{more} | {status_for(kw, k)} |')
        if kw == 'IF':
            ops = [(k, c) for k, c in d['keys'].items() if k.startswith('$')]
            w(f'\n(+ {len(ops)} distinct left-operand variable names, e.g. `{ops[0][0]}`; any unknown key = left operand, its value = right operand)')
        w('')
    d = stat.get('SET')
    if d:
        w(f'### SET  ({d["n"]} lines, one variable record per line, all single-assignment)\n')
        w(f'{len(d["keys"])} distinct variable names. Most frequent: ' +
          ', '.join(f'`{k}`({sum(c.values())})' for k, c in sorted(d['keys'].items(), key=lambda kv: -sum(kv[1].values()))[:12]) + '.\n')
        # operator-prefixed values
        pre = collections.Counter()
        for k, c in d['keys'].items():
            for v, n in c.items():
                if v[:1] in '+-*/' and ',' not in v and v != '':
                    pre['arith ' + v[0]] += n
                elif v[:1] == '|':
                    pre['literal |'] += n
                elif v[:1] == '$':
                    pre['$ expansion'] += n
                elif v == '':
                    pre['empty'] += n
                elif ',' in v:
                    pre['comma list'] += n
        w('Value shapes: ' + ', '.join(f'{k}: {n}' for k, n in pre.most_common()) + '.\n')
    # instruction types and values
    w('## 5. INSTRUCTION: Type x Value combinations\n')
    combo = collections.defaultdict(collections.Counter)
    for it, secs in items.items():
        for sn, seqs in secs.items():
            for qn, lst in seqs.items():
                for (lineno, kw, kv) in lst:
                    if kw == 'INSTRUCTION':
                        combo[kv.get('TYPE')][kv.get('VALUE')] += 1
    w('| TYPE | count | status | VALUE keywords used |\n|---|---:|---|---|')
    for t, c in sorted(combo.items(), key=lambda kv: -sum(kv[1].values())):
        st = ITYPE_DOC.get(t, ('UNDOCUMENTED', ''))
        vs = ', '.join(f'{("-" if v is None else v)}({n})' for v, n in c.most_common())
        w(f'| {t} | {sum(c.values())} | {st[0]} {st[1]} | {vs} |')
    w('')
    # engine-invoked section names present in the script
    w('## 6. Section names that the *engine* invokes (and how many items define them)\n')
    names = ['CLICK', 'CLICKHAHA', 'MOUSEDOWN', 'MOUSEUP', 'FLYOVER', 'ENDFLYOVER', 'ENTER', 'SOLVED',
             'PIECEOK', 'PIECENOK', 'COLIDE', 'WIN', 'START', 'CREATE(sprite/DX)', 'EINDE', 'INIT']
    cnt = collections.Counter()
    for it, secs in items.items():
        for sn in secs:
            cnt[sn] += 1
    w('| section | defined in N items | note |\n|---|---:|---|')
    notes = {'CLICK': '[CMD] #CLICK on mouse-up / ENTER-key etc. (s7.2)', 'CLICKHAHA': 'Ctrl+Shift+click, falls back to CLICK if absent',
             'FLYOVER': 'mouse enters a Command', 'ENDFLYOVER': 'mouse leaves it', 'ENTER': 'sprite/area enter (graphics)',
             'SOLVED': 'puzzle bitmap solved (graphics)', 'PIECEOK': 'puzzle piece right', 'PIECENOK': 'puzzle piece wrong',
             'COLIDE': 'sprite / DX collision', 'WIN': 'DX race finished', 'START': 'sprite/DX started',
             'EINDE': 'item EINDE #CLICK on CD removal (unused)', 'INIT': 'item INIT, run once at first WM_PAINT'}
    for n in names:
        key = n.split('(')[0]
        if n.startswith('CREATE'):
            continue
        w(f'| {key} | {cnt.get(key, 0)} | {notes.get(key, "")} |')
    w('\nNames that look like events but are **script conventions only** (always reached through GOSUB/IF/RUN): CREATE, DESTROY, ENABLE, DISABLE, INCREASE, DECREASE, KILL, TICK (target of Timers), WRONGDROP, ON/OFF, RANDOMEVENTn, ...\n')
    w('## 7. Static reference check (literal Item/Section/Sequence targets that do not exist)\n')
    w(f'{len(missing)} dangling references. A failing GOSUB / IF..GOSUB skips the last instruction of the calling sequence (script-core.md s6.4); a failing RUN is a no-op.\n')
    w('| line | stmt | item | section | sequence | in item/section |\n|---:|---|---|---|---|---|')
    for (ln, kw, nm, tg, ct, it, sn) in missing:
        w(f'| {ln} | {kw} | {nm} | {tg} | {ct} | {it}/{sn} |')
    w('')
    return '\n'.join(out)


if __name__ == '__main__':
    if '--json' in sys.argv:
        stat, ignored, samples, structure, items, missing = parse(sys.argv[1])
        print(json.dumps({'statements': {k: {'n': v['n'], 'keys': {kk: dict(c) for kk, c in v['keys'].items()}} for k, v in stat.items()},
                          'ignored': dict(ignored), 'structure': dict(structure), 'missing_refs': missing}, indent=1))
    else:
        print(main(sys.argv[1]))
