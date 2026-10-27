// The printed diploma (docs/re/script-core.md s10): PRINTER.RPT lays out one A4 portrait page in 1/10 mm: the popup
// bitmap PRNBITMAP (xprn_dip.bmp, the certificate turned 90 degrees) fitted to the height of Rect=100,100,2000,2870 and
// right-aligned, and the player's name (style PRNDATADATA, Roman bold) warped into a vertical band: 8 mm per letter,
// centred at y = 200 mm between x = 110 and 118 mm, glyph tops towards x = 118 mm (FXTOP/FXBOT of [PRINTER]).
// The browser version draws that page into a canvas and prints it with window.print().

import type { Gfx } from './gfx.ts';

const PX_PER_MM = 6; // ~150 dpi

export function printDiploma(g: Gfx, name: string) {
  const bm = g.bitmap('PRNBITMAP');
  const img = bm?.img;
  const W = 210 * PX_PER_MM, H = 297 * PX_PER_MM;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, W, H);
  if (img) {
    const src = new ImageData(img.w, img.h);
    const d = new Uint32Array(src.data.buffer);
    for (let i = 0; i < img.px.length; i++) d[i] = img.px[i] | 0xff000000;
    const tmp = new OffscreenCanvas(img.w, img.h);
    tmp.getContext('2d')!.putImageData(src, 0, 0);
    // rect 10..200 mm x 10..287 mm; keep the aspect, fit the height, right-aligned
    const h = 277 * PX_PER_MM, w = (img.w / img.h) * h;
    ctx.drawImage(tmp, 200 * PX_PER_MM - w, 10 * PX_PER_MM, w, h);
  }
  if (name) {
    const n = name.length;
    const band = 8 * PX_PER_MM, len = 8 * n * PX_PER_MM;
    ctx.save();
    ctx.translate(118 * PX_PER_MM, 200 * PX_PER_MM - len / 2);
    ctx.rotate(Math.PI / 2); // text runs downward, tops towards larger x
    ctx.font = `bold ${band}px "Times New Roman", Times, serif`;
    ctx.textBaseline = 'top';
    ctx.fillStyle = '#000';
    const m = ctx.measureText(name);
    ctx.scale(len / Math.max(1, m.width), 1);
    ctx.fillText(name, 0, 0);
    ctx.restore();
  }

  let host = document.getElementById('pd-print');
  if (!host) {
    host = document.createElement('div');
    host.id = 'pd-print';
    document.body.appendChild(host);
    const style = document.createElement('style');
    style.textContent = `#pd-print{display:none}
@media print{@page{size:A4 portrait;margin:0}body>*:not(#pd-print){display:none!important}#pd-print{display:block}#pd-print img{width:210mm;height:297mm;display:block}}`;
    document.head.appendChild(style);
  }
  const el = document.createElement('img');
  el.src = c.toDataURL('image/png');
  host.replaceChildren(el);
  el.decode().catch(() => {}).finally(() => { if (!new URLSearchParams(location.search).has('noprint')) window.print(); });
}
