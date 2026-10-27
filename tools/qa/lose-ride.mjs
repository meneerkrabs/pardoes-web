// Lose path 3: piranha ride: four bites sink the boat (L13951-13969 #SINK, L13547-13550 #FROMPIW resets $PI1_FINISHED); pump again, ride again and win.
// Boots from save pA-vm (PIRANHA1 after the word puzzle; the paddle lies at the boat, the pump is in the bag).
import { mk } from './lib.mjs';
export default async (ctx) => {
  const q = mk(ctx);
  const { wait, note, check, S, V, go, settle, shot, use, waitFor } = q;
  note('# lose-ride from pA-vm');
  await q.bootSave('pA-vm', { $RATTAR_APPEARS: 9999 });
  const start = async () => {
    if (!(await S()).inv.includes('PEDDEL')) await go('CMDPI1OBJBOOT');
    if ((await V('$PI1_FINISHED')) !== '1') { await use('POMP', 'P1BOOT', [590, 430]); await settle({ max: 30000 }); }
    check('boat pumped', (await V('$PI1_FINISHED')) === '1');
    await use('PEDDEL', 'P1BOOT', [400, 400]);
    check('ride starts', await waitFor(() => globalThis.__pd.vm.vars.get('$CURRENTSCREEN') === 'PIRANHA2', null, { max: 60000, what: 'PIRANHA2' }));
  };
  await start();
  const r = await q.rideBot({ chase: true, shotPrefix: 'lose-ride' });
  note(`chasing the fish: ended on ${r.screen} with ${r.bites} bites`);
  check('sunk: back in PIRANHA1', r.screen === 'PIRANHA1');
  check('4 bites counted', r.bites === '4', r.bites);
  await wait(2000); await settle({ max: 60000 });
  await shot('lose-ride-sunk');
  let s = await S();
  check('boat deflated again ($PI1_FINISHED=0)', (await V('$PI1_FINISHED')) === '0');
  check('pump and paddle still in the bag', s.inv.includes('POMP') && s.inv.includes('PEDDEL'), s.inv);
  let r2 = { screen: '' };
  for (let attempt = 1; attempt <= 4 && r2.screen !== 'PIRANHA3'; attempt++) {
    if (attempt > 1) { await wait(2000); await settle({ max: 60000 }); }
    await start();
    r2 = await q.rideBot({ chase: false, shotPrefix: 'lose-ride-retry' });
    note(`retry ${attempt}: ended on ${r2.screen} with ${r2.bites} bites`);
  }
  check('retry survived to PIRANHA3', r2.screen === 'PIRANHA3');
  await settle({ max: 60000 });
  await shot('lose-ride-won');
  return q.done();
};
