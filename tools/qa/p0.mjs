// Phase 0: intro (movie, name entry, second movie, the hand) to the Sterrenkamer. Run with ?play=1&mute=1&debug=1&noprint=1
import { mk } from './lib.mjs';
export default async (ctx) => {
  const q = mk(ctx);
  const { wait, page, key, click, check, note, shot } = q;
  note('# p0 intro');
  await q.waitFor(() => !!globalThis.__pd, null, { max: 30000, what: '__pd' });
  await wait(1500);
  check('intro movie A plays', (await q.S()).movie);
  await shot('p0-introA');
  await click(320, 240); // skip
  check('name screen shows the edit box', await q.waitFor(() => !!document.querySelector('input.pd-edit'), null, { max: 15000 }));
  await wait(500);
  await shot('p0-name');
  await page.keyboard.type('Qa Tester');
  await wait(300);
  check('name stored', (await q.V('$SPELERNAAM')) === 'Qa Tester', await q.V('$SPELERNAAM'));
  await key('Enter');
  await wait(1500);
  check('intro movie B plays', (await q.S()).movie);
  await click(320, 240);
  check('hand command appears', await q.waitFor(() => globalThis.__pd.cmds.cmds.get('CMDINTROHAND')?.active, null, { max: 20000 }));
  await shot('p0-hand');
  await q.clickCmd('CMDINTROHAND');
  check('arrive in Sterrenkamer', await q.waitScreen('STERRENKAMER', 60000));
  await shot('p0-sk');
  await q.st('end');
  await q.saveTo('p0');
  return q.done();
};
