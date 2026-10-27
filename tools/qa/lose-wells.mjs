// Lose path 5: the wells (DEPUT1/DEPUT2, L8189-8562): in through the Sterrenkamer trapdoor and the well exits of the realm screens, out through
// CMDDP1toWORLD / CMDDP2toWORLD (random destination, SUBRANDOM 7). Chains QA_TRIPS (default 12) trips and checks that no leg ends in a stuck state.
// Boots from save pB-lf (Sterrenkamer).
import { mk } from './lib.mjs';
export default async (ctx) => {
  const q = mk(ctx);
  const { wait, note, check, S, V, go, clickCmd, settle, shot, waitFor } = q;
  const trips = +(process.env.QA_TRIPS || 12);
  note(`# lose-wells from pB-lf (${trips} trips)`);
  await q.bootSave('pB-lf', { $RATTAR_APPEARS: 9999 });
  const ENTRY = { VOCSCHIP1: 'CMDVC1toDP1', SPOOKSLOT1: 'CMDSS1toDP1', FATAMORGANA1: 'CMDFM1toDP1', VEERMAN1: 'CMDVM1toDP1', DOOLHOF1: 'CMDEXITtoDP' };
  const seq = []; let stuck = 0, alt = [];
  for (let i = 1; i <= trips; i++) {
    const here = await V('$CURRENTSCREEN');
    let ok = false;
    if (here.startsWith('DEPUT')) ok = true; // the random way out can lead into the other well
    else if (here === 'STERRENKAMER') {
      await go('CMDSK1_TRAP'); await wait(2500); await settle({ max: 30000 });
      ok = await go('CMDSKtoDEPUT', { max: 60000 });
    } else if (ENTRY[here]) ok = await go(ENTRY[here], { max: 60000 });
    else { note(`!! trip ${i}: no well entry known on ${here}`); stuck++; break; }
    const dp = here.startsWith('DEPUT') ? true : await waitFor(() => /^DEPUT/.test(globalThis.__pd.vm.vars.get('$CURRENTSCREEN')), null, { max: 40000, what: 'DEPUT' });
    const s1 = await S();
    if (!dp) { note(`!! trip ${i}: did not reach a well from ${here} (${s1.screen})`); stuck++; await shot(`lose-wells-stuck-${i}`); break; }
    await settle({ max: 60000 });
    const s = await S();
    alt.push(s.screen);
    if (i <= 2) await shot(`lose-wells-${s.screen.toLowerCase()}-${i}`);
    if (s.blockers.length) { note(`!! stuck in ${s.screen}: ${s.blockers}`); stuck++; }
    // out
    const out = await go(s.screen === 'DEPUT1' ? 'CMDDP1toWORLD' : 'CMDDP2toWORLD', { max: 60000 });
    await wait(3000); await settle({ max: 60000 });
    const to = await V('$CURRENTSCREEN');
    const s2 = await S();
    seq.push(`${here}->${s.screen}->${to}`);
    note(`  trip ${i}: ${here} -> ${s.screen} -> ${to}${s2.blockers.length ? ' STUCK ' + s2.blockers : ''}`);
    if (s2.blockers.length || to.startsWith('DEPUT') && to === s.screen && false) stuck++;
    if (i <= 3) await shot(`lose-wells-out-${i}`);
    if (!out) { stuck++; break; }
  }
  check('all trips completed without a stuck state', stuck === 0 && seq.length === trips, `${seq.length}/${trips}, stuck ${stuck}`);
  check('both wells were used (DEPUT1 and DEPUT2 alternate on $PUTNR)', alt.includes('DEPUT1') && alt.includes('DEPUT2'), alt.join(','));
  const dests = new Set(seq.map((x) => x.split('->')[2]));
  note(`destinations seen: ${[...dests].join(', ')}`);
  return q.done();
};
