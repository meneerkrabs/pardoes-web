#!/usr/bin/env python3
"""Executable specification of the PARDOES script core (see docs/re/script-core.md).

Implements: loader (s2), item/section/sequence model (s3), variables (s4), Set/If/Instruction
GOSUB/RUN/RUNRANDOM/SUBRANDOM/WAIT/USES/EXIT (s5), thread frames with the idx/ptr desync
quirk and the FIFO message queue (s6).  Everything graphical or audible is *stubbed*: Bitmap,
Sprite, Movie, Sfx, Wave, Timer, Tekst, ... are recorded and never block.  `Command Type=GLOBAL`
registers a clickable command so that a random "player" can walk through the game.

usage:  engine_sim.py PLAYER.SCR [--clicks N] [--seed S] [--verbose]

The walk prints statistics: how many statements ran, which GOSUB/IF targets failed at run time
(the s6.4 quirk), which Commands existed.  It is a smoke test of the documented semantics, not a
game re-implementation.
"""
import sys, re, random, collections
sys.path.insert(0, __file__.rsplit('/', 1)[0])
import scr_inventory as S
from set_sim import Vars, c_atoi


class Seq:
    def __init__(self, name): self.name = name; self.stmts = []
class Section:
    def __init__(self, name): self.name = name; self.seqs = []
class Item:
    def __init__(self, name): self.name = name; self.sections = []


def trunc19(s): return s[:19]


class Script:
    def __init__(self, path):
        self.items = []
        self.vars = Vars()
        cur_item = cur_sec = cur_seq = None
        raw = open(path, 'rb').read().decode('latin1').split('\n')
        for ln in raw:
            ln = ln.rstrip('\r').upper()
            kw = S.classify(ln)
            if kw is None:
                continue
            if kw == 'ITEM':
                cur_item = Item(trunc19(ln[1:-1])); self.items.append(cur_item); cur_sec = cur_seq = None
            elif kw == 'SECTION':
                if cur_item is None: cur_item = Item(''); self.items.append(cur_item)
                cur_sec = Section(trunc19(ln[1:])); cur_item.sections.append(cur_sec); cur_seq = None
            elif kw == 'SEQUENCE':
                if cur_item is None: cur_item = Item(''); self.items.append(cur_item)
                if cur_sec is None: cur_sec = Section(''); cur_item.sections.append(cur_sec)
                cur_seq = Seq(trunc19(ln[1:])); cur_sec.seqs.append(cur_seq)
            else:
                if cur_item is None: cur_item = Item(''); self.items.append(cur_item)
                if cur_sec is None: cur_sec = Section(''); cur_item.sections.append(cur_sec)
                if cur_seq is None: cur_seq = Seq(''); cur_sec.seqs.append(cur_seq)
                toks = S.tokens(ln)[1:]
                kvl = [S.split_kv(t) for t in toks]
                if kw == 'SET':
                    for k, v in kvl:
                        self.vars.declare(k, v)         # parse time: first record wins
                cur_seq.stmts.append((kw, kvl, ln))
        # first-match indexes
        self.idx = {}
        for it in self.items:
            self.idx.setdefault(it.name, it)

    def start(self, item, section, seq):
        it = self.idx.get(trunc19(item))
        if not it: return None
        sec = next((s for s in it.sections if s.name == trunc19(section)), None)
        if not sec or not sec.seqs: return None
        if seq == '':
            sq = sec.seqs[0]
        else:
            sq = next((q for q in sec.seqs if q.name == trunc19(seq)), None)
        if sq is None or not sq.stmts: return None
        return sq


class Frame:
    def __init__(self, seq, label): self.seq = seq; self.idx = 0; self.ptr = 0; self.label = label


