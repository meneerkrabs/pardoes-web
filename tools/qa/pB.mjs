// Phase B: Marerijk I (steps 26-34): VILLAVOLTA1 door (SLEUTEL), VILLAVOLTA2 sliding puzzle + POT + fire + ring 5, ELFJES2 flower melody, back to the Sterrenkamer.
// Usage: QA_START=<stage> (kp vv2 lf) ; boots from save pA-pi3 (KPANDER) by default.
import { mk } from './lib.mjs';

// BFS over the sliding puzzle: state = array of cell ids (-1 = hole); a click on a cell in the hole's row/column slides toward the hole
const solve = (cols, rows, cell0) => {
  const key = (c) => c.join(','), goal = (c) => c.every((v, i) => v === -1 || v === i);
  const slide = (cell, c, r) => {
    const h = cell.indexOf(-1), hc = h % cols, hr = Math.floor(h / cols), out = [...cell];
    if (c === hc && r !== hr) { const s = r < hr ? -1 : 1; for (let y = hr; y !== r; y += s) out[y * cols + c] = out[(y + s) * cols + c]; }
    else if (r === hr && c !== hc) { const s = c < hc ? -1 : 1; for (let x = hc; x !== c; x += s) out[r * cols + x] = out[r * cols + x + s]; }
    else return null;
    out[r * cols + c] = -1; return out;
  };
  const seen = new Map([[key(cell0), null]]); let q = [cell0];
  while (q.length) {
    const next = [];
    for (const cur of q) {
      if (goal(cur)) { const path = []; let k = key(cur); while (seen.get(k)) { const [pk, mv] = seen.get(k); path.unshift(mv); k = pk; } return path; }
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) { const n = slide(cur, c, r); if (n && !seen.has(key(n))) { seen.set(key(n), [key(cur), [c, r]]); next.push(n); } }
    }
    q = next;
  }
  return null;
};

export default async (ctx) => {
  const q = mk(ctx);
  const { wait, note, check, S, V, go, clickT, waitScreen, settle, use, shot, evaluate } = q;
  const STAGES = ['kp', 'vv2', 'lf'];
  const start = process.env.QA_START || 'kp';
  const prev = { kp: 'pA-pi3', vv2: 'pB-kp', lf: 'pB-vv2' };
  const stop = process.env.QA_STOP || 'lf';
  note(`# pB from ${prev[start]} (stages ${start}..${stop})`);
  await q.bootSave(prev[start], { $RATTAR_APPEARS: 9999 });
  let s;
  const stage = {
    async kp() {
      check('to KPMARE', await go('CMDKPANDERtoKPMARE', { expect: 'KPMARE' }));
      await shot('pB-kpmare');
      check('to VILLAVOLTA1', await go('CMDKPMAREtoVV1', { expect: 'VILLAVOLTA1' }));
      await use('SLEUTEL', 'CMDVV1OPENDEUR'); await wait(1500); await settle({ max: 30000 });
      check('door unlocked ($VV1_FINISHED)', (await V('$VV1_FINISHED')) === '1');
      await shot('pB-vv1');
      check('to VILLAVOLTA2', await go('CMDVV1toVV2', { expect: 'VILLAVOLTA2' }));
      await shot('pB-vv2-start');
    },
    async vv2() {
      await settle({ max: 30000 });
      for (let round = 0; round < 3 && (await V('$VV2_FINISHED1')) !== '1'; round++) {
        const st = await evaluate(() => { const sh = globalThis.__pd.bitmaps.shift; if (!sh) return null; const r = sh.bm.rect, img = sh.bm.img; return { cols: sh.cols, rows: sh.rows, cell: [...sh.cell], l: r.l, t: r.t, tw: Math.floor(img.w / sh.cols), th: Math.floor(img.h / sh.rows) }; });
        if (!st) { note('!! no sliding puzzle'); break; }
        const path = solve(st.cols, st.rows, st.cell);
        note(`sliding puzzle ${JSON.stringify(st.cell)}: ${path ? path.length + ' moves' : 'NO SOLUTION'}`);
        if (!path) break;
        for (const [c, r] of path) { await q.click(st.l + (c + 0.5) * st.tw, st.t + (r + 0.5) * st.th); await wait(250); }
        await wait(1500); await settle({ max: 20000 });
      }
      check('sliding puzzle solved ($VV2_FINISHED1)', (await V('$VV2_FINISHED1')) === '1');
      await shot('pB-vv2-solved');
      await go('VV2OBJGRND');
      s = await S(); check('POT in the bag', s.inv.includes('POT'), s.inv);
      await use('POT', 'CMDVV2VUUR'); await wait(1500); await settle({ max: 30000 });
      check('fire out ($VV2_FINISHED2)', (await V('$VV2_FINISHED2')) === '1');
      await go('CMDVV2KRING');
      s = await S(); check('ring 5', s.rings.includes('5'), s.rings);
      await shot('pB-ring5');
      check('to VILLAVOLTA1', await go('CMDVV2toVV1', { expect: 'VILLAVOLTA1' }));
      check('to KPMARE', await go('CMDVV1toKPMARE', { expect: 'KPMARE' }));
    },
    async lf() {
      check('to ELFJES1', await go('CMDKPMAREtoLF1', { expect: 'ELFJES1' }));
      check('to ELFJES2', await go('CMDLF1toLF2', { expect: 'ELFJES2' }));
      await settle({ max: 30000 });
      await shot('pB-lf2');
      const order = await evaluate(() => [1, 2, 3, 4, 5, 6, 7, 8].map((i) => globalThis.__pd.vm.vars.get('$LF2_NR' + i)));
      note(`flower order ${order}`);
      for (const f of order) { const ok = await clickT(f); await wait(1500); if (!ok) note(`!! flower ${f} not clickable`); }
      await wait(3000);
      check('melody done ($LF2_FINISHED)', (await V('$LF2_FINISHED')) === '1');
      check('back in ELFJES1 automatically', await waitScreen('ELFJES1', 60000));
      check('to KPMARE', await go('CMDLF1toKPMARE', { expect: 'KPMARE' }));
      check('to STERRENKAMER', await go('CMDKPMAREtoSK', { expect: 'STERRENKAMER' }));
      await shot('pB-sk');
    },
  };
  for (const name of STAGES.slice(STAGES.indexOf(start))) {
    note(`## stage ${name}`);
    await stage[name]();
    await q.st(`end ${name}`);
    await q.saveTo('pB-' + name);
    if (name === stop) break;
  }
  return q.done();
};
