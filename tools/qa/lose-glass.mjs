// Item 8: the magnifying glass (SK1VERGROOTGLAS, L5146-5160; targets CMDSK1_LEESFAX / CMDSK1_KAART / books L6520-7050): is its sprite visible, does it work?
// Boots from save pB-lf (Sterrenkamer).
import { mk } from './lib.mjs';
export default async (ctx) => {
  const q = mk(ctx);
  const { wait, note, check, S, V, go, clickT, clickCmd, settle, shot, evaluate, hasCmd } = q;
  note('# lose-glass from pB-lf');
  await q.bootSave('pB-lf', { $RATTAR_APPEARS: 9999 });
  const info = await evaluate(() => { const s = globalThis.__pd.g.sprites.find('SK1VERGROOTGLAS'); if (!s) return null; const bm = globalThis.__pd.g.sprites.frameBm(s); return { x: s.x, y: s.y, w: s.w, h: s.h, vis: s.visible, move: s.cur.m.key, frames: s.cur.m.frames.length, frameBmp: s.frame?.bmp?.name, bmImg: !!bm?.img, node: !!s.node }; });
  note(`sprite: ${JSON.stringify(info)}`);
  check('sprite exists', !!info);
  const pt = await q.spritePoint('SK1VERGROOTGLAS');
  note(`click point: ${JSON.stringify(pt)}`);
  await shot('glass-room');
  if (info) {
    const px = await evaluate(() => { const s = globalThis.__pd.g.sprites.find('SK1VERGROOTGLAS'); const bm = globalThis.__pd.g.sprites.frameBm(s); if (!bm?.img) return null; let n = 0; const im = bm.img; for (let i = 0; i < im.px.length; i++) if (im.idx ? im.idx[i] !== bm.maskIndex : true) n++; return n; });
    note(`opaque pixels in its frame: ${px}`);
  }
  if (!pt) { note('sprite is not clickable (no opaque pixel)'); return q.done(); }
  await q.click(pt[0], pt[1]); await wait(1500); await settle({ max: 20000 });
  const s = await S();
  note(`after click: holding=${s.holding} mover=${s.mover}`);
  check('the glass is carried (INVMOVER=VERGROOTGLAS item)', s.holding && s.mover !== '', s.mover);
  await q.move(320, 300); await wait(500);
  await shot('glass-held');
  // use on the fax
  await clickT('CMDSK1_LEESFAX'); await wait(3000); await settle({ max: 30000 });
  const open = await hasCmd('CMDSK1_CLOSEFAX');
  check('fax opens for reading', open);
  await shot('glass-fax');
  if (open) { await clickCmd('CMDSK1_CLOSEFAX'); await wait(2500); await settle({ max: 30000 }); }
  check('back in the room, normal', (await V('$CURRENTSCREEN')) === 'STERRENKAMER' && !(await hasCmd('CMDSK1_CLOSEFAX')));
  await shot('glass-after');
  return q.done();
};