class Engine:
    def __init__(self, script, rng, verbose=False):
        self.sc = script; self.v = script.vars; self.rng = rng; self.verbose = verbose
        self.threads = {}          # tid -> dict(frames=[], active=True)
        self.queue = collections.deque()
        self.commands = collections.OrderedDict()
        self.exited = False
        self.stats = collections.Counter()
        self.failures = collections.Counter()
        self.last_rand = {}
        self.blocked = []
        self.log = []

    # -- variables
    def rv(self, tok):
        x = self.v.read(tok)
        return tok if x is None else x

    # -- threads
    def run_new(self, item, section, seq, label='run'):
        sq = self.sc.start(item, section, seq)
        if sq is None:
            self.stats['run_failed'] += 1
            return -1
        tid = next((i for i in range(30) if i not in self.threads or not self.threads[i]['active']), None)
        if tid is None:
            self.stats['no_free_thread'] += 1
            return -1
        self.threads[tid] = {'frames': [Frame(sq, f'{item}/{section}/{seq}')], 'active': True}
        self.queue.append(tid)
        return tid

    def gosub(self, t, item, section, seq, caller):
        sq = self.sc.start(item, section, seq)
        if sq is not None:
            t['frames'].append(Frame(sq, f'{item}/{section}/{seq}'))
            return True
        # failure quirk (s6.4): FUN_004018c1 does parent.idx += 1 ; the step still does ptr += 1
        self.failures[(caller, f'{item}/{section}/{seq}')] += 1
        self.stats['gosub_failed'] += 1
        f = t['frames'][-1]
        f.idx += 1
        self._pop_while_done(t)
        return False

    def _pop_while_done(self, t):
        # recursion of FUN_004018c1: parent past its end -> pop again
        while t['frames'] and len(t['frames'][-1].seq.stmts) < t['frames'][-1].idx:
            t['frames'].pop()
            if t['frames']:
                t['frames'][-1].idx += 1
            else:
                t['active'] = False

    def step(self, tid):
        t = self.threads.get(tid)
        if not t or not t['active']: return
        f = t['frames'][-1]
        f.idx += 1
        if len(f.seq.stmts) < f.idx:
            t['frames'].pop()
            if not t['frames']:
                t['active'] = False
                return
            t['frames'][-1].idx += 1
            self._pop_while_done(t)
            if not t['active'] or not t['frames']:
                t['active'] = False
                return
            f = t['frames'][-1]
        kw, kvl, ln = f.seq.stmts[f.ptr] if f.ptr < len(f.seq.stmts) else (None, None, None)
        if kw is None:                       # ptr ran past the end (quirk consequence)
            t['frames'].pop() if t['frames'] else None
            if not t['frames']: t['active'] = False
            else: self.queue.append(tid)
            return
        self.stats['stmt_' + kw] += 1
        before = len(t['frames'])
        self.exec(kw, kvl, ln, t, tid, f)
        f.ptr += 1
        if t['active']:
            if t.pop('block', False):
                self.blocked.append(tid)          # waits for sprite/movie end: resumed at the next simulated event
            else:
                self.queue.append(tid)

    def drain(self, limit=2_000_000):
        n = 0
        while self.queue and n < limit and not self.exited:
            self.step(self.queue.popleft()); n += 1
        if n >= limit: self.stats['drain_limit_hit'] += 1

    # -- statements
    def exec(self, kw, kvl, ln, t, tid, f):
        kv = {}
        for k, v in kvl: kv[k] = v
        label = f.label
        if kw == 'SET':
            for k, val in kvl:
                self.v.assign(k, self.v.expand(val))
        elif kw == 'EXIT':
            self.exited = True
        elif kw == 'IF':
            reserved = {'ITEM', 'SECTION', 'SEQUENCE', 'NAME', 'TYPE', 'COMPARE', 'COUNT', 'OPERATOR', 'EXTRA'}
            left = right = ''
            for k, val in kvl:
                if k not in reserved: left, right = k, val
            typ = 2 if kv.get('TYPE') == 'KILL' else 1
            comp = {'RTOL': 1, 'LTOR': 2, 'EXACT': 0}.get(kv.get('COMPARE'), 1)
            op = {'EQUAL': 0, 'GT': 1, 'GTE': 2, 'LT': 3, 'LTE': 4, 'NOT': 5}.get(kv.get('OPERATOR'), 0)
            gosub = kv.get('EXTRA') == 'GOSUB'
            if typ != 1: return
            L, R = self.rv(left), self.rv(right)
            ok = False
            if comp == 0:
                if op == 0: ok = L == R
                elif op == 1: ok = c_atoi(R) < c_atoi(L)
                elif op == 2: ok = c_atoi(R) <= c_atoi(L)
                elif op == 3: ok = c_atoi(L) < c_atoi(R)
                elif op == 4: ok = c_atoi(L) <= c_atoi(R)
                elif op == 5: ok = L != R
            elif comp == 1:
                if len(R) < len(L): L = L[len(L) - len(R):]
                elif len(L) < len(R): R = R[len(R) - len(L):]
                ok = (L == R) if op == 0 else (L != R) if op == 5 else False
            else:
                n = c_atoi(kv.get('COUNT', '0'))
                eq = L[:n] == R[:n]
                ok = eq if op == 0 else (not eq) if op == 5 else False
            if ok:
                it, se, sq = self.rv(kv.get('ITEM', '')), self.rv(kv.get('SECTION', '')), self.rv(kv.get('SEQUENCE', ''))
                if gosub: self.gosub(t, it, se, sq, label)
                else: self.run_new(it, se, sq)
        elif kw == 'INSTRUCTION':
            typ = kv.get('TYPE', '')
            name = self.rv(kv.get('NAME', '')); target = self.rv(kv.get('TARGET', '')); cont = self.rv(kv.get('CONTENTS', ''))
            value = kv.get('VALUE', '')
            if typ == 'GOSUB':
                self.gosub(t, name, target, cont, label)
            elif typ == 'RUN':
                self.run_new(name, target, cont)
            elif typ in ('RUNRANDOM', 'SUBRANDOM'):
                n = c_atoi(value)
                if n == 0:
                    n = c_atoi(cont); cont = ''
                last = self.last_rand.get(kv.get('TARGET', ''), 0)
                if n < 2: r = 1
                elif n == 2: r = (2 if last == 1 else 1) if last > 0 else self.rng.randint(1, 2)
                else:
                    r = self.rng.randint(1, n)
                    while r == last: r = self.rng.randint(1, n)
                r = min(r, n)
                if r < 1: r = n
                self.last_rand[kv.get('TARGET', '')] = r
                target = f'{target}{r}'
                if typ == 'RUNRANDOM': self.run_new(name, target, cont)
                else: self.gosub(t, name, target, cont, label)
            else:
                self.stats['instr_' + typ] += 1       # everything else is a stub
        elif kw == 'COMMAND':
            nm = kv.get('NAME', '')
            if kv.get('TYPE') == 'KILL': self.commands.pop(nm, None)
            elif nm: self.commands[nm] = kv
        elif kw in ('SPRITE', 'MOVIE') and kv.get('TYPE') == 'WAIT':
            t['block'] = True                          # blocking statements (s6.5)
            self.stats['block_' + kw] += 1
        else:
            self.stats['stub_' + kw] += 1


