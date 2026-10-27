// Runs [INIT] of PLAYER.SCR in node with the real parser/VM (graphics statements are no-ops) and prints variables.
// node tools/vm-init-test.mjs [PLAYER.SCR] [$VAR ...]
import fs from 'node:fs';
import { parseScript } from '../src/script/parse.ts';
import { Vm } from '../src/script/vm.ts';
const file = process.argv[2] ?? new URL('../public/data/pardoes/PLAYER.SCR', import.meta.url).pathname;
const prog = parseScript(fs.readFileSync(file, 'latin1'));
const vm = new Vm(prog);
let steps = 0, stopAt = null;
vm.trace = (t, st) => { steps++; if (st.kw === 'INSTRUCTION' && st.get('TYPE') === 'RUN' && st.get('NAME') === 'INTRO') stopAt = steps; };
// only run INIT's unnamed section, without following RUNs (like set_sim.py)
const id = vm.runNew('INIT', '', '');
vm.pump();
console.log('items', prog.items.length, 'decls', prog.decls.size, 'steps', steps, 'thread', id, 'threads now', JSON.stringify(vm.threadInfo()));
const want = process.argv.slice(3);
for (const n of want.length ? want : ['$VOLMUSICNORMAL', '$VOLMUSICDOWN', '$VOLMUSICINC', '$VOLMUSICDEC', '$VOLMAX', '$VOLIDC', '$VOLDEC', '$VOLINC', '$TIMERTIJD', '$FALSE', '$TRUE', '$ISPARDOESRUNNING', '$BUIDELMUSIC', '$ALG_STAR1', '$INVENT1', '$CURREDUCTIONRECT', '$ROOTDIR'])
  console.log(n.padEnd(22), JSON.stringify(vm.vars.get(n)));
console.log('timers', [...vm.timers.keys()].join(' '));
