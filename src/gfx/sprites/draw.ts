// Sprite blits (docs/re/graphics.md B.3.9): a source rect of the frame picture to a destination rect (1:1 or nearest-neighbour
// scaled for REDUCTION), colour keyed either by palette index (BG path) or by RGB colour (DX path), optionally through a ColFX
// operation, a per-scanline shear (`Special=COS`) or an ordered-dither mask (FX=SNOW dissolve).

import type { Surface } from '../../engine/surface.ts';
import { colOp, COLFX_NONE, COLFX_PERCENT, type Img } from '../image.ts';
import type { Rect } from '../scene.ts';
import type { R4 } from './stmt.ts';

export interface DrawOpts {
  /** DX path: pixels equal to `key` are transparent; BG path: pixels with palette index `maskIndex` (< 0 = opaque). */
  dx: boolean;
  maskIndex: number;
  key: number;
  colfx: number;
  p: number;
  clip?: Rect;
  /** Per-scanline horizontal shift table and phase (Special). */
  shear?: number[] | null;
  shearIdx?: number;
  /** Only pixels for which this returns true are drawn (SNOW dissolve). */
  mask?: ((x: number, y: number) => boolean) | null;
}

/** The four 8x8 stipple patterns of the SNOW dissolve (rows, MSB = left). */
export const SNOW_PATTERNS: number[][] = [
  [0x00, 0x21, 0x04, 0x20, 0x00, 0x0a, 0x40, 0x08],
  [0x22, 0x84, 0x29, 0x44, 0x2a, 0x94, 0x02, 0x51],
  [0xdd, 0x7b, 0xd6, 0xbb, 0xd5, 0x6b, 0xfd, 0xae],
  [0xff, 0xde, 0xfb, 0xdf, 0xff, 0xf5, 0xbf, 0xf7],
];
export const snowMask = (phase: number) => {
  const pat = SNOW_PATTERNS[Math.max(0, Math.min(3, phase))];
  return (x: number, y: number) => ((pat[y & 7] >> (7 - (x & 7))) & 1) !== 0;
};

/** Draw `img` rect `s` onto the destination rect `d` of `dst`. */
export function drawSprite(dst: Surface, img: Img, s: R4, d: R4, o: DrawOpts) {
  const dw = d[2] - d[0], dh = d[3] - d[1], sw = s[2] - s[0], sh = s[3] - s[1];
  if (dw <= 0 || dh <= 0 || sw <= 0 || sh <= 0) return;
  const cl = o.clip ? Math.max(0, o.clip.l) : 0, ct = o.clip ? Math.max(0, o.clip.t) : 0;
  const cr = o.clip ? Math.min(dst.width, o.clip.r) : dst.width, cb = o.clip ? Math.min(dst.height, o.clip.b) : dst.height;
  const x0 = Math.max(d[0], cl), x1 = Math.min(d[2], cr), y0 = Math.max(d[1], ct), y1 = Math.min(d[3], cb);
  if (x1 <= x0 || y1 <= y0) return;
  const sp = img.px, idx = img.idx, dp = dst.px, dstW = dst.width, imgW = img.w;
  const keyed = o.dx ? true : o.maskIndex >= 0 && !!idx;
  const op = o.colfx !== COLFX_NONE && o.colfx !== COLFX_PERCENT;
  const same = sw === dw && sh === dh;
  const shear = o.shear && o.shear.length ? o.shear : null;
  for (let y = y0; y < y1; y++) {
    const sy = Math.min(img.h - 1, s[1] + (same ? y - d[1] : Math.floor(((y - d[1]) * sh) / dh)));
    const row = sy * imgW;
    const shift = shear ? shear[((o.shearIdx ?? 0) + (y - d[1])) % shear.length] : 0;
    for (let x = x0; x < x1; x++) {
      const xx = x - shift;
      if (xx < d[0] || xx >= d[2]) continue;
      const sx = Math.min(imgW - 1, s[0] + (same ? xx - d[0] : Math.floor(((xx - d[0]) * sw) / dw)));
      const si = row + sx;
      if (keyed) {
        if (o.dx ? sp[si] === o.key : idx![si] === o.maskIndex) continue;
      }
      if (o.mask && !o.mask(x, y)) continue;
      const di = y * dstW + x;
      dp[di] = op ? colOp(o.colfx, dp[di], sp[si], o.p) : sp[si];
    }
  }
}
