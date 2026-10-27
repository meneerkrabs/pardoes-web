// Images and blits (docs/re/graphics.md A.7/A.8). Every BMP has its own palette; an Img keeps the palette indices so the
// world darkness can scale the palette (all entries except the transparent index) and so the BG path can key by index.
// Colours are 0x00BBGGRR like Surface.px.

import { decodeBmp, type Surface } from '../engine/surface.ts';
import type { Rect } from './scene.ts';

export const COLFX_NONE = 0, COLFX_DARKEN = 1, COLFX_BRIGHTEN = 2, COLFX_PERCENT = 3, COLFX_THROUGH = 4, COLFX_COMPLEMENT = 5;

const R = (c: number) => c & 255, G = (c: number) => (c >> 8) & 255, B = (c: number) => (c >> 16) & 255;
const pack = (r: number, g: number, b: number) => (b << 16) | (g << 8) | r;

export class Img {
  readonly w: number;
  readonly h: number;
  /** Palette indices (top-down), null for true-colour files. */
  readonly idx: Uint8Array | null;
  /** Original palette (null for true colour). */
  readonly palOrig: Uint32Array | null;
  /** Current palette (darkened). */
  readonly pal: Uint32Array | null;
  /** Current colours per pixel. */
  readonly px: Uint32Array;
  /** Darkness percent applied (FUN_0041029d). */
  pct = 0;

  constructor(s: Surface) {
    this.w = s.width;
    this.h = s.height;
    this.idx = s.indices ?? null;
    this.palOrig = s.palette ? s.palette.slice() : null;
    this.pal = s.palette ? s.palette.slice() : null;
    this.px = s.px;
  }

  static decode(buf: ArrayBuffer): Img {
    return new Img(decodeBmp(buf));
  }

  /** A copy with its own palette/pixels (indices and original palette are shared, they never change). */
  clone(): Img {
    const c = Object.create(Img.prototype) as Img;
    Object.assign(c, { w: this.w, h: this.h, idx: this.idx, palOrig: this.palOrig, pal: this.pal?.slice() ?? null, px: this.px.slice(), pct: this.pct });
    return c;
  }

  /** First palette entry exactly equal to `key` (MASKINDEX=-2), else -1. */
  indexOf(key: number): number {
    if (!this.palOrig) return -1;
    for (let i = 0; i < this.palOrig.length; i++) if (this.palOrig[i] === key) return i;
    return -1;
  }

  /** Scale the palette by (100-pct)/100 except `maskIndex` (world darkness). */
  darken(pct: number, maskIndex: number) {
    if (pct === this.pct) return;
    this.pct = pct;
    if (!this.pal || !this.palOrig || !this.idx) return;
    for (let i = 0; i < this.pal.length; i++) {
      const c = this.palOrig[i];
      this.pal[i] = pct === 0 || i === maskIndex ? c : pack(Math.floor((R(c) * (100 - pct)) / 100), Math.floor((G(c) * (100 - pct)) / 100), Math.floor((B(c) * (100 - pct)) / 100));
    }
    const { idx, pal, px } = this;
    for (let i = 0; i < idx.length; i++) px[i] = pal[idx[i]];
  }

  /** Opaque or index-keyed pixel test at local (x, y): is this an opaque pixel? */
  opaqueAt(x: number, y: number, maskIndex: number): boolean {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return false;
    if (maskIndex < 0 || !this.idx) return true;
    return this.idx[y * this.w + x] !== maskIndex;
  }
  /** RGB colour key test (DX path). */
  opaqueRgb(x: number, y: number, key: number): boolean {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return false;
    return this.px[y * this.w + x] !== key;
  }
}

/** Clip a blit of a w x h source placed at (x, y) to `clip` and the destination; returns [sx, sy, dx, dy, cw, ch] or null. */
function clipBlit(dst: Surface, x: number, y: number, w: number, h: number, clip?: Rect): [number, number, number, number, number, number] | null {
  let l = x, t = y, r = x + w, b = y + h;
  const cl = clip ? Math.max(0, clip.l) : 0, ct = clip ? Math.max(0, clip.t) : 0;
  const cr = clip ? Math.min(dst.width, clip.r) : dst.width, cb = clip ? Math.min(dst.height, clip.b) : dst.height;
  if (l < cl) l = cl;
  if (t < ct) t = ct;
  if (r > cr) r = cr;
  if (b > cb) b = cb;
  if (r <= l || b <= t) return null;
  return [l - x, t - y, l, t, r - l, b - t];
}

