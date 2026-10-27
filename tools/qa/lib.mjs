// QA helpers for the scripted Pardoes playthrough (tools/qa/p*.mjs). Real input only (clicks on the canvas, keys); the debug handle
// `__pd` is used to READ state (screen, variables, hit tests, sprite positions). The only writes are `preset()` (segment start
// variables of an already verified earlier segment, like a save) and `teleport()` (also a segment start).
// Run: node tools/browse.mjs "http://localhost:5399/?play=1&skipintro=1&mute=1&debug=1&noprint=1" tools/qa/pN.mjs --size 640x480 --out /tmp/pd-qa
import fs from 'node:fs';

export const URL_BASE = 'http://localhost:5399/';
const LOG = '/tmp/pd-qa/log.md';

export const mk = (ctx) => {
  const { click, down, up, move, wait, evaluate, log, shot, page, key } = ctx;
  const note = (s) => { log(s); try { fs.appendFileSync(LOG, s + '\n'); } catch { /* ignore */ } };

  // clock that ignores machine sleeps
  let last = Date.now(), lost = 0;
  const clock = () => { const n = Date.now(); const d = n - last; if (d > 15000) lost += d - 1000; last = n; return n - lost; };

  const BLOCKERS = ['CMDEXITINPROGRESS', 'CMDENTRYINPROGRESS', 'CMDPROTECTION', 'CMDRATTAR'];
  // ambient script threads that loop forever (idle animations, random events): they do not count as "busy"
  const AMBIENT = /DOSTER|DOSOMETHING|^RANDOMEVENT|RANDOMEVT|IDLE|SPARKLE|^K?SPOOK\d?\/RUN|^ALGEMEEN\/DOKIST/;
  const S = () => evaluate(([BL, AMB]) => {
    const ambient = new RegExp(AMB);
    const p = globalThis.__pd; const v = p.vm.vars;
    const th = p.vm.threadInfo();
    return {
      bagOpen: !!p.cmds.cmds.get('CMDSCREEN')?.active, screen: v.get('$CURRENTSCREEN'), prev: v.get('$PREVIOUSSCREEN'), movie: p.media.playing,
      blockers: [...p.cmds.cmds.values()].filter((c) => c.active && BL.includes(c.name)).map((c) => c.name),
      busy: th.filter((t) => !ambient.test(t.triple)).length, threads: th.length, busyThreads: th.filter((t) => !ambient.test(t.triple)).map((t) => t.triple).join(' '), holding: !!p.g.holding, mover: v.get('$INVMOVER'),
      inv: [1, 2, 3, 4].map((i) => v.get('$INVENT' + i)).join(','), help: v.get('$INVHELP'), twinkel: v.get('$TWINKELLEVEL'),
      rings: [1, 2, 3, 4, 5, 6, 7, 8].map((i) => (v.get('$KRING' + i) === '1' ? i : '')).join(''),
    };
  }, [BLOCKERS, AMBIENT.source]);
  const V = (name) => evaluate((n) => globalThis.__pd.vm.vars.get(n), name);
  const Vs = (names) => evaluate((ns) => ns.map((n) => globalThis.__pd.vm.vars.get(n)), names);
  const st = async (tag = '') => { const s = await S(); note(`${tag} ${JSON.stringify(s)}`); return s; };

  // skip a playing movie with a real click (a click only skips while a movie waits)
  const skipMovie = async () => { await click(320, 240); };

  // settle: wait until the screen is idle (no blockers, no movie, no running threads) for 3 consecutive polls
  const settle = async ({ max = 60000, min = 300, skipMovies = true, tag = '', closeBag = true } = {}) => {
    const t0 = clock(); let quiet = 0;
    await wait(min);
    while (clock() - t0 < max) {
      const s = await S();
      if (s.movie && skipMovies) { await skipMovie(); quiet = 0; await wait(500); continue; }
      // the bag stays open after picking an item up (the script never calls ENDSHOW): close it with a click on the screen overlay
      if (closeBag && !s.movie && s.bagOpen && s.busy === 0) { await click(320, 60); quiet = 0; await wait(600); continue; }
      if (!s.movie && s.blockers.length === 0 && s.busy === 0) { if (++quiet >= 3) return s; } else quiet = 0;
      await wait(250);
    }
    note(`!! settle timeout ${tag} ${JSON.stringify((await S()).busyThreads)}`); await st('!! stuck'); await shot('stuck-' + Date.now());
    return S();
  };
  const waitFor = async (fn, arg, { max = 30000, step = 250, what = '' } = {}) => {
    const t0 = clock();
    while (clock() - t0 < max) { const r = await evaluate(fn, arg); if (r) return r; await wait(step); }
    note(`!! waitFor timeout ${what}`); return null;
  };
  const waitScreen = async (name, max = 40000) => {
    const ok = await waitFor((n) => globalThis.__pd.vm.vars.get('$CURRENTSCREEN') === n, name, { max, what: 'screen ' + name });
    if (!ok) { await st('!! not on ' + name); return false; }
    await settle({ max: 40000 });
    return true;
  };

  // ---- locating click points (read-only hit tests in the page)
  // best point of a Command: the point inside its node rect that hits it, nearest to the centre (or to a hint)
  const cmdPoint = (name, hint) => evaluate(([n, hint]) => {
    const p = globalThis.__pd; const c = p.cmds.cmds.get(n.toUpperCase());
    if (!c || !c.active || !c.node) return null;
    const r = c.node.rect; const cx = hint ? hint[0] : (r.l + r.r) / 2, cy = hint ? hint[1] : (r.t + r.b) / 2;
    let best = null, bd = 1e12;
    for (let y = Math.max(0, r.t); y < Math.min(480, r.b); y += 2) for (let x = Math.max(0, r.l); x < Math.min(640, r.r); x += 2) {
      const d = (x - cx) ** 2 + (y - cy) ** 2;
      if (d < bd && p.cmds.hit(x, y) === c.node) { bd = d; best = [x, y]; }
    }
    return best;
  }, [name, hint ?? null]);
  const spritePoint = (name, hint) => evaluate(([n, hint]) => {
    const p = globalThis.__pd; const s = p.g.sprites.find(n.toUpperCase());
    if (!s || !s.node) return null;
    const r = s.node.rect; const cx = hint ? hint[0] : (r.l + r.r) / 2, cy = hint ? hint[1] : (r.t + r.b) / 2;
    let best = null, bd = 1e12;
    for (let y = Math.max(0, r.t); y < Math.min(480, r.b); y += 2) for (let x = Math.max(0, r.l); x < Math.min(640, r.r); x += 2) {
      const d = (x - cx) ** 2 + (y - cy) ** 2;
      if (d < bd && p.cmds.hit(x, y) === s.node) { bd = d; best = [x, y]; }
    }
    return best;
  }, [name, hint ?? null]);
  const hitName = (x, y) => evaluate(([x, y]) => globalThis.__pd.cmds.hit(x, y)?.name ?? null, [x, y]);
  const hasCmd = (name) => evaluate((n) => { const c = globalThis.__pd.cmds.cmds.get(n.toUpperCase()); return !!(c && c.active && c.enabled); }, name);
  const hasSprite = (name) => evaluate((n) => !!globalThis.__pd.g.sprites.find(n.toUpperCase()), name);
  const spriteInfo = (name) => evaluate((n) => { const s = globalThis.__pd.g.sprites.find(n.toUpperCase()); return s ? { x: s.x, y: s.y, w: s.w, h: s.h, visible: s.visible, enabled: s.enabled } : null; }, name);

  const clickCmd = async (name, hint) => {
    const pt = await cmdPoint(name, hint);
    if (!pt) { note(`!! clickCmd: ${name} has no clickable point (screen ${await V('$CURRENTSCREEN')})`); return false; }
    await click(pt[0], pt[1]);
    return true;
  };
  const clickSprite = async (name, hint) => {
    const pt = await spritePoint(name, hint);
    if (!pt) { note(`!! clickSprite: ${name} has no clickable point (screen ${await V('$CURRENTSCREEN')})`); return false; }
    await click(pt[0], pt[1]);
    return true;
  };
  // a target is a Command or a sprite
  const clickT = async (name, hint) => ((await hasCmd(name)) ? clickCmd(name, hint) : clickSprite(name, hint));
  // click a target and wait until the screen is idle again
  const go = async (name, { hint, expect, max = 40000 } = {}) => {
    const ok = await clickT(name, hint);
    if (!ok) return false;
    if (expect) return waitScreen(expect, max);
    await settle({ max });
    return true;
  };

  // ---- inventory
  const openBag = async () => { const ok = await clickSprite('PARDOES'); await wait(600); return ok; };
  const take = async (item) => {
    const inv = (await S()).inv.split(',');
    const i = inv.indexOf(item);
    if (i < 0) { note(`!! take ${item}: not in the bag (${inv})`); return false; }
    await openBag();
    const ok = await clickCmd('CMDINVENT' + (i + 1));
    await wait(500);
    return ok;
  };
  const takeHelper = async () => { await openBag(); const ok = await clickSprite('INVHELP'); await wait(500); return ok; };
  const takeTwinkel = async () => { await openBag(); const ok = await clickSprite('INVTFLES'); await wait(500); return ok; };
  const use = async (item, target, hint) => {
    if (!(await take(item))) return false;
    const m = await V('$INVMOVER');
    if (m !== item) note(`!! use ${item}: $INVMOVER=${m}`);
    return clickT(target, hint);
  };
  const useHelper = async (target, hint) => { await takeHelper(); return clickT(target, hint); };
  // drag a MOVEABLE bitmap (jigsaw piece, word letter): press on a pixel that really hits it, move, release (real mouse events)
  const bitmapPoint = (name) => evaluate((n) => {
    const p = globalThis.__pd; const b = p.g.bitmaps.get(n.toUpperCase());
    if (!b || !b.node) return null;
    const r = b.rect; const cx = (r.l + r.r) / 2, cy = (r.t + r.b) / 2; let best = null, bd = 1e12;
    for (let y = Math.max(0, r.t); y < Math.min(480, r.b); y += 1) for (let x = Math.max(0, r.l); x < Math.min(640, r.r); x += 1) {
      const d = (x - cx) ** 2 + (y - cy) ** 2;
      if (d < bd && p.cmds.hit(x, y) === b.node) { bd = d; best = [x, y, r.l, r.t]; }
    }
    return best;
  }, name);
  const dragBitmap = async (name, dx, dy) => {
    const pt = await bitmapPoint(name);
    if (!pt) { note(`!! dragBitmap ${name}: no hit point`); return false; }
    await move(pt[0], pt[1]); await wait(60);
    await down(pt[0], pt[1]); await wait(60);
    const n = 4;
    for (let i = 1; i <= n; i++) { await move(pt[0] + (dx * i) / n, pt[1] + (dy * i) / n); }
    await up(pt[0] + dx, pt[1] + dy);
    await wait(80);
    return true;
  };
  const drop = async () => { await click(8, 8); await wait(300); };

  // ---- setup of a segment (documented writes)
  const preset = (vars) => evaluate((vs) => { for (const [k, v] of Object.entries(vs)) if (!globalThis.__pd.vm.vars.setLiteral(k, String(v))) console.warn('unknown var', k); }, vars);
  const checks = []; let failed = 0;
  const check = (what, ok, extra = '') => { note(`${ok ? 'PASS' : 'FAIL'} ${what} ${extra}`); if (!ok) failed++; return ok; };
  const done = () => { note(`== ${failed ? failed + ' FAILED' : 'all checks passed'}`); return failed; };
  const snap = async (name) => shot(name);

  // ---- chaining phases through the save system: write the state to a file, boot from it via the real "Verder spelen" path
  const saveTo = async (name) => {
    const s = await evaluate(() => { const p = globalThis.__pd; return { screen: p.vm.vars.get('$CURRENTSCREEN'), name: p.vm.vars.get('$SPELERNAAM') ?? '', time: Date.now(), vars: p.vm.vars.snapshot() }; });
    fs.writeFileSync(`/tmp/pd-qa/save-${name}.json`, JSON.stringify(s));
    note(`(saved ${name}: ${s.screen})`);
  };
  const bootSave = async (name, extra = {}) => {
    const data = fs.readFileSync(`/tmp/pd-qa/save-${name}.json`, 'utf8');
    await page.evaluate(([k, d]) => localStorage.setItem(k, d), ['pardoes-save-v1', data]);
    await page.reload();
    await page.click('text=Verder spelen');
    await waitFor(() => !!globalThis.__pd, null, { max: 30000, what: '__pd' });
    const want = JSON.parse(data).screen;
    const ok = await waitFor(([w]) => (globalThis.__pd.vm.vars.get('$CURRENTSCREEN') === w && !globalThis.__pd.vm.threadInfo().some((t) => t.triple.startsWith('PROGRAM/CONTINUE'))), [want], { max: 60000, what: 'restore to ' + want });
    await wait(3000);
    await settle({ max: 40000 });
    if (Object.keys(extra).length) await preset(extra);
    note(`(booted from ${name}: ${ok ? 'ok' : 'FAILED'})`);
    return ok;
  };
  // ---- Sterrenkamer: pick the realm on the chronoscope and fly there
  const toRealm = async (realm) => {
    for (let i = 0; i < 6 && (await V('$SK1_RIJK')) !== realm; i++) { await clickSprite('SK1_CHRONO', [290, 270]); await settle({ max: 20000 }); }
    if ((await V('$SK1_RIJK')) !== realm) { note(`!! chrono did not reach ${realm}`); return false; }
    await clickSprite('SK1_KAST', [545, 261]);
    if (!(await waitFor(() => globalThis.__pd.cmds.cmds.get('CMDSKTOKPRANDOM')?.active, null, { max: 20000, what: 'cabinet open' }))) return false;
    await settle({ max: 20000 });
    return go('CMDSKtoKPRANDOM', { expect: realm });
  };
  return { ...ctx, bitmapPoint, dragBitmap, saveTo, bootSave, toRealm, note, clock, S, V, Vs, st, settle, waitFor, waitScreen, cmdPoint, spritePoint, hitName, hasCmd, hasSprite, spriteInfo, clickCmd, clickSprite, clickT, go, openBag, take, takeHelper, takeTwinkel, use, useHelper, drop, preset, check, done, snap, skipMovie, checks };
};
