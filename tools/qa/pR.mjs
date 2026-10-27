// Rattar (the rat thief): bounce between two screens with the counter preset so that he can appear, then (QA_MODE=steal) let him take an item,
// or (QA_MODE=defend, default) drop the twinkel on him. Starts from save pE (Sterrenkamer, bag KAART,PEDDEL,BANAAN).
import { mk } from './lib.mjs';
export default async (ctx) => {
  const q = mk(ctx);
  const { wait, note, check, S, V, go, clickT, clickSprite, waitScreen, settle, shot, evaluate, waitFor, takeTwinkel, hasSprite } = q;
  const mode = process.env.QA_MODE || 'defend';
  note(`# pR (${mode})`);
  await q.bootSave('pE', { $RATTAR_APPEAR: 5, $RATTAR_APPEARS: 5 }); // documented preset: Rattar may appear from the next screen change on
  check('to KPREIS', await q.toRealm('KPREIS'));
  const before = (await S()).inv;
  let seen = false;
  for (let i = 0; i < 24 && !seen; i++) {
    const to = i % 2 === 0 ? 'CMDKPREIStoCF1' : 'CMDCF1toKPREIS', exp = i % 2 === 0 ? 'CARNAVAL1' : 'KPREIS';
    await clickT(to);
    seen = await waitFor(() => !!globalThis.__pd.cmds.cmds.get('CMDRATTAR')?.active, null, { max: 25000, what: '' }) !== null;
    if (!seen) { await waitScreen(exp, 30000); }
    note(`  hop ${i + 1} -> ${exp}${seen ? ' RATTAR!' : ''}`);
  }
  check('Rattar showed up', seen);
  if (!seen) return q.done();
  await wait(1500);
  await shot(`pR-${mode}-1`);
  note(`state ${JSON.stringify(await S())}`);
  if (mode === 'defend') {
    const okT = await takeTwinkel();
    note(`twinkel taken: ${okT}, mover=${await V('$INVMOVER')}, level=${await V('$TWINKELLEVEL')}`);
    let hit = false;
    for (let i = 0; i < 400 && !hit; i++) { if (await q.spritePoint('RATTAR')) { hit = await clickSprite('RATTAR'); } else await wait(100); if (!(await q.hasCmd('CMDRATTAR'))) break; }
    note(`clicked RATTAR: ${hit}`);
    await wait(4000);
    await shot(`pR-${mode}-2`);
    await settle({ max: 60000 });
    const s = await S();
    check('inventory intact after the defence', s.inv === before, `${before} -> ${s.inv}`);
    check('Rattar gone', !(await q.hasCmd('CMDRATTAR')));
  } else {
    await waitFor(() => !globalThis.__pd.cmds.cmds.get('CMDRATTAR')?.active, null, { max: 120000, what: 'Rattar leaves' });
    await settle({ max: 60000 });
    await shot(`pR-${mode}-2`);
    const s = await S();
    note(`bag ${before} -> ${s.inv}`);
    check('one item was taken', s.inv !== before);
    const objs = await evaluate(() => Object.entries(globalThis.__pd.vm.snapshot?.() ?? globalThis.__pd.vm.vars.snapshot()).filter(([k, v]) => /^\$OBJ[A-Z0-9]+_[A-Z]+$/.test(k) && v !== 'LEEG' && v !== '$INVLEEG').map(([k, v]) => `${k}=${v}`));
    note(`object spots: ${objs.join(' ')}`);
  }
  await q.st('end');
  return q.done();
};