/**
 * BG path (FUN_0040f81d): `maskIndex` < 0 = opaque copy; else pixels whose index equals `maskIndex` are skipped and the
 * others go through the ColFX op with parameter `p`.
 */
export function blitIndexed(dst: Surface, img: Img, x: number, y: number, maskIndex: number, clip?: Rect, colfx = COLFX_NONE, p = 0) {
  const c = clipBlit(dst, x, y, img.w, img.h, clip);
  if (!c) return;
  const [sx, sy, dx, dy, cw, ch] = c;
  const sp = img.px, dp = dst.px, idx = img.idx, dw = dst.width, sw = img.w;
  const keyed = maskIndex >= 0 && !!idx;
  for (let row = 0; row < ch; row++) {
    let s = (sy + row) * sw + sx, d = (dy + row) * dw + dx;
    if (!keyed && colfx === COLFX_NONE) { dp.set(sp.subarray(s, s + cw), d); continue; }
    for (let i = 0; i < cw; i++, s++, d++) {
      if (keyed && idx![s] === maskIndex) continue;
      dp[d] = colfx === COLFX_NONE || colfx === COLFX_PERCENT ? sp[s] : colOp(colfx, dp[d], sp[s], p);
    }
  }
}

/** DX path (Blt with DDBLT_KEYSRC): pixels equal to the RGB `key` (default white) are transparent. */
export function blitKeyed(dst: Surface, img: Img, x: number, y: number, key: number, clip?: Rect, colfx = COLFX_NONE, p = 0) {
  const c = clipBlit(dst, x, y, img.w, img.h, clip);
  if (!c) return;
  const [sx, sy, dx, dy, cw, ch] = c;
  const sp = img.px, dp = dst.px, dw = dst.width, sw = img.w;
  for (let row = 0; row < ch; row++) {
    let s = (sy + row) * sw + sx, d = (dy + row) * dw + dx;
    for (let i = 0; i < cw; i++, s++, d++) {
      const v = sp[s];
      if (v === key) continue;
      dp[d] = colfx === COLFX_NONE || colfx === COLFX_PERCENT ? v : colOp(colfx, dp[d], v, p);
    }
  }
}

/** Sub-rectangle blit (sliding puzzle tiles, sprite sheets): source rect (sx, sy, w, h) to (x, y), optional RGB key. */
export function blitPart(dst: Surface, img: Img, sx: number, sy: number, w: number, h: number, x: number, y: number, key = -1, clip?: Rect) {
  const c = clipBlit(dst, x, y, w, h, clip);
  if (!c) return;
  const [ox, oy, dx, dy, cw, ch] = c;
  for (let row = 0; row < ch; row++) {
    let s = (sy + oy + row) * img.w + sx + ox, d = (dy + row) * dst.width + dx;
    for (let i = 0; i < cw; i++, s++, d++) {
      const v = img.px[s];
      if (v !== key) dst.px[d] = v;
    }
  }
}

/** ColFX per-pixel operations (FUN_0041a5c4 / 0041a49c / 0041a7cc / 0041a6aa), per channel, clamped. */
export function colOp(fx: number, dest: number, pal: number, p: number): number {
  const ch = (d: number, s: number): number => {
    switch (fx) {
      case COLFX_DARKEN: return Math.min(255, d + Math.trunc(s / (p === 0 ? 1 : p)));
      case COLFX_BRIGHTEN: return Math.min(255, d + Math.trunc((Math.trunc(((s + p) * 100) / 255) * d) / 100));
      case COLFX_THROUGH: { const v = Math.trunc((s * p) / 100); return d < v ? v : d; }
      case COLFX_COMPLEMENT: return Math.max(Math.trunc((s * p) / 100), Math.trunc((d * (100 - p)) / 100));
      default: return s;
    }
  };
  return pack(ch(R(dest), R(pal)), ch(G(dest), G(pal)), ch(B(dest), B(pal)));
}

export const WHITE = pack(255, 255, 255);

/** "r,g,b" -> colour (empty = white, FUN_00416573). */
export function parseRgb(s: string): number {
  if (!s) return WHITE;
  const [r, g, b] = s.split(',').map((v) => parseInt(v, 10) || 0);
  return pack(r & 255, g & 255, b & 255);
}
