// Phase F: Reizenrijk (steps 63-71): PADDELTJE, CARNAVAL1 monkey (BANAAN), CARNAVAL2 jigsaw (EMMER), CANIBAL1 pots (ring 3), DOOLHOF1 gate (KAART), DOOLHOF2 maze, DOOLHOF3 (ring 7).
// Usage: QA_START=<stage> (cf mc1 dh1 dh3); boots from save pE (Sterrenkamer).
import { mk } from './lib.mjs';
export default async (ctx) => {
  const q = mk(ctx);
  const { wait, note, check, S, V, go, clickT, clickCmd, clickSprite, waitScreen, settle, use, useHelper, take, shot, evaluate, hasCmd } = q;
  const STAGES = ['cf', 'mc1', 'dh1', 'dh3'];
  const start = process.env.QA_START || 'cf';
  const prev = { cf: 'pE', mc1: 'pF-cf', dh1: 'pF-mc1', dh3: 'pF-dh1' };
  const stop = process.env.QA_STOP || 'dh3';
  note(`# pF from ${prev[start]} (stages ${start}..${stop})`);
  await q.bootSave(prev[start], { $RATTAR_APPEARS: 9999 });
  let s;
  const stage = {
    async cf() {
      await go('CMDSK1_PAD');
      s = await S(); check('helper PADDELTJE', s.help === 'PADDELTJE', s.help);
      check('to KPREIS', await q.toRealm('KPREIS'));
      check('to CARNAVAL1', await go('CMDKPREIStoCF1', { expect: 'CARNAVAL1' }));
      await use('BANAAN', 'CMDCF1AAP'); await wait(2500); await settle({ max: 40000 });
      check('monkey fed ($CF1_FINISHED)', (await V('$CF1_FINISHED')) === '1');
      await shot('pF-cf1');
      check('to CARNAVAL2', await go('CMDCF1toCF2', { expect: 'CARNAVAL2' }));
      await settle({ max: 30000 });
      await shot('pF-cf2-start');
      // jigsaw: drag every piece to its home position
      const pieces = await evaluate(() => { const out = []; for (let i = 1; i <= 17; i++) { const b = globalThis.__pd.g.bitmaps.get('CF2_STUK' + String(i).padStart(2, '0')); if (b) out.push({ n: 'CF2_STUK' + String(i).padStart(2, '0'), hx: b.home[0], hy: b.home[1], x: b.rect.l, y: b.rect.t }); } return out; });
      check('17 pieces', pieces.length === 17, String(pieces.length));
      // pieces can lie (partly) under others or off the right/bottom edge: several passes, each takes what is reachable
      for (let pass = 1; pass <= 8; pass++) {
        let left = 0;
        for (const p of pieces) {
          const cur = await evaluate((n) => { const b = globalThis.__pd.g.bitmaps.get(n); return [b.rect.l, b.rect.t, !!(b.extra & 0x1000)]; }, p.n);
          if (!cur[2]) continue;
          if (!(await q.bitmapPoint(p.n))) { left++; continue; }
          await q.dragBitmap(p.n, p.hx - cur[0], p.hy - cur[1]);
          const after = await evaluate((n) => !!(globalThis.__pd.g.bitmaps.get(n).extra & 0x1000), p.n);
          if (after) left++;
        }
        note(`  jigsaw pass ${pass}: ${left} pieces left`);
        if (!left) break;
      }
      await wait(2000); await settle({ max: 30000 });
      check('jigsaw solved ($CF2_FINISHED)', (await V('$CF2_FINISHED')) === '1');
      await shot('pF-cf2-solved');
      await go('CF2OBJGRND');
      s = await S(); check('EMMER in the bag', s.inv.includes('EMMER'), s.inv);
      check('to CARNAVAL1', await go('CMDCF2toCF1', { expect: 'CARNAVAL1' }));
      check('to KPREIS', await go('CMDCF1toKPREIS', { expect: 'KPREIS' }));
    },
    async mc1() {
      check('to CANIBAL1', await go('CMDKPREIStoMC1', { expect: 'CANIBAL1' }));
      await settle({ max: 30000 });
      await shot('pF-mc1');
      // any pot with an empty hand: Pardoes goes into the pot
      await clickT('MC1POT1'); await wait(3000); await settle({ max: 40000 });
      await shot('pF-mc1-inpot');
      check('Pardoes in the pot (water command exists)', await hasCmd('CMDMC1WATER'));
      await clickSprite('MC1PARDOES'); await wait(800);
      await take('EMMER');
      for (let n = 1; n <= 5; n++) {
        let ok = false;
        for (let tries = 0; tries < 6 && !ok; tries++) {
          if ((await V('$INVMOVER')) !== 'EMMER' && (await V('$INVMOVER')) !== 'WATER') { await take('EMMER'); }
          await clickCmd('CMDMC1WATER'); await wait(300);
          const nxt = await V('$MC1_NEXT');
          await clickSprite(`MC1POT${n}`); await wait(900);
          await settle({ max: 20000, closeBag: false });
          ok = (await V('$MC1_NEXT')) !== nxt || (await V('$MC1_NEXT')) > String(n);
          note(`  pot ${n} try ${tries + 1}: $MC1_NEXT ${nxt} -> ${await V('$MC1_NEXT')} errors=${await V('$MC1_ERROR')}`);
          if (!ok && (await V('$MC1_FAILED')) === '1') break;
        }
      }
      await wait(2500); await settle({ max: 40000 });
      await shot('pF-mc1-solved');
      await go('MC1KRING');
      s = await S(); check('ring 3', s.rings.includes('3'), s.rings);
      check('to KPREIS', await go('CMDMC1toKPREIS', { expect: 'KPREIS' }));
    },
    async dh1() {
      check('to DOOLHOF1', await go('CMDKPREIStoDH1', { expect: 'DOOLHOF1' }));
      await use('KAART', 'CMDDH1HEK'); await wait(2500); await settle({ max: 40000 });
      check('gate open ($DH1_FINISHED)', (await V('$DH1_FINISHED')) === '1');
      check('to DOOLHOF2', await go('CMDDH1toDH2', { expect: 'DOOLHOF2' }));
      await shot('pF-dh2-start');
      // the 9 maze clicks: LEFT FORWARD RIGHT FORWARD RIGHT FORWARD LEFT RIGHT LEFT
      const moves = ['LEFT', 'FORWARD', 'RIGHT', 'FORWARD', 'RIGHT', 'FORWARD', 'LEFT', 'RIGHT', 'LEFT'];
      for (let i = 0; i < moves.length; i++) {
        if ((await V('$CURRENTSCREEN')) !== 'DOOLHOF2') break;
        const ok = await clickT('CMDDH2_' + moves[i]);
        await wait(1200); await settle({ max: 30000 });
        note(`  maze ${i + 1}/${moves.length} ${moves[i]} ${ok ? '' : '(not clickable!)'} view=${await V('$DH2_CURRENTSCREEN')}`);
        if (i === 3 || i === 6) await shot('pF-dh2-' + (i + 1));
      }
      check('maze exit to DOOLHOF3', await waitScreen('DOOLHOF3', 60000));
    },
    async dh3() {
      await settle({ max: 30000 });
      await shot('pF-dh3');
      await useHelper('CMDDH3OVERGANG'); await wait(3000); await settle({ max: 40000 });
      check('stepping stone ($DH3_FINISHED1)', (await V('$DH3_FINISHED1')) === '1');
      await go('CMDDH3STEEKOVER'); await wait(3500); await settle({ max: 40000 });
      await shot('pF-dh3-across');
      for (let i = 1; i <= 4; i++) {
        const [cur, want] = await q.Vs([`$DH3_KNOP${i}`, `$DH3_KNOP${i}_VAL`]);
        if (cur !== want) { await clickT(`CMDDH3KNOP${i}`); await wait(800); }
      }
      await wait(2500); await settle({ max: 40000 });
      check('buttons solved ($DH3_FINISHED2)', (await V('$DH3_FINISHED2')) === '1');
      await go('DH3KRING');
      s = await S(); check('ring 7', s.rings.includes('7'), s.rings);
      await shot('pF-ring7');
      check('to DOOLHOF1', await go('CMDDH3STEEKTERUG', { expect: 'DOOLHOF1' }));
      check('to KPREIS', await go('CMDDH1toKPREIS', { expect: 'KPREIS' }));
      check('to STERRENKAMER', await go('CMDKPREIStoSK', { expect: 'STERRENKAMER' }));
    },
  };
  for (const name of STAGES.slice(STAGES.indexOf(start))) {
    note(`## stage ${name}`);
    await stage[name]();
    await q.st(`end ${name}`);
    await q.saveTo('pF-' + name);
    if (name === stop) break;
  }
  return q.done();
};
