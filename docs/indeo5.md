# Indeo 5 decoder (src/engine/indeo5.ts)

Pure TypeScript (strict, ES2022, no dependencies, no WASM) port of FFmpeg's
Indeo 5 decoder (`libavcodec/indeo5.c`, `ivi.c`, `ivi_dsp.c`, `indeo5data.h`).
Runs in browsers (and Web Workers) and in node. The YUV output is bit-exact
with FFmpeg's `indeo5` decoder (pix_fmt `yuv410p`).

Licence: LGPL-2.1-or-later. This is a derivative work of FFmpeg code; the
licence header with FFmpeg's copyright lines is at the top of `indeo5.ts`.

## API

```ts
import { Indeo5Decoder } from './indeo5';

const dec = new Indeo5Decoder(640, 480);   // initial size; the stream's GOP header overrides it
const changed = dec.decode(chunkBytes);    // chunkBytes: payload of one AVI '00dc' chunk
if (changed) {
  dec.y; dec.u; dec.v;                     // Uint8Array planes, YUV 4:1:0
  dec.toRGBA(imageData.data);              // Uint8ClampedArray or Uint32Array
}
```

- `decode(frame: Uint8Array): boolean`
  - `true`: a new picture is in `y`/`u`/`v`.
  - `false`: nothing new. Either a NULL frame (type 4) or an empty chunk
    (0 bytes, "frame not changed"; the previous picture stays valid and should
    be shown again), or a decode error (then `lastError` is a non-null string; the
    previous picture is still intact). FFmpeg outputs no frame in these cases
    either.
- Fields: `width`, `height`, `y` (stride `strideY`), `u`, `v` (size
  `chromaWidth` x `chromaHeight` = ceil(w/4) x ceil(h/4), stride `strideC`),
  `frameType` (0 intra, 1 inter, 2 inter-scalable, 3 inter-noref, 4 null),
  `frameNum`, `lastError`. For 640x480: `strideY` = 640, `strideC` = 160.
  Plane arrays are reused between frames (copy them if you need to keep a frame).
- `toRGBA(out)`: `out` is `Uint8ClampedArray`/`Uint8Array` (R,G,B,A bytes,
  length >= w*h*4) or `Uint32Array` (length >= w*h, `0xAABBGGRR`, i.e. RGBA byte
  order on little-endian hosts). Alpha is 255.

### Colour conversion

BT.601 limited-range YCbCr to full-range RGB, 16.16 fixed point
(`1.164383*(Y-16)`, `1.596027`, `-0.391762`, `-0.812968`, `2.017232`), the
matrix swscale uses by default for yuv410p to rgb. Chroma (1/4 x 1/4) is
upsampled bilinearly with centred chroma sample positions. Measured against
ffmpeg on an ENDPRE.AVI frame:

- nearest-neighbour chroma + this matrix vs `scale=flags=neighbor+accurate_rnd+full_chroma_int`:
  mean abs error 0.005, max 1 (so the matrix/rounding is the same);
- this bilinear chroma vs `flags=bilinear+accurate_rnd+full_chroma_int`: mean 0.30, max 2;
- vs ffmpeg's default (bicubic) rgb24: mean 2.0, max 30 (only at sharp chroma edges).

So RGB is a close match, not bit-exact, with a default `ffmpeg -pix_fmt rgb24`
(the YUV planes are exact).

## Supported

Everything FFmpeg's IV5 decoder supports: intra frames, inter frames (types 1,
2 and 3) with full/half-pel motion compensation and motion vector / quantiser
inheritance, NULL frames, empty macroblocks and tiles, tiling (local decoding),
custom Huffman tables, run-value map corrections, 8x8 slant, row/column slant,
no-transform ("put pixels") bands and 4x4 slant (chroma), scalability mode
(4 luma bands recomposed with the 5/3 wavelet, 1 chroma band), all predefined
quantisation tables.

Not supported (same as FFmpeg, decode returns false with `lastError` set):
password protected clips, YV12 picture-format flag, extended transform info,
4x4 luma blocks, other subdivisions than 4+1 bands, odd tile sizes in
scalable mode. The IV5 "transparency" GOP flag is parsed (fill colour skipped)
but no transparency plane is decoded, as in FFmpeg. Haar transforms and
B-frames belong to Indeo 4 and are not part of Indeo 5.

## Tests

`test.mjs` (node >= 22.18 / 23.6; runs the `.ts` through node's built-in type
stripping, no build step). It contains a minimal AVI demuxer (RIFF walk,
'00dc'/'00db'/'00iv' video chunks), decodes the frames and compares the Y/U/V
planes byte for byte with `ffmpeg -f rawvideo -pix_fmt yuv410p -fps_mode passthrough`
(streamed over a pipe).

```
node test.mjs                       # the default set below
node test.mjs FILE.AVI [maxFrames]  # any IV50 AVI
```

Type check: `npx -p typescript tsc -p .`

### Results (node 26, Apple silicon, decode time only)

Game files (640x480, `PARDOES/MEDIA`; not copied anywhere):

| file | chunks | frames shown | differing bytes | decode speed |
| --- | --- | --- | --- | --- |
| INTROB.AVI | 20 | 20 | 0 | ~330 fps |
| GAMEOVER.AVI | 173 | 173 | 0 | ~1100 fps |
| ENDPRE.AVI | 171 | 171 | 0 | ~300 fps |
| INTROA.AVI (first 300) | 300 | 300 | 0 | ~520 fps |
| INTROA.AVI (all) | 1729 | 1648 (81 empty chunks) | 0 | ~240 fps |
| ENDPOST.AVI (all) | 1140 | 1119 (21 empty chunks) | 0 | ~180 fps |

Note: all game files contain only intra (key) frames plus empty chunks, so
the inter/motion-compensation/scalable/NULL-frame paths are not exercised by
them. They were verified with public IV50 samples from samples.ffmpeg.org
(downloaded to /tmp, not part of this folder): `Educ_Movie_DeadlyForce`,
`higovdemo`, `indeo5`, `JessicaAlba_(Intel_Indeo5)` (scalable, type 2),
`wigout`, `sasha`, `indeo50`, `cat_attack`, `ESLOGO`, `MSLOGO`, `girl_01/02`,
`compachelowres1`: all 0 differing bytes, including frame types 0/1/2/3/4
(`sample.avi` is truncated: our decoder and ffmpeg both fail on its last chunk
and the other 192 frames match; for `sv2-d.avi` ffmpeg's demuxer yields only one
frame, which matches).
Random corruption fuzzing of frames never throws or hangs.
