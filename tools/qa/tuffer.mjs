// Tuffer (OLDTIMER2) autopilot, shared by the lose scripts: plans a path through the obstacle pixel masks (read-only analysis of the level)
// and steers along it with real arrow keys. Call right after arriving in OLDTIMER2.
export const drive = async (q, planCache, { shotPrefix = '', override = null } = {}) => {
  const { evaluate, wait, note, shot } = q;
  const attempt = 1; let result = '', lastSx = 0;
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
  if (!plan) return { plan, result: 'noplan' };
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
          if (override) { const o = override(st.sx); if (o != null) tgt = o; }
          lastSx = st.sx;
          const d = tgt - st.y;
          const want = d > 5 ? 1 : d < -5 ? -1 : 0;
          if (want !== st.vy) { if (st.vy !== 0) await q.key('ArrowUp'); else await q.key(want > 0 ? 'ArrowDown' : 'ArrowUp'); }
          if (q.clock() - lastShot > 10000 && shots < 3) { lastShot = q.clock(); shots++; await shot(`${shotPrefix}-${shots}`); }
          if (log.length < 600) log.push(`${Math.round(st.sx)}:${st.y}/${tgt}`);
          await wait(20);
        }
  return { plan, result, lastSx };
};
