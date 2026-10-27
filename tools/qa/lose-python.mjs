// Lose path 2: PYTHON1 memory game: three mistakes (L9330-9358 #GAMEOVER) send Pardoes back to KPRUIG, the puzzle restarts on the next visit; then win it.
// Boots from save pB-lf (Sterrenkamer).
import { mk } from './lib.mjs';
export default async (ctx) => {
  const q = mk(ctx);
  const { wait, note, check, S, V, go, settle, shot, evaluate, clickCmd } = q;
  note('# lose-python from pB-lf');
  await q.bootSave('pB-lf', { $RATTAR_APPEARS: 9999 });
  check('to KPRUIG', await q.toRealm('KPRUIG'));
  const play = async (win) => {
    check(`to PYTHON1 (${win ? 'win' : 'lose'} run)`, await go('CMDKPRUIGtoPY1', { expect: 'PYTHON1' }));
    const t0 = q.clock(); let rounds = 0, shots = 0;
    while (q.clock() - t0 < 200000) {
      const st = await evaluate(() => { const p = globalThis.__pd; const v = p.vm.vars; const pos = v.get('$PY1_PUZ_OKPOS'); const act = [1, 2, 3].filter((i) => { const c = p.cmds.cmds.get('CMDPY1_SOLVE' + i); return c && c.active && c.enabled; }); return { scr: v.get('$CURRENTSCREEN'), fin: v.get('$PY1_FINISHED'), pos, act, tries: v.get('$PY1_TRYCNT'), solved: v.get('$PY1_SOLVED') }; });
      if (st.scr !== 'PYTHON1' || st.fin === '1') break;
      if (st.act.length) {
        const pick = win ? st.pos : String([1, 2, 3].find((i) => String(i) !== st.pos));
        await clickCmd('CMDPY1_SOLVE' + pick); rounds++;
        note(`  round ${rounds}: answer ${pick} (correct ${st.pos}) tries=${st.tries} solved=${st.solved}`);
        if (!win && shots++ === 0) await shot('lose-python-wrong');
        await wait(1500);
      } else await wait(100);
    }
    return rounds;
  };
  await play(false);
  await wait(2000); await settle({ max: 60000 });
  const s = await S();
  check('lost: back in KPRUIG', s.screen === 'KPRUIG', s.screen);
  check('lost: puzzle not finished', (await V('$PY1_FINISHED')) !== '1');
  await shot('lose-python-after');
  await play(true);
  check('retry won ($PY1_FINISHED)', (await V('$PY1_FINISHED')) === '1');
  check('then PYTHON2', await q.waitScreen('PYTHON2', 60000));
  await shot('lose-python-won');
  return q.done();
};