def main():
    path = sys.argv[1]
    clicks = int(sys.argv[sys.argv.index('--clicks') + 1]) if '--clicks' in sys.argv else 300
    seed = int(sys.argv[sys.argv.index('--seed') + 1]) if '--seed' in sys.argv else 1
    rng = random.Random(seed)
    sc = Script(path)
    en = Engine(sc, rng, '--verbose' in sys.argv)
    # first WM_PAINT: RUN [INIT] #"" @""
    en.run_new('INIT', '', '')
    en.drain()
    print('after INIT: threads running =', sum(1 for t in en.threads.values() if t['active']),
          '| commands =', len(en.commands), '| exited =', en.exited)
    seen = collections.Counter()

    def settle():
        for _ in range(4):                      # sprites/movies 'finish': wake the waiting threads
            wake, en.blocked = en.blocked, []
            en.queue.extend(wake)
            en.drain()
    settle()
    i = -1
    for i in range(clicks):
        if en.exited: break
        settle()
        if not en.commands: break
        name = rng.choice(list(en.commands))
        seen[name] += 1
        en.run_new(name, 'CLICK', '')
        en.drain()
    print(f'random walk: {i + 1} clicks, distinct commands clicked {len(seen)}, exited={en.exited}')
    print('statement counts:', ', '.join(f'{k}={v}' for k, v in sorted(en.stats.items())))
    print(f'failed GOSUB/IF-GOSUB at run time: {en.stats["gosub_failed"]} ({len(en.failures)} distinct):')
    for (caller, tgt), n in en.failures.most_common(15):
        print(f'   {n:4d}x  {caller}  ->  {tgt}')
    print('current screen $CURRENTSCREEN =', en.v.read('$CURRENTSCREEN'))


if __name__ == '__main__':
    main()
