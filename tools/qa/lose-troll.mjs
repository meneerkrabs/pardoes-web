// Lose path 6: TROLLENKONING1 arrow code (optional puzzle): first wrong arrow -> the code is shown and the sequence restarts, second wrong arrow in the same
// visit -> #FOUT: Pardoes falls into a well (DEPUT) (L19977-19990, L19851). Way out, back to TK1, solve the code on the retry.
// Boots from save pB-lf (Sterrenkamer).
import { mk } from './lib.mjs';
export default async (ctx) => {
  const q = mk(ctx);
  const { wait, note, check, S, V, Vs, go, clickT, settle, shot, evaluate, waitFor } = q;
  note('# lose-troll from pB-lf');
  await q.bootSave('pB-lf', { $RATTAR_APPEARS: 9999 });
  check('to KPMARE', await q.toRealm('KPMARE'));
  check('to TROLLENKONING1', await go('CMDKPMAREtoTK1', { expect: 'TROLLENKONING1' }));
  await settle({ max: 60000 });
  const nr = await Vs(['$TK1_NR1', '$TK1_NR2', '$TK1_NR3', '$TK1_NR4', '$TK1_NR5', '$TK1_MAXERR', '$TK1_ERRCNT']);
  note(`code ${nr.slice(0, 5)} maxerr=${nr[5]} errcnt=${nr[6]}`);
  await shot('lose-troll-start');
  const wrong = async () => { const first = await V('$TK1_NEXT'); const pick = [1, 2, 3, 4, 5, 6, 7, 8].map((i) => 'CMDTK1PIJL' + i).find((c) => c.replace('CMDTK1PIJL', 'TK1CMD') !== first); await clickT(pick); return pick; };
  const p1 = await wrong(); await wait(1500); await settle({ max: 60000 });
  note(`  1st wrong arrow ${p1}: errcnt=${await V('$TK1_ERRCNT')} screen=${await V('$CURRENTSCREEN')}`);
  check('1st error: still in TROLLENKONING1 (code shown, sequence restarts)', (await V('$CURRENTSCREEN')) === 'TROLLENKONING1' && (await V('$TK1_ERRCNT')) === '1');
  await shot('lose-troll-error1');
  const p2 = await wrong();
  await wait(1200); await shot('lose-troll-falling');
  check('2nd error: fall into a well', !!(await waitFor(() => /^DEPUT/.test(globalThis.__pd.vm.vars.get('$CURRENTSCREEN')), null, { max: 60000, what: 'DEPUT' })));
  await settle({ max: 60000 });
  note(`  2nd wrong arrow ${p2}: now in ${await V('$CURRENTSCREEN')}`);
  await shot('lose-troll-deput');
  check('way out of the well and back to TROLLENKONING1', await q.navTo('TROLLENKONING1'));
  await settle({ max: 60000 });
  check('retry: error counter reset', (await V('$TK1_ERRCNT')) === '0', await V('$TK1_ERRCNT'));
  const code = await Vs(['$TK1_NR1', '$TK1_NR2', '$TK1_NR3', '$TK1_NR4', '$TK1_NR5']);
  for (const c of code) { const ok = await clickT(c.replace('TK1CMD', 'CMDTK1PIJL')); await wait(1500); await settle({ max: 30000 }); if (!ok) note(`!! ${c} not clickable`); }
  await wait(2500); await settle({ max: 60000 });
  check('retry: code solved ($TK1_FINISHED)', (await V('$TK1_FINISHED')) === '1');
  await shot('lose-troll-solved');
  check('retry: still in TROLLENKONING1 (no fall)', (await V('$CURRENTSCREEN')) === 'TROLLENKONING1');
  return q.done();
};
