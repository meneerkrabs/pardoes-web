// Phase C: Ruigrijk (steps 35-51): PARDOTJE, PYTHON1 memory game (ring 2), OLDTIMER1 crank, OLDTIMER2 Tuffer game, OLDTIMER3 map, VOCSCHIP1 planks, VOCSCHIP2 chain (ring 6, LUCIFER, STEEN).
// Usage: QA_START=<stage> (py ot ot2 vc1 vc2); boots from save pB-lf (Sterrenkamer) by default.
import { mk } from './lib.mjs';
export default async (ctx) => {
  const q = mk(ctx);
  const { wait, note, check, S, V, go, clickT, clickCmd, waitScreen, settle, use, useHelper, take, shot, evaluate, waitFor, hasCmd } = q;
  const STAGES = ['py', 'ot', 'ot2', 'vc1', 'vc2'];
  const start = process.env.QA_START || 'py';
  const prev = { py: 'pB-lf', ot: 'pC-py', ot2: 'pC-ot', vc1: 'pC-ot2', vc2: 'pC-vc1' };
  const stop = process.env.QA_STOP || 'vc2';
  note(`# pC from ${prev[start]} (stages ${start}..${stop})`);
  await q.bootSave(prev[start], { $RATTAR_APPEARS: 9999 });
  let s;
  const stage = {
    async py() {
      await q.clickSprite('SK1_KAST', [593, 327]); await settle({ max: 30000 }); // PARDOT trigger: the helper PARDOTJE
      s = await S(); check('helper PARDOTJE', s.help === 'PARDOTJE', s.help);
      check('to KPRUIG', await q.toRealm('KPRUIG'));
      check('to PYTHON1', await go('CMDKPRUIGtoPY1', { expect: 'PYTHON1' }));
      await shot('pC-py1');
      // the memory game: whenever the answer commands exist, click the one for $PY1_PUZ_OKPOS
      const t0 = q.clock(); let rounds = 0, last = '';
      while (q.clock() - t0 < 240000) {
        const st = await evaluate(() => { const p = globalThis.__pd; const v = p.vm.vars; const pos = v.get('$PY1_PUZ_OKPOS'); const c = p.cmds.cmds.get('CMDPY1_SOLVE' + pos); return { scr: v.get('$CURRENTSCREEN'), fin: v.get('$PY1_FINISHED'), pos, ok: !!(c && c.active && c.enabled), solved: v.get('$PY1_SOLVED'), tries: v.get('$PY1_TRYCNT') }; });
        if (st.scr !== 'PYTHON1' || st.fin === '1') break;
        if (st.ok) { await q.clickCmd('CMDPY1_SOLVE' + st.pos); rounds++; note(`  round ${rounds}: pos ${st.pos} solved=${st.solved} tries=${st.tries}`); await wait(1500); } else await wait(100);
      }
      check('memory game won ($PY1_FINISHED)', (await V('$PY1_FINISHED')) === '1');
      check('moved on to PYTHON2', await waitScreen('PYTHON2', 60000));
      await shot('pC-py2');
      await go('PY2KRING');
      s = await S(); check('ring 2', s.rings.includes('2'), s.rings);
    },
    async ot() {
      check('to OLDTIMER1', await go('CMDPY2toOT1', { expect: 'OLDTIMER1' }));
      await use('SLINGER', 'CMDOT1STARTEN'); await wait(2000); await settle({ max: 40000 });
      check('car started ($OT1_FINISHED)', (await V('$OT1_FINISHED')) === '1');
      await shot('pC-ot1');
    },
    async ot2() {
      // the Tuffer driving game: plan a path through the obstacle pixel masks once (read-only analysis of the level), then steer along it with real arrow keys
      let result = '', planCache = null;
      for (let attempt = 1; attempt <= 4 && result !== 'OLDTIMER3'; attempt++) {
        check(`attempt ${attempt}: to OLDTIMER2`, await go('CMDOT1toOT2', { expect: 'OLDTIMER2', max: 60000 }));
        await q.key('ArrowLeft'); await q.key('ArrowLeft'); await q.key('ArrowUp'); // speed |vx|=3 at once, rise above the pit while the plan is computed
        const plan = planCache ?? await evaluate(() => {
          const p = globalThis.__pd, dx = p.dx, car = p.g.sprites.find('OT2TUFFER');
          const carImg = p.g.sprites.frameBm(car).img, CW = car.w, CH = car.h, CX = car.x;
          const hitPix = (a, ra, b, rb) => { const l = Math.max(ra.x1, rb.x1), t = Math.max(ra.y1, rb.y1), r = Math.min(ra.x2, rb.x2), bt = Math.min(ra.y2, rb.y2); for (let y = t; y < bt; y++) for (let x = l; x < r; x++) { const ax = x - ra.x1, ay = y - ra.y1, bx = x - rb.x1, by = y - rb.y1; if (ax >= a.w || ay >= a.h || bx >= b.w || by >= b.h) continue; if ((a.idx[ay * a.w + ax] & b.idx[by * b.w + bx]) !== 0) return true; } return false; };
          const obs = dx.obstacles; const egel = dx.colliders.find((c) => c.spr.name === 'OT2EGEL');
          const touch = (a, b) => !(a.x2 < b.x1 || b.x2 < a.x1 || a.y2 < b.y1 || b.y2 < a.y1);
          const free = (sx, y) => { const cw = { x1: CX + sx, y1: y, x2: CX + sx + CW, y2: y + CH }; for (const o of obs) if (touch(o, cw) && hitPix(o.bm.img, o, carImg, cw)) return false; if (egel) { const e = { x1: egel.spr.x - 30, y1: egel.spr.y - 20, x2: egel.spr.x + egel.spr.w + 30, y2: egel.spr.y + egel.spr.h + 20 }; if (touch(e, cw)) return false; } return true; };
          const X0 = Math.round(dx.scrollX), STEP = 6, YS = [], Y0 = 60, Y1 = 450 - CH;
          for (let y = Y0; y <= Y1; y += 3) YS.push(y);
          const cols = Math.floor(X0 / STEP);
          const out = {};
          for (const margin of [12, 9, 6, 3, 0]) {
            const ok = []; // ok[k][j]
            for (let k = 0; k <= cols; k++) { const sx = X0 - k * STEP; const row = new Uint8Array(YS.length); for (let j = 0; j < YS.length; j++) { let f = true; for (let m = -margin; m <= margin && f; m += 3) { const y = YS[j] + m; if (y < Y0 || y > Y1 || !free(sx, y)) f = false; } row[j] = f ? 1 : 0; } ok.push(row); }
            // backward table: good[k][j] = the car can still get to the end from here
            const good = new Array(cols + 1);
            good[cols] = Uint8Array.from(ok[cols]);
            for (let k = cols - 1; k >= 0; k--) { const g = new Uint8Array(YS.length); for (let j = 0; j < YS.length; j++) if (ok[k][j]) for (let d = -2; d <= 2; d++) { const jj = j + d; if (jj >= 0 && jj < YS.length && good[k + 1][jj]) { g[j] = 1; break; } } good[k] = g; }
            if (good[0].some((v) => v)) return { margin, X0, STEP, YS, good: good.map((g) => Array.from(g).join('')) };
          }
          return null;
        });
        check(`attempt ${attempt}: a path through the obstacle masks exists`, !!plan, plan ? `margin ${plan.margin}` : '');
        if (!plan) break;
        planCache = plan;
        const t0 = q.clock(); let shots = 0, lastShot = 0, log = [];
        while (q.clock() - t0 < 60000) {
          const st = await evaluate(() => {
            const p = globalThis.__pd, dx = p.dx, car = p.g.sprites.find('OT2TUFFER');
            if (p.vm.vars.get('$CURRENTSCREEN') !== 'OLDTIMER2' || !car) return { scr: p.vm.vars.get('$CURRENTSCREEN') };
            return { scr: 'OLDTIMER2', sx: dx.scrollX, vx: dx.vx, vy: dx.vy, y: car.y, fin: dx.finished };
          });
          if (st.scr !== 'OLDTIMER2') { result = st.scr; break; }
          if (st.vx === 0) { note(`  stopped at sx=${Math.round(st.sx)} y=${st.y}`); await q.key('ArrowLeft'); await q.key('ArrowLeft'); }
          const k = Math.min(plan.good.length - 1, Math.max(0, Math.round((plan.X0 - st.sx) / plan.STEP) + 4)); // aim a little ahead
          // nearest y (at column k) from which the end can still be reached
          let tgt = st.y, bd = 1e9; for (let j = 0; j < plan.YS.length; j++) if (plan.good[k][j] === '1') { const dd = Math.abs(plan.YS[j] - st.y); if (dd < bd) { bd = dd; tgt = plan.YS[j]; } }
          const d = tgt - st.y;
          const want = d > 5 ? 1 : d < -5 ? -1 : 0;
          if (want !== st.vy) { if (st.vy !== 0) await q.key('ArrowUp'); else await q.key(want > 0 ? 'ArrowDown' : 'ArrowUp'); }
          if (q.clock() - lastShot > 10000 && shots < 3) { lastShot = q.clock(); shots++; await shot(`pC-ot2-a${attempt}-${shots}`); }
          if (log.length < 600) log.push(`${Math.round(st.sx)}:${st.y}/${tgt}`);
          await wait(20);
        }
        note(`  attempt ${attempt}: ended on ${result || 'timeout'} after ${Math.round((q.clock() - t0) / 1000)} s; track ${log.filter((_, i) => i % 30 === 0).join(' ')}`);
        if (result === 'OLDTIMER1' || result.startsWith('DEPUT')) { await settle({ max: 40000 }); if (result.startsWith('DEPUT')) { note('!! fell in the well'); break; } result = ''; }
      }
      check('drove to OLDTIMER3', (await V('$CURRENTSCREEN')) === 'OLDTIMER3');
      await settle({ max: 40000 });
      await shot('pC-ot3');
    },
    async vc1() {
      await go('OT3OBJGRND');
      s = await S(); check('KAART in the bag', s.inv.includes('KAART'), s.inv);
      check('to KPRUIG', await go('CMDOT3toKPRUIG', { expect: 'KPRUIG' }));
      check('to VOCSCHIP1', await go('CMDKPRUIGtoVC1', { hint: [620, 260], expect: 'VOCSCHIP1' }));
      await shot('pC-vc1');
      for (let i = 1; i <= 8; i++) {
        const name = `VC1PLANG${i}`;
        const ok = await clickT(name); await wait(600);
        if (!ok) { note(`!! plank ${name} not clickable`); continue; }
        await clickCmd('CMDVC1PLANKIER'); await wait(1200); await settle({ max: 20000 });
        note(`  plank ${i} placed, $VC1_DONE=${await V('$VC1_DONE')}`);
      }
      check('gangway complete ($VC1_FINISHED)', (await V('$VC1_FINISHED')) === '1');
      await shot('pC-vc1-done');
      check('to VOCSCHIP2', await go('CMDVC1toVC2', { expect: 'VOCSCHIP2' }));
    },
    async vc2() {
      await shot('pC-vc2');
      await useHelper('VC2OBJTRAP'); await settle({ max: 30000 });
      s = await S(); check('ZAAG from the stairs (PARDOTJE)', s.inv.includes('ZAAG'), s.inv);
      await go('VC2MASTDEUR'); await wait(1000);
      await use('ZAAG', 'VC2TRALIES'); await wait(1500); await settle({ max: 30000 });
      check('bars sawn ($VC2_FINISHED)', (await V('$VC2_FINISHED')) === '1');
      await go('VC2KRING');
      s = await S(); check('ring 6', s.rings.includes('6'), s.rings);
      await shot('pC-ring6');
      await go('VC2DEUR'); await wait(2500); await settle({ max: 20000 });
      await go('VC2OBJDEUR');
      s = await S(); check('LUCIFER', s.inv.includes('LUCIFER'), s.inv);
      await go('VC2LUIK'); await wait(2500); await settle({ max: 20000 });
      await go('VC2OBJLUIK');
      s = await S(); check('STEEN in the bag, POMP pushed out', s.inv.includes('STEEN') && !s.inv.includes('POMP'), s.inv);
      await shot('pC-vc2-end');
      check('to VOCSCHIP1', await go('CMDVC2toVC1', { expect: 'VOCSCHIP1' }));
      check('to KPRUIG', await go('CMDVC1toKPRUIG', { expect: 'KPRUIG' }));
    },
  };
  for (const name of STAGES.slice(STAGES.indexOf(start))) {
    if (!stage[name]) break;
    note(`## stage ${name}`);
    await stage[name]();
    await q.st(`end ${name}`);
    await q.saveTo('pC-' + name);
    if (name === stop) break;
  }
  return q.done();
};
