// Lose path 1: CANIBAL1, five wrong pots (PLAYER.SCR L17596-17597, L17643 PARDOES #EINDE) -> GAMEOVER.AVI, full reset, Sterrenkamer, retry.
// Boots from save pF-cf (KPREIS, EMMER in the bag).
import { mk } from './lib.mjs';
export default async (ctx) => {
  const q = mk(ctx);
  const { wait, note, check, S, V, go, clickT, clickCmd, clickSprite, settle, take, shot, evaluate, waitFor, hasCmd } = q;
  note('# lose-cannibal from pF-cf');
  await q.bootSave('pF-cf', { $RATTAR_APPEARS: 9999 });
  check('to CANIBAL1', await go('CMDKPREIStoMC1', { expect: 'CANIBAL1' }));
  await settle({ max: 30000 });
  await clickT('MC1POT1'); await wait(3000); await settle({ max: 40000 });
  check('Pardoes in the pot', await hasCmd('CMDMC1WATER'));
  await clickSprite('MC1PARDOES'); await wait(800);
  await take('EMMER');
  let over = false;
  for (let i = 1; i <= 14 && !over; i++) {
    await clickCmd('CMDMC1WATER'); await wait(300);
    await clickSprite('MC1POT5'); await wait(1200);
    const st = await evaluate(() => ({ e: globalThis.__pd.vm.vars.get('$MC1_ERROR'), f: globalThis.__pd.vm.vars.get('$MC1_FAILED'), n: globalThis.__pd.vm.vars.get('$MC1_NEXT'), mv: globalThis.__pd.media.playing, scr: globalThis.__pd.vm.vars.get('$CURRENTSCREEN') }));
    note(`  wrong pot #${i}: errors=${st.e} failed=${st.f} next=${st.n} movie=${st.mv} screen=${st.scr}`);
    if (st.mv || st.scr === 'PARDOESEINDE') over = true;
    await settle({ max: 30000, closeBag: false, skipMovies: false });
    if (!over && (await V('$CURRENTSCREEN')) !== 'CANIBAL1') over = true;
    if (!(await V('$INVMOVER')) || (await V('$INVMOVER')) === '') await take('EMMER');
  }
  check('game over reached (GAMEOVER movie / PARDOESEINDE)', over);
  await wait(1500); await shot('lose-cannibal-gameover');
  await q.skipMovie();
  check('back in the Sterrenkamer', await q.waitScreen('STERRENKAMER', 90000));
  const s = await S();
  check('full reset (bag, rings, helper empty)', s.rings === '' && s.inv === 'LEEG,LEEG,LEEG,LEEG' && s.help === 'LEEG', JSON.stringify([s.rings, s.inv, s.help]));
  await shot('lose-cannibal-after');
  // retry: the new game is playable (mirror, realm, cannibal screen builds its pots again)
  await clickSprite('SK1OBJMUUR'); await settle({ max: 30000 });
  check('retry: pick up the mirror', (await S()).inv.startsWith('SPIEGEL'));
  check('retry: to KPREIS', await q.toRealm('KPREIS'));
  check('retry: CANIBAL1 builds again', await go('CMDKPREIStoMC1', { expect: 'CANIBAL1' }));
  await settle({ max: 30000 });
  check('retry: pots are there and clickable', !!(await q.spritePoint('MC1POT1')));
  await shot('lose-cannibal-retry');
  return q.done();
};
