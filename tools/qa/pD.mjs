// Phase D: Anderrijk II (steps 52-57): SPOOKSLOT1 stones, SPOOKSLOT2 torch (LUCIFER), SPOOKSLOT3 tile field + ghosts (ring 1), back to the Sterrenkamer.
// Usage: QA_START=<stage> (ss1 ss3 ghost); boots from save pC-vc2 (KPRUIG) by default. QA_DIE=1 plays the game-over path instead (click TEGEND at once).
import { mk } from './lib.mjs';
export default async (ctx) => {
  const q = mk(ctx);
  const { wait, note, check, S, V, go, clickT, clickCmd, clickSprite, waitScreen, settle, use, shot, evaluate, waitFor } = q;
  const STAGES = ['ss1', 'ss3', 'ghost'];
  const start = process.env.QA_START || 'ss1';
  const prev = { ss1: 'pC-vc2', ss3: 'pD-ss1', ghost: 'pD-ss3' };
  const stop = process.env.QA_STOP || 'ghost';
  note(`# pD from ${prev[start]} (stages ${start}..${stop})`);
  await q.bootSave(prev[start], { $RATTAR_APPEARS: 9999 });
  let s;
  const ROUTE1 = [88, 76, 65, 66, 54, 55, 69, 82, 71, 59, 44, 30, 15, 28, 13, 12, 25, 38, 37, 50, 49, 34, 20];
  const ROUTE2 = [91, 81, 70, 58, 45, 30, 29, 14, 13, 26, 25, 38, 37, 22];
  const stage = {
    async ss1() {
      check('to KPANDER', await go('CMDKPRUIGtoKPANDER', { expect: 'KPANDER' }));
      check('to SPOOKSLOT1', await go('CMDKPANDERtoSS1', { expect: 'SPOOKSLOT1' }));
      await shot('pD-ss1');
      const vals = await q.Vs(['$SS1_STEEN1_VAL', '$SS1_STEEN2_VAL', '$SS1_STEEN3_VAL', '$SS1_STEEN4_VAL']);
      note(`stone variant: ${vals}`);
      for (let i = 1; i <= 4; i++) if (vals[i - 1] === '1') { await clickT(`CMDSTEEN${i}`); await wait(1500); await settle({ max: 20000 }); }
      await wait(2500); await settle({ max: 30000 });
      check('stones solved ($SS1_FINISHED)', (await V('$SS1_FINISHED')) === '1');
      await shot('pD-ss1-solved');
      check('to SPOOKSLOT2', await go('CMDSS1toSS2', { expect: 'SPOOKSLOT2' }));
    },
    async ss3() {
      await shot('pD-ss2');
      await use('LUCIFER', 'CMDSS2toSS3'); await wait(3000);
      check('to SPOOKSLOT3', await waitScreen('SPOOKSLOT3', 60000));
      check('torch lit ($SS2_FINISHED)', (await V('$SS2_FINISHED')) === '1');
      await settle({ max: 40000 });
      await shot('pD-ss3');
      const file = await V('$SS3_PUZZELFILE'); const route = /HOF1\.MAP/i.test(file) ? ROUTE1 : ROUTE2;
      note(`tile field ${file}, ${route.length} tiles`);
      await clickT('TEGSTART'); await wait(2500); await settle({ max: 30000 });
      for (const n of route) { const ok = await clickT(`TEG${n}`); await wait(700); await settle({ max: 20000 }); if (!ok) note(`!! tile TEG${n} not clickable`); }
      await shot('pD-ss3-end-tile');
      check('TEGEND available', await q.hasCmd('TEGEND'));
    },
    async ghost() {
      const die = process.env.QA_DIE === '1';
      const sample = () => evaluate(() => {
        const p = globalThis.__pd, f = (n) => { const s = p.g.sprites.find(n); return s ? { x: Math.round(s.x), vis: s.visible, mv: s.cur.m.key, col: !!(s.f1 & 0x40) } : null; };
        return { scr: p.vm.vars.get('$CURRENTSCREEN'), g1: f('SPOOK1'), g2: f('SPOOK2'), g3: f('SPOOK3'), gk: f('KSPOOK'), par: (() => { const s = p.g.sprites.find('PARDOES'); return s && { x: Math.round(s.x), y: Math.round(s.y + s.h) }; })() };
      });
      const t0 = q.clock(); let clicked = false, tlog = [];
      const last = ROUTE_LAST();
      function ROUTE_LAST() { return null; }
      if (die) {
        // wait until a plain ghost is about to reach Pardoes with the ring ghost not ahead of it, then switch the collisions on
        const t1 = q.clock(); let did = false;
        while (q.clock() - t1 < 150000 && !did) {
          const g = await sample();
          const act = (x) => x && x.vis && x.mv === 'RIGHT';
          const pl = [g.g1, g.g2, g.g3].filter((x) => act(x) && x.x >= 40 && x.x < 130);
          const kAhead = g.gk && act(g.gk) && g.gk.x > pl[0]?.x - 5 && g.gk.x < 255;
          if (pl.length && !kAhead) { await clickT('TEGEND'); did = true; note(`clicked TEGEND with a plain ghost at x=${pl[0].x}`); }
          await wait(40);
        }
        // a ghost that is not the ring ghost catches Pardoes: GAMEOVER.AVI, full reset, back in the Sterrenkamer
        const over = await waitFor(() => globalThis.__pd.vm.vars.get('$CURRENTSCREEN') === 'PARDOESEINDE' || globalThis.__pd.media.playing, null, { max: 120000, what: 'game over' });
        check('a ghost catches Pardoes: game over', !!over);
        if (over) { await wait(1500); await shot('pD-gameover'); }
        await q.skipMovie();
        check('reset to the Sterrenkamer', await waitScreen('STERRENKAMER', 90000));
        s = await S(); check('game reset (bag/rings empty)', s.rings === '' && s.inv === 'LEEG,LEEG,LEEG,LEEG', JSON.stringify([s.rings, s.inv]));
        return;
      }
      while (q.clock() - t0 < 150000) {
        const g = await sample();
        if (g.scr !== 'SPOOKSLOT3') break;
        const act = (x) => x && x.vis && x.mv === 'RIGHT';
        if (tlog.length < 400 && (q.clock() - t0) % 1000 < 100) tlog.push(`${Math.round((q.clock() - t0) / 100) / 10}:${['g1', 'g2', 'g3', 'gk'].map((k) => (g[k] ? g[k].mv[0] + g[k].x : '-')).join('/')}`);
        const plain = g.gk && [g.g1, g.g2, g.g3].some((x) => act(x) && x.x > g.gk.x - 5 && x.x < 255);
        if (!clicked && g.gk && act(g.gk) && g.gk.x >= 20 && g.gk.x < 130 && !plain) { await clickT('TEGEND'); clicked = true; note(`clicked TEGEND with KSPOOK at x=${g.gk.x} (t=${Math.round((q.clock() - t0) / 1000)} s)`); }
        if (clicked && g.scr === 'SPOOKSLOT3' && (await q.hasCmd('CMDSS3EXIT')) && (await q.hasSprite('SS3KRING'))) break;
        await wait(40);
      }
      note(`ghost samples ${tlog.filter((_, i) => i % 3 === 0).join(' ')}`);
      s = await S();
      check('ring ghost caught, no game over', s.screen === 'SPOOKSLOT3' && (await q.hasSprite('SS3KRING')), s.screen);
      await shot('pD-ss3-ring');
      await go('SS3KRING');
      s = await S(); check('ring 1', s.rings.includes('1'), s.rings);
      check('to SPOOKSLOT1', await go('CMDSS3EXIT', { expect: 'SPOOKSLOT1' }));
      check('to KPANDER', await go('CMDSS1toKPANDER', { expect: 'KPANDER' }));
      check('to STERRENKAMER', await go('CMDKPANDERtoSK', { expect: 'STERRENKAMER' }));
    },
  };
  for (const name of STAGES.slice(STAGES.indexOf(start))) {
    note(`## stage ${name}`);
    await stage[name]();
    await q.st(`end ${name}`);
    if (process.env.QA_DIE !== '1') await q.saveTo('pD-' + name);
    if (name === stop) break;
  }
  return q.done();
};
