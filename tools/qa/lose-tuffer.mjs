// Lose path 4: OLDTIMER2 (Tuffer): pit -> LOOSEPUT -> DEPUT (L10501-10507, L10558), time-out -> LOOSE -> OLDTIMER1 (L10381, L10551), hedgehog -> LOOSE (L10485),
// then a winning drive. After each: scene state clean (no scroller hook, normal compositor, no car sprite, cursor).
// Boots from save pC-ot (OLDTIMER1, the car is started).
import { mk } from './lib.mjs';
import { drive } from './tuffer.mjs';
export default async (ctx) => {
  const q = mk(ctx);
  const { wait, note, check, S, V, go, settle, shot, evaluate, waitFor } = q;
  note('# lose-tuffer from pC-ot');
  await q.bootSave('pC-ot', { $RATTAR_APPEARS: 9999 });
  const clean = (what) => evaluate(() => { const p = globalThis.__pd; return { dx: p.dx.active, hook: !!p.g.scene.presentHook, dirtyOff: p.g.scene.dirtyOff, car: !!p.g.sprites.find('OT2TUFFER'), cursor: p.cmds.cursorId, hide: p.cmds.hideCursor, screen: p.vm.vars.get('$CURRENTSCREEN') }; }).then((c) => { note(`  scene after ${what}: ${JSON.stringify(c)}`); return c; });
  const enter = async () => check('to OLDTIMER2', await go('CMDOT1toOT2', { expect: 'OLDTIMER2', max: 60000 }));
  const waitEnd = (max) => waitFor(() => globalThis.__pd.vm.vars.get('$CURRENTSCREEN') !== 'OLDTIMER2', null, { max, what: 'leave OLDTIMER2' });

  // A: the pit (the car rolls on at speed 1 and drops into the pit at the start line)
  await enter();
  await shot('lose-tuffer-start');
  await waitEnd(60000);
  await settle({ max: 60000 });
  let c = await clean('pit');
  check('pit: in a well (DEPUT1/DEPUT2)', c.screen.startsWith('DEPUT'), c.screen);
  check('pit: scroller released', !c.dx && !c.hook && !c.dirtyOff && !c.car);
  await shot('lose-tuffer-pit-deput');
  check('pit: way out of the well, back to OLDTIMER1', await q.navTo('OLDTIMER1'));
  c = await clean('way back');
  check('way back: normal compositor', !c.dx && !c.hook && !c.dirtyOff);

  // B: time-out (rise above the pit once, then do nothing: the fuel runs out, 30 s)
  await enter();
  await q.key('ArrowUp'); await wait(1500); await q.key('ArrowUp');
  const t0 = q.clock();
  await waitEnd(90000);
  note(`  time-out run lasted ${Math.round((q.clock() - t0) / 1000)} s, $OT2_TIJD=${await V('$OT2_TIJD')}`);
  await settle({ max: 60000 });
  c = await clean('time-out');
  check('time-out/bump: back in OLDTIMER1', c.screen === 'OLDTIMER1', c.screen);
  check('time-out: scroller released', !c.dx && !c.hook && !c.dirtyOff && !c.car);
  await shot('lose-tuffer-timeout');

  // C: hedgehog (OT2EGEL at world x 2800, bottom lane): follow the safe path, then dive into the bottom lane just before it
  await enter();
  let plan = null;
  const rc = await drive(q, plan, { shotPrefix: 'lose-tuffer-egel', override: (sx) => (sx < 2740 && sx > 2200 ? 367 : null) });
  plan = rc.plan;
  await settle({ max: 60000 });
  c = await clean('hedgehog');
  note(`  hedgehog run ended on ${rc.result} (last scroll x ${Math.round(rc.lastSx)})`);
  check('hedgehog: LOOSE back to OLDTIMER1 (L10485)', c.screen === 'OLDTIMER1' && rc.lastSx > 2200, `${c.screen} at ${Math.round(rc.lastSx)}`);
  await shot('lose-tuffer-crash');
  if (!c.screen.startsWith('OLDTIMER')) await q.navTo('OLDTIMER1');

  // D: a clean winning drive
  let res = { result: '' };
  for (let attempt = 1; attempt <= 3 && res.result !== 'OLDTIMER3'; attempt++) {
    if ((await V('$CURRENTSCREEN')) !== 'OLDTIMER1') await q.navTo('OLDTIMER1');
    await enter();
    res = await drive(q, plan, { shotPrefix: 'lose-tuffer-win' });
    plan = res.plan; note(`  winning drive ${attempt}: ended on ${res.result}`);
    await settle({ max: 60000 });
  }
  check('retry wins: OLDTIMER3', (await V('$CURRENTSCREEN')) === 'OLDTIMER3');
  c = await clean('win');
  check('win: scroller released', !c.dx && !c.hook && !c.dirtyOff && !c.car);
  await shot('lose-tuffer-win');
  return q.done();
};
