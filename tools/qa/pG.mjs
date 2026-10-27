// Phase G: endgame (steps 72-76): ring panel, EINDSPEL1 final choice, EINDSPEL2 diploma (+ print page), credits and exit.
// Usage: tools/qa/run.sh pG.mjs '?noprint=1'   QA_LOSE=1 plays the wrong final choice instead (game over, full reset).
import { mk } from './lib.mjs';
export default async (ctx) => {
  const q = mk(ctx);
  const { wait, note, check, S, V, go, clickT, clickCmd, clickSprite, waitScreen, settle, shot, evaluate, waitFor, hasCmd, page } = q;
  const lose = process.env.QA_LOSE === '1';
  const fromChoice = process.env.QA_FROM === 'choice';
  note(`# pG from ${fromChoice ? 'pG-choice' : 'pF-dh3'}${lose ? ' (wrong final choice)' : ''}`);
  await q.bootSave(fromChoice ? 'pG-choice' : 'pF-dh3', { $RATTAR_APPEARS: 9999 });
  let s;
  page.on('framenavigated', (f) => note(`  [page navigated: ${f.url()}]`));
  page.on('crash', () => note('  [page crashed]'));
  page.on('console', (m) => { if (m.type() === 'log') note('  [console] ' + m.text().slice(0, 200)); });
  if (!fromChoice) {
  await q.clickSprite('SK1_KAST', [535, 355]); await settle({ max: 30000 }); // KASTLA: the drawer cabinet
  await q.clickSprite('SK1_BKLA', [530, 340]); await wait(2500); await settle({ max: 30000 });
  check('ring panel open', await hasCmd('CMDKRING1'));
  await shot('pG-panel');
  const slots = await evaluate(() => [1, 2, 3, 4, 5, 6, 7, 8].map((i) => { const sp = globalThis.__pd.g.sprites.find('SK1_KRING' + i); return { i, mv: sp?.cur.m.key ?? '' }; }));
  note(`bottom row: ${slots.map((x) => x.i + ':' + x.mv).join(' ')}`);
  for (const sl of slots) {
    const n = (/(\d)/.exec(sl.mv) ?? [])[1];
    if (!n) { note(`!! slot ${sl.i} shows no ring (${sl.mv})`); continue; }
    await clickT('SK1_KRING' + sl.i); await wait(500);
    await clickCmd('CMDKRING' + n); await wait(900);
  }
  await wait(2500);
  await shot('pG-panel-done');
  check('all rings placed ($SK1_FINISHED)', (await V('$SK1_FINISHED')) === '1');
  }
  // the panel closes by itself, EINDSPEL1 starts with the movie
  if (fromChoice) await wait(0);
  check('EINDSPEL1', await waitFor(() => globalThis.__pd.vm.vars.get('$CURRENTSCREEN') === 'EINDSPEL1', null, { max: 90000, what: 'EINDSPEL1' }));
  check('ENDPRE movie plays', await waitFor(() => globalThis.__pd.media.playing, null, { max: 20000, what: 'ENDPRE movie' }));
  await shot('pG-endpre');
  await q.skipMovie();
  await wait(2500); await settle({ max: 40000 });
  await shot('pG-choice');
  const ok = await V('$ES1_COMMAND');
  note(`correct choice: ${ok}`);
  const pick = lose ? ['1', '2', '3'].find((k) => k !== ok) : ok;
  await q.saveTo('pG-choice');
  if (lose) await clickT(`CMDES1_KLIK${pick}`); else await go(`CMDES1_KLIK${pick}`);
  if (lose) {
    check('wrong choice: game over movie', await waitFor(() => globalThis.__pd.media.playing || globalThis.__pd.vm.vars.get('$CURRENTSCREEN') === 'PARDOESEINDE', null, { max: 60000 }));
    await wait(1500); await shot('pG-gameover');
    await q.skipMovie();
    check('back in the Sterrenkamer with a reset game', await waitScreen('STERRENKAMER', 90000));
    s = await S();
    check('game was reset (bag, rings empty)', s.rings === '' && s.inv === 'LEEG,LEEG,LEEG,LEEG', JSON.stringify([s.rings, s.inv]));
    await shot('pG-after-gameover');
    return q.done();
  }
  // timeline of the transition: screen / movie state every 100 ms
  const tl = []; let t0 = q.clock(), lastKey = '';
  while (q.clock() - t0 < 60000) {
    const st = await evaluate(() => { const p = globalThis.__pd; return `${p.vm.vars.get('$CURRENTSCREEN')}${p.media.playing ? '+movie' : ''}${p.cmds.cmds.get('CMDES2PRINT')?.active ? '+print' : ''}`; });
    if (st !== lastKey) { tl.push(`${Math.round((q.clock() - t0) / 100) / 10}s ${st}`); lastKey = st; }
    if (st.startsWith('EINDSPEL2') && st.includes('+print')) break;
    await wait(100);
  }
  note(`timeline: ${tl.join(' | ')}`);
  check('EINDSPEL2 with the diploma and its print command', lastKey.startsWith('EINDSPEL2') && lastKey.includes('+print'), lastKey);
  await wait(1500);
  await shot('pG-diploma');
  note('active commands: ' + (await evaluate(() => [...globalThis.__pd.cmds.cmds.values()].filter((c) => c.active).map((c) => c.name + (c.enabled ? '' : '(dis)')).join(' '))));
  check('print command on the diploma', await hasCmd('CMDES2PRINT'));
  await go('CMDES2PRINT'); await wait(3000);
  check('print page built (#pd-print img)', await evaluate(() => !!document.querySelector('#pd-print img')));
  const dims = await evaluate(() => { const i = document.querySelector('#pd-print img'); return i ? [i.naturalWidth, i.naturalHeight] : null; });
  note(`print image ${dims}`);
  const png = await evaluate(() => document.querySelector('#pd-print img')?.src ?? '');
  if (png.startsWith('data:image/png;base64,')) (await import('node:fs')).writeFileSync('/tmp/pd-qa/diploma-print.png', Buffer.from(png.slice(22), 'base64'));
  // credits
  check('credits screen (CMDEXITTITEL)', await waitFor(() => globalThis.__pd.vm.vars.get('$CURRENTSCREEN') === 'CMDEXITTITEL' || !!globalThis.__pd.cmds.cmds.get('CMDEXITTITEL')?.active, null, { max: 30000, what: 'credits' }) || (await clickCmd('CMDES2KLAAR'), await waitFor(() => !!globalThis.__pd.cmds.cmds.get('CMDEXITTITEL')?.active, null, { max: 30000 })));
  await wait(2000);
  await shot('pG-credits');
  await q.click(320, 240); // any click: Exit
  check('back at the start screen', await waitFor(() => !!document.querySelector('.bdb-start'), null, { max: 30000, what: 'start screen' }));
  await shot('pG-start');
  return q.done();
};
