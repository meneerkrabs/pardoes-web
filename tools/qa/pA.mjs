// Phase A: Anderrijk I (steps 4-25 of the playthrough plan): SPIEGEL, PIETERTJE, PIRANHA1 pump + boat, FATAMORGANA1/2 (ring 8),
// VEERMAN1 word puzzle, the ride, PIRANHA3 (SLINGER). Chained through saves (/tmp/pd-qa/save-*.json) and the real "Verder spelen" path.
// Usage: QA_START=<stage> tools/qa/run.sh pA.mjs ''   (stages: pi1 pump boat fm vm ride pi3; default: from save p0 through all)
import { mk } from './lib.mjs';
export default async (ctx) => {
  const q = mk(ctx);
  const { wait, note, check, S, V, go, clickT, clickCmd, clickSprite, waitScreen, settle, use, useHelper, take, shot, evaluate, waitFor, hasCmd, hasSprite } = q;
  const STAGES = ['pi1', 'pump', 'boat', 'fm', 'vm', 'ride', 'pi3'];
  const start = process.env.QA_START || 'pi1';
  const prev = { pi1: 'p0', pump: 'pA-pi1', boat: 'pA-pump', fm: 'pA-boat', vm: 'pA-fm', ride: 'pA-vm', pi3: 'pA-ride' };
  const stop = process.env.QA_STOP || 'pi3';
  note(`# pA from ${prev[start]} (stages ${start}..${stop})`);
  await q.bootSave(prev[start], { $RATTAR_APPEARS: 9999 });
  let s;
  const hop = async (name) => { const ok = await clickT(name); await wait(1200); await settle({ max: 20000 }); return ok; };
  const stones = ['PSTAM07', 'PSTAM06', 'PSTAM05', 'PSTAM04', 'PSTAM03', 'PSTAM02', 'PSTAM01']; // never PSTAMAK (the trap stone)
  const stage = {
    async pi1() {
      await clickSprite('SK1OBJMUUR'); await settle();
      s = await S(); check('SPIEGEL in the bag', s.inv.startsWith('SPIEGEL'), s.inv);
      await go('CMDSK1_PIT');
      s = await S(); check('helper PIETERTJE', s.help === 'PIETERTJE', s.help);
      check('to KPANDER', await q.toRealm('KPANDER'));
      await shot('pA-kpander');
      check('to PIRANHA1', await go('CMDKPANDERtoPI1', { expect: 'PIRANHA1' }));
      await shot('pA-pi1');
    },
    async pump() {
      await hop('PSTAMSTART');
      for (const n of stones) await hop(n);
      await hop('PSTAMEND');
      check('on the rock (rock command enabled)', await hasCmd('CMDPI1OBJROTS'));
      await shot('pA-rock');
      await go('CMDPI1OBJROTS');
      s = await S(); check('POMP in the bag', s.inv.includes('POMP'), s.inv);
      await hop('PSTAMEND');
      for (const n of [...stones].reverse()) await hop(n);
      await hop('PSTAMSTART');
      await shot('pA-back');
    },
    async boat() {
      // pump on the boat away from the paddle command (590,430)
      await use('POMP', 'P1BOOT', [590, 430]); await settle({ max: 20000 });
      check('boat pumped ($PI1_FINISHED)', (await V('$PI1_FINISHED')) === '1', await V('$PI1_FINISHED'));
      await shot('pA-boat');
      check('to KPANDER', await go('CMDPI1toKPANDER', { expect: 'KPANDER' }));
      check('to FATAMORGANA1', await go('CMDKPANDERtoFM1', { expect: 'FATAMORGANA1' }));
      await shot('pA-fm1');
    },
    async fm() {
      // mirror over the house, then click
      await take('SPIEGEL');
      await q.move(350, 240); await wait(500);
      s = await S(); check('mirror turned into SPIEGELFM1 over the house', s.mover === 'SPIEGELFM1', s.mover);
      await q.click(350, 240);
      check('to FATAMORGANA2', await waitScreen('FATAMORGANA2'));
      await shot('pA-fm2');
      // window -> jug -> key
      await go('CMDFM2RAAM');
      await go('FM2OBJKRUIK');
      s = await S(); check('SLEUTEL', s.inv.includes('SLEUTEL'), s.inv);
      // basket, helper on the hatch
      await go('FM2MAND'); await wait(1500);
      await useHelper('CMDFM2OBJLUIK'); await settle({ max: 20000 });
      s = await S(); check('DEURRING', s.inv.includes('DEURRING'), s.inv);
      await shot('pA-fm2b');
      await use('DEURRING', 'FM2DEUR'); await settle({ max: 20000 });
      check('door open ($FM2_DEUROPEN)', (await V('$FM2_DEUROPEN')) === '1');
      await go('FM2KRING');
      s = await S(); check('ring 8', s.rings.includes('8'), s.rings);
      await shot('pA-ring8');
      check('to VEERMAN1', await go('CMDFM2toVM1', { expect: 'VEERMAN1' }));
    },
    async vm() {
      await settle({ max: 30000 });
      await shot('pA-vm-start');
      const info = await evaluate(() => { const p = globalThis.__pd; const w = p.vm.vars.get('$VM1_PUZZEL'); const out = []; for (let i = 0; i < 20; i++) { const l = p.g.bitmaps.get('VM1_L' + i); if (!l) break; out.push({ i, ref: l.ref, x: l.rect.l, y: l.rect.t, w: l.rect.r - l.rect.l }); } return { w, out, home: p.g.bitmaps.get('VM1_PUZZLE')?.home }; });
      note(`word ${info.w}, letters ${info.out.length}`);
      check('letters created = word length', info.out.length === (info.w ?? '').length);
      // target slots left to right, 8..60 px apart is enough, only the order by x counts
      const word = info.w; const n = word.length; const used = new Set();
      for (let j = 0; j < n; j++) {
        const k = info.out.findIndex((l) => l.ref === word[j] && !used.has(l.i)); used.add(info.out[k].i);
        const target = 50 + j * Math.floor(500 / n);
        await q.dragBitmap('VM1_L' + info.out[k].i, target - info.out[k].x, 0);
      }
      await wait(1500);
      await shot('pA-vm-solved');
      check('word solved ($VM1_FINISHED)', (await V('$VM1_FINISHED')) === '1', await V('$VM1_FINISHED'));
      check('paddle placed at PIRANHA1 ($OBJPI1_BOOT)', (await V('$OBJPI1_BOOT')) === 'PEDDEL', await V('$OBJPI1_BOOT'));
      check('ferry takes Pardoes to PIRANHA1', await waitScreen('PIRANHA1', 60000));
      await shot('pA-vm-pi1');
    },
  };
  stage.ride = async function () {
    await go('CMDPI1OBJBOOT');
    s = await S(); check('PEDDEL in the bag', s.inv.includes('PEDDEL'), s.inv);
    if ((await V('$PI1_FINISHED')) !== '1') note('!! boat not pumped?');
    await use('PEDDEL', 'P1BOOT', [400, 400]);
    check('ride starts (PIRANHA2)', await waitFor(() => globalThis.__pd.vm.vars.get('$CURRENTSCREEN') === 'PIRANHA2', null, { max: 60000, what: 'PIRANHA2' }));
    await shot('pA-ride-start');
    // steering bot: keep the boat's hit span away from the fish, with real arrow keys
    let dir = 0, lastBite = '0', seg = '', n = 0, shots = 0;
    const t0 = q.clock();
    while (q.clock() - t0 < 240000) {
      const st = await evaluate(() => {
        const p = globalThis.__pd, g = p.g; const f = g.sprites.find('P2PIRANHA'), b = g.sprites.find('PVAARBOOT');
        return { scr: p.vm.vars.get('$CURRENTSCREEN'), bites: p.vm.vars.get('$PI2_BITECNT'), f: f && f.visible ? { x: f.x, y: f.y, w: f.w } : null, b: b ? { x: b.x, y: b.y, w: b.w } : null, area: p.vm.vars.get('$P2BAREA') };
      });
      if (st.scr !== seg) { seg = st.scr; note(`  ride screen ${seg} bites=${st.bites} area=${st.area}`); if (shots++ < 8) await shot('pA-ride-' + seg); }
      if (st.scr === 'PIRANHA3' || st.scr === 'PIRANHA1') break;
      if (st.bites !== lastBite) { note(`  bite count ${st.bites} (fish ${JSON.stringify(st.f)} boat ${JSON.stringify(st.b)})`); lastBite = st.bites; }
      if (st.f && st.b) {
        const fc = st.f.x + 28, bc = st.b.x + 93; // fish centre, boat hit-span centre
        const want = fc < bc ? 1 : -1;
        if (want !== dir) { dir = want; await q.key(dir > 0 ? 'ArrowRight' : 'ArrowLeft'); }
      }
      n++;
      await wait(60);
    }
    s = await S();
    note(`ride finished on ${s.screen}, bites ${await V('$PI2_BITECNT')}`);
    check('ride survived to PIRANHA3', s.screen === 'PIRANHA3');
  };
  stage.pi3 = async function () {
    await settle({ max: 30000 });
    await shot('pA-pi3');
    await go('PI3OBJGRND');
    s = await S();
    check('SLINGER in the bag, SPIEGEL pushed out', s.inv === 'POMP,SLEUTEL,PEDDEL,SLINGER', s.inv);
    await go('CMDPI3open'); await wait(2500); await settle({ max: 20000 });
    await shot('pA-pi3-open');
    check('to KPANDER', await go('CMDPI3toKPANDER', { expect: 'KPANDER' }));
    check('SPIEGEL object now lies in PIRANHA3 ($OBJPI3_GRND)', (await V('$OBJPI3_GRND')) === 'SPIEGEL', await V('$OBJPI3_GRND'));
  };
  for (const name of STAGES.slice(STAGES.indexOf(start))) {
    if (!stage[name]) break;
    note(`## stage ${name}`);
    await stage[name]();
    await q.st(`end ${name}`);
    await q.saveTo('pA-' + name);
    if (name === stop) break;
  }
  return q.done();
};
