/*
 * Indeo Video Interactive v5 (IV50) decoder, TypeScript port
 *
 * Ported from FFmpeg's libavcodec/indeo5.c, ivi.c, ivi.h, ivi_dsp.c,
 * indeo5data.h (decoder logic, Huffman descriptors, run-value maps,
 * quantisation tables, inverse slant transforms, motion compensation and
 * the 5/3 wavelet recomposition).
 *
 * Original code:
 * Copyright (c) 2009 Maxim Poliakovski
 * Copyright (c) 2009-2011 Maxim Poliakovski (ivi_dsp.c)
 *
 * This file is part of FFmpeg and is a derivative work of it.
 *
 * FFmpeg is free software; you can redistribute it and/or
 * modify it under the terms of the GNU Lesser General Public
 * License as published by the Free Software Foundation; either
 * version 2.1 of the License, or (at your option) any later version.
 *
 * FFmpeg is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU
 * Lesser General Public License for more details.
 *
 * You should have received a copy of the GNU Lesser General Public
 * License along with FFmpeg; if not, write to the Free Software
 * Foundation, Inc., 51 Franklin Street, Fifth Floor, Boston, MA 02110-1301 USA
 */

/**
 * Indeo Video Interactive 5 decoder.
 *
 * Output is planar YUV 4:1:0 (chroma planes are 1/4 x 1/4 of the luma plane),
 * bit-exact with FFmpeg's `indeo5` decoder (pix_fmt yuv410p).
 *
 * Usage:
 *   const dec = new Indeo5Decoder(640, 480);
 *   if (dec.decode(chunkBytes)) {
 *     // dec.y / dec.u / dec.v hold the new picture
 *     dec.toRGBA(rgbaBuffer);
 *   }
 *
 * Not supported (same as FFmpeg): password protected clips, YV12 picture
 * format flag, extended transform info, 4x4 luma blocks, scalability modes
 * other than 4 luma bands + 1 chroma band, transparency planes (the fill
 * colour is parsed and ignored). Indeo 4 and B-frames do not exist in
 * Indeo 5 and are not implemented.
 */

/* eslint-disable no-bitwise */

const RVMAP_DATA: ReadonlyArray<readonly [number, number, readonly number[], readonly number[]]> = [
  [5, 2,
   [1,1,0,1,1,0,1,1,2,2,1,1,1,1,3,3,1,1,2,2,1,1,4,4,1,1,1,1,2,2,5,5,1,1,3,3,1,1,6,6,1,2,1,2,7,7,1,1,8,8,1,1,4,2,1,4,2,1,3,3,1,1,1,9,9,1,2,1,2,1,5,5,1,1,10,10,1,1,3,3,2,2,1,1,11,11,6,4,4,1,6,1,2,1,2,12,8,1,12,7,8,7,1,16,1,16,1,3,3,13,1,13,2,2,1,15,1,5,14,15,1,5,14,1,17,8,17,8,1,4,4,2,2,1,25,25,24,24,1,3,1,3,1,8,6,7,6,1,18,8,18,1,7,23,2,2,23,1,1,21,22,9,9,22,19,1,21,5,19,5,1,33,20,33,20,8,4,4,1,32,2,2,8,3,32,26,3,1,7,7,26,6,1,6,1,1,16,1,10,1,10,2,16,29,28,2,29,28,1,27,5,8,5,27,1,8,3,7,3,31,41,31,1,41,6,1,6,7,4,4,1,1,2,1,2,11,34,30,11,1,30,15,15,34,36,40,36,40,35,35,37,37,39,39,38,38],
   [1,-1,0,2,-2,0,3,-3,1,-1,4,-4,5,-5,1,-1,6,-6,2,-2,7,-7,1,-1,8,-8,9,-9,3,-3,1,-1,10,-10,2,-2,11,-11,1,-1,12,4,-12,-4,1,-1,13,-13,1,-1,14,-14,2,5,15,-2,-5,-15,-3,3,16,-16,17,1,-1,-17,6,18,-6,-18,2,-2,19,-19,1,-1,20,-20,4,-4,7,-7,21,-21,1,-1,2,3,-3,22,-2,-22,8,23,-8,1,2,-23,-1,2,-2,-2,24,1,-24,-1,25,5,-5,1,-25,-1,9,-9,26,1,-26,3,1,-1,27,-3,-1,-27,1,3,-1,-3,28,-4,4,10,-10,-28,1,-1,1,-1,29,6,-29,-6,30,-4,3,3,-3,-30,1,4,-1,31,-3,1,11,-11,-1,-31,32,-1,-1,2,-2,1,1,-32,1,4,-1,-4,33,-1,1,1,-1,5,5,-5,-33,-1,-12,12,-5,-7,1,1,7,34,4,-4,-1,4,-34,-4,35,36,-2,-35,-2,-36,2,13,2,-1,1,-13,1,-1,37,1,-5,6,5,-1,38,-6,-8,5,8,-1,1,1,-37,-1,5,39,-5,-5,6,-6,-38,-39,-14,40,14,2,1,1,-2,-40,-1,-2,2,-1,-1,-1,1,1,1,-1,1,-1,1,-1,1,-1]],
  [0, 38,
   [0,1,1,2,2,3,3,4,4,5,5,6,8,6,8,7,7,9,9,10,10,11,11,1,12,1,12,13,13,16,14,16,14,15,15,17,17,18,0,18,19,20,21,19,22,21,20,22,25,24,2,25,24,23,23,2,26,28,26,28,29,27,29,27,33,33,1,32,1,3,32,30,36,3,36,30,31,31,35,34,37,41,34,35,37,4,41,4,49,8,8,49,40,38,5,38,40,39,5,39,42,43,42,7,57,6,43,44,6,50,7,44,57,48,50,48,45,45,46,47,51,46,47,58,1,51,58,1,52,59,53,9,52,55,55,59,53,56,54,56,54,9,64,64,60,63,60,63,61,62,61,62,2,10,2,10,11,1,11,13,12,1,12,13,16,16,8,8,14,3,3,15,14,15,4,4,1,17,17,5,1,7,7,5,6,1,2,2,6,22,1,25,21,22,8,24,1,21,25,24,8,18,18,23,9,20,23,33,29,33,20,1,19,1,29,36,9,36,19,41,28,57,32,3,28,3,1,27,49,49,1,32,26,26,2,4,4,7,57,41,2,7,10,5,37,16,10,27,8,8,13,16,37,13,1,5],
   [0,1,-1,1,-1,1,-1,1,-1,1,-1,1,1,-1,-1,1,-1,1,-1,1,-1,1,-1,2,1,-2,-1,1,-1,1,1,-1,-1,1,-1,1,-1,1,0,-1,1,1,1,-1,1,-1,-1,-1,1,1,2,-1,-1,1,-1,-2,1,1,-1,-1,1,1,-1,-1,1,-1,3,1,-3,2,-1,1,1,-2,-1,-1,-1,1,1,1,1,1,-1,-1,-1,2,-1,-2,1,2,-2,-1,1,1,2,-1,-1,1,-2,-1,1,1,-1,2,1,2,-1,1,-2,-1,-2,-1,-1,1,1,-1,1,-1,1,1,1,-1,-1,1,4,-1,-1,-4,1,1,1,2,-1,-1,1,-1,-1,1,-1,-1,1,-2,1,-1,1,1,-1,-1,1,1,-1,-1,3,2,-3,-2,2,5,-2,2,2,-5,-2,-2,-2,2,-3,3,2,3,-3,2,-2,-2,3,-3,6,2,-2,3,-6,3,-3,-3,3,7,-4,4,-3,2,-7,2,2,-2,-4,2,8,-2,-2,-2,4,2,-2,2,3,2,-2,-2,2,2,-2,-8,-2,9,-2,2,-3,-2,2,-2,2,2,2,4,-2,-4,10,2,2,-2,-9,-2,2,-2,5,4,-4,4,-2,2,-5,-4,-3,4,2,-3,3,-2,-5,5,3,3,-2,-3,-10,-4]],
  [2, 11,
   [1,1,0,2,2,1,1,3,3,4,4,0,1,1,5,5,2,2,6,6,7,7,1,8,1,8,3,3,9,9,1,2,2,1,4,10,4,10,11,11,1,5,12,12,1,5,13,13,3,3,6,6,2,2,14,14,16,16,15,7,15,8,8,7,1,1,17,17,4,4,1,1,18,18,2,2,5,5,25,3,9,3,25,9,19,24,19,24,1,21,20,1,21,22,20,22,23,23,8,6,33,6,8,33,7,7,26,26,1,32,1,32,28,4,28,10,29,27,27,10,41,4,29,2,2,41,36,31,49,31,34,30,34,36,30,35,1,49,11,5,35,11,1,3,3,5,37,37,8,40,8,40,12,12,42,42,1,38,16,57,1,6,16,39,38,6,7,7,13,13,39,43,2,43,57,2,50,9,44,9,50,4,15,48,44,4,1,15,48,14,14,1,45,45,8,3,5,8,51,47,3,46,46,47,5,51,1,17,17,58,1,58,2,52,52,2,53,7,59,6,6,56,53,55,7,55,1,54,59,56,54,10,1,10,4,60,1,60,8,4,8,64,64,61,1,63,3,63,62,61,5,11,5,3,11,62],
   [1,-1,0,1,-1,2,-2,1,-1,1,-1,0,3,-3,1,-1,2,-2,1,-1,1,-1,4,1,-4,-1,2,-2,1,-1,5,3,-3,-5,2,1,-2,-1,1,-1,6,2,1,-1,-6,-2,1,-1,3,-3,2,-2,4,-4,1,-1,1,-1,1,2,-1,2,-2,-2,7,-7,1,-1,3,-3,8,-8,1,-1,5,-5,3,-3,1,4,2,-4,-1,-2,1,1,-1,-1,9,1,1,-9,-1,1,-1,-1,1,-1,3,-3,1,3,-3,-1,3,-3,1,-1,10,1,-10,-1,1,4,-1,2,1,-1,1,-2,1,-4,-1,6,-6,-1,1,1,1,-1,1,1,-1,-1,-1,1,11,-1,-2,4,-1,2,-11,5,-5,-4,-1,1,4,1,-4,-1,-2,2,1,-1,12,1,-2,1,-12,4,2,1,-1,-4,4,-4,2,-2,-1,1,7,-1,-1,-7,-1,-3,1,3,1,5,2,1,-1,-5,13,-2,-1,2,-2,-13,1,-1,5,6,5,-5,1,1,-6,1,-1,-1,-5,-1,14,2,-2,1,-14,-1,8,1,-1,-8,1,5,1,5,-5,1,-1,1,-5,-1,15,1,-1,-1,-1,3,-15,-3,6,1,16,-1,6,-6,-6,1,-1,1,-16,1,7,-1,1,-1,-6,-3,6,-7,3,-1]],
  [0, 35,
   [0,1,1,2,2,3,3,4,4,1,1,5,5,6,6,7,7,8,8,9,9,2,2,10,10,1,1,11,11,12,12,3,3,13,13,0,14,14,16,15,16,15,4,4,17,1,17,1,5,5,18,18,2,2,6,6,8,19,7,8,7,19,20,20,21,21,22,24,22,24,23,23,1,1,25,25,3,3,26,26,9,9,27,27,28,28,33,29,4,33,29,1,4,1,32,32,2,2,31,10,30,10,30,31,34,34,5,5,36,36,35,41,35,11,41,11,37,1,8,8,37,6,1,6,40,7,7,40,12,38,12,39,39,38,49,13,49,13,3,42,3,42,16,16,43,43,14,14,1,1,44,15,44,15,2,2,57,48,50,48,57,50,4,45,45,4,46,47,47,46,1,51,1,17,17,51,8,9,9,5,58,8,58,5,52,52,55,56,53,56,55,59,59,53,54,1,6,54,7,7,6,1,2,3,2,3,64,60,60,10,10,64,61,62,61,63,1,63,62,1,18,24,18,4,25,4,8,21,21,1,24,22,25,22,8,11,19,11,23,1,20,23,19,20,5,12,5,1,16,2,12,13,2,13,1,16],
   [0,1,-1,1,-1,1,-1,1,-1,2,-2,1,-1,1,-1,1,-1,1,-1,1,-1,2,-2,1,-1,3,-3,1,-1,1,-1,2,-2,1,-1,0,1,-1,1,1,-1,-1,2,-2,1,4,-1,-4,2,-2,1,-1,-3,3,2,-2,2,1,2,-2,-2,-1,1,-1,1,-1,1,1,-1,-1,1,-1,5,-5,1,-1,3,-3,1,-1,2,-2,1,-1,1,-1,1,1,3,-1,-1,6,-3,-6,-1,1,4,-4,1,2,1,-2,-1,-1,1,-1,3,-3,1,-1,1,1,-1,2,-1,-2,1,7,-3,3,-1,3,-7,-3,1,-3,3,-1,2,1,-2,1,-1,-1,1,2,-1,-2,-4,-1,4,1,2,-2,1,-1,-2,2,8,-8,-1,2,1,-2,-5,5,1,-1,-1,1,-1,1,4,-1,1,-4,-1,-1,1,1,9,1,-9,2,-2,-1,-4,3,-3,-4,-1,4,1,4,1,-1,1,-1,1,1,-1,1,-1,-1,-1,10,4,1,4,-4,-4,-10,6,5,-6,-5,1,-1,1,3,-3,-1,1,-1,-1,-1,11,1,1,-11,-2,-2,2,5,-2,-5,-5,2,-2,12,2,-2,2,2,5,-3,-2,3,-2,-12,-2,2,2,2,-5,3,5,13,-3,7,-3,-3,-7,3,-13,3]],
  [0, 34,
   [0,1,1,1,2,2,1,3,3,1,1,1,4,4,1,5,2,1,5,2,1,1,6,6,1,1,1,1,1,7,3,1,2,3,0,1,2,7,1,1,1,8,1,1,8,1,1,1,9,1,9,1,2,1,1,2,1,1,10,4,1,10,1,4,1,1,1,1,1,3,1,1,1,3,2,1,5,1,1,1,2,5,1,11,1,11,1,1,1,1,1,1,1,1,1,1,2,1,6,1,6,1,1,2,1,1,1,1,1,1,1,12,3,1,12,1,1,1,2,1,1,3,1,1,1,1,1,1,4,1,1,1,2,1,1,4,1,1,1,1,1,1,2,1,1,1,1,1,1,1,1,1,1,1,3,1,2,1,1,5,1,1,1,1,1,7,1,7,1,1,2,3,1,1,1,1,5,1,1,1,1,1,1,2,13,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,13,2,1,1,4,1,1,1,3,1,6,1,1,1,14,1,1,1,1,1,14,6,1,1,1,1,15,2,4,1,2,3,15,1,1,1,8,1,1,8,1,1,1,1,1,1,1,1,2,1,1,1,1,1,1,1],
   [0,1,-1,2,1,-1,-2,1,-1,3,-3,4,1,-1,-4,1,2,5,-1,-2,-5,6,1,-1,-6,7,-7,8,-8,1,2,9,3,-2,0,-9,-3,-1,10,-10,11,1,-11,12,-1,-12,13,-13,1,14,-1,-14,4,15,-15,-4,16,-16,1,2,17,-1,-17,-2,18,-18,19,-19,20,3,-20,21,-21,-3,5,22,2,-22,-23,23,-5,-2,24,1,-24,-1,25,-25,26,-26,-27,27,28,29,-28,-29,6,30,2,-31,-2,-30,31,-6,-32,32,33,-33,34,-35,-34,1,4,-36,-1,35,37,36,7,-37,38,-4,-38,39,41,40,-40,-39,3,42,-43,-41,-7,-42,43,-3,44,-44,45,-45,46,47,8,-47,-48,-46,50,-50,48,49,51,-49,52,-52,5,-51,-8,-53,53,3,-56,56,55,54,-54,2,60,-2,-55,58,9,-5,59,57,-57,-63,-3,-58,-60,-61,61,-59,-62,-9,1,64,62,69,-64,63,65,-67,-68,66,-65,68,-66,-69,67,-70,-1,10,71,-71,4,73,72,70,6,-76,-3,74,-78,-74,1,78,80,-72,-75,76,-1,3,-73,79,75,77,1,11,-4,-79,-10,-6,-1,-77,-83,-80,2,81,-84,-2,83,-81,82,-82,84,-87,-86,85,-11,-85,86,-89,87,-88,88,89]],
  [2, 33,
   [1,1,0,2,1,2,1,3,3,1,1,4,4,2,2,1,1,5,5,6,1,6,1,7,7,3,3,2,8,2,8,1,1,0,9,9,1,1,10,4,10,4,11,11,2,1,2,1,12,12,3,3,1,1,13,5,5,13,14,1,1,14,2,2,6,6,15,1,1,15,16,4,7,16,4,7,1,1,3,3,8,8,2,2,1,1,17,17,1,1,18,18,5,5,2,2,1,1,9,19,9,19,20,3,3,20,1,10,21,1,10,4,4,21,22,6,6,22,1,1,23,24,2,2,23,24,11,1,1,11,7,25,7,1,1,25,8,8,3,26,3,1,12,2,2,26,1,12,5,5,27,4,1,4,1,27,28,1,28,13,1,13,2,29,2,1,32,6,1,30,14,29,14,6,3,31,3,1,30,1,32,31,33,9,33,1,1,7,9,7,2,2,1,1,4,36,34,4,5,10,10,5,34,1,1,35,8,8,36,3,35,1,15,3,2,1,16,15,16,2,37,1,37,1,1,1,6,6,38,1,38,11,1,39,39,40,11,2,41,4,40,1,2,4,1,1,1,41,3,1,3,1,5,7,5,7],
   [1,-1,0,1,2,-1,-2,1,-1,3,-3,1,-1,2,-2,4,-4,1,-1,1,5,-1,-5,1,-1,2,-2,3,1,-3,-1,6,-6,0,1,-1,7,-7,1,2,-1,-2,1,-1,4,8,-4,-8,1,-1,3,-3,9,-9,1,2,-2,-1,1,10,-10,-1,5,-5,2,-2,1,11,-11,-1,1,3,2,-1,-3,-2,12,-12,4,-4,2,-2,-6,6,13,-13,1,-1,14,-14,1,-1,3,-3,7,-7,15,-15,2,1,-2,-1,1,5,-5,-1,-16,2,1,16,-2,4,-4,-1,1,3,-3,-1,17,-17,1,1,-8,8,-1,-1,2,18,-18,-2,3,1,-3,19,-19,-1,3,-3,6,1,-6,20,2,9,-9,-1,-20,-2,4,-4,1,-5,21,5,-21,-1,1,-22,-1,2,22,-2,10,1,-10,23,1,4,-23,1,2,-1,-2,-4,-7,1,7,-24,-1,24,-1,-1,1,3,-1,-25,25,4,-3,-4,11,-11,26,-26,6,1,1,-6,-5,-3,3,5,-1,-27,27,1,4,-4,-1,-8,-1,28,2,8,-12,-28,-2,-2,2,12,-1,29,1,-29,30,-30,5,-5,1,-31,-1,3,31,-1,1,1,-3,-13,1,-7,-1,-32,13,7,32,33,-33,-1,-9,-34,9,34,-6,5,6,-5]],
  [2, 13,
   [1,1,0,1,1,2,2,1,1,3,3,1,1,0,2,2,4,1,4,1,1,1,5,5,1,1,6,6,2,2,1,1,3,3,7,7,1,1,8,8,1,1,2,2,1,9,1,9,4,4,10,1,1,10,1,1,11,11,3,3,1,2,1,2,1,1,12,12,5,5,1,1,13,1,1,13,2,2,1,1,6,6,1,1,4,14,4,14,3,1,3,1,1,1,15,7,15,2,2,7,1,1,1,8,1,8,16,16,1,1,1,1,2,1,1,2,1,1,3,5,5,3,4,1,1,4,1,1,17,17,9,1,1,9,2,2,1,1,10,10,1,6,1,1,6,18,1,1,18,1,1,1,2,2,3,1,3,1,1,1,4,1,19,1,19,7,1,1,20,1,4,20,1,7,11,2,1,11,21,2,8,5,1,8,1,5,21,1,1,1,22,1,1,22,1,1,3,3,1,23,2,12,24,1,1,2,1,1,12,23,1,1,24,1,1,1,4,1,1,1,2,1,6,6,4,2,1,1,1,1,1,1,1,14,13,3,1,25,9,25,14,1,9,3,13,1,1,1,1,1,10,1,1,2,10,2],
   [-20,-1,0,2,-2,1,-1,3,-3,1,-1,4,-4,0,2,-2,1,5,-1,-5,6,-6,1,-1,7,-7,1,-1,3,-3,8,-8,2,-2,1,-1,9,-9,1,-1,10,-10,4,-4,11,1,-11,-1,2,-2,1,12,-12,-1,13,-13,1,-1,3,-3,14,5,-14,-5,-15,15,-1,1,2,-2,16,-16,1,17,-17,-1,6,-6,18,-18,2,-2,-19,19,-3,1,3,-1,4,20,-4,1,-21,21,1,2,-1,-7,7,-2,22,-22,23,2,-23,-2,1,-1,-24,24,-25,25,-8,-26,26,8,-27,27,5,3,-3,-5,-4,28,-28,4,29,-29,1,-1,-2,-30,30,2,9,-9,-31,31,2,-2,-32,3,32,-33,-3,1,33,-34,-1,34,-35,35,-10,10,-6,36,6,-36,37,-37,-5,38,1,-38,-1,3,39,-39,-1,40,5,1,-40,-3,2,-11,-41,-2,1,11,-3,-4,41,3,42,4,-1,-43,-42,43,1,-44,45,-1,44,-45,-7,7,-46,1,-12,2,1,-47,46,12,47,48,-2,-1,-48,49,-1,-50,-49,50,-6,-51,51,52,-13,53,-4,4,6,13,-53,-52,-54,55,54,-55,-56,-2,2,-8,56,1,-3,-1,2,58,3,8,-2,57,-58,-60,-59,-57,-3,60,59,-14,3,14]],
  [2, 38,
   [1,1,0,2,2,1,1,3,3,4,4,5,5,1,1,6,6,2,2,7,7,8,8,1,1,3,3,9,9,10,10,1,1,2,2,4,4,11,0,11,12,12,13,13,1,1,5,5,14,14,15,16,15,16,3,3,1,6,1,6,2,2,7,7,8,8,17,17,1,1,4,4,18,18,2,2,1,19,1,20,19,20,21,21,3,3,22,22,5,5,24,1,1,23,9,23,24,9,2,2,10,1,1,10,6,6,25,4,4,25,7,7,26,8,1,8,3,1,26,3,11,11,27,27,2,28,1,2,28,1,12,12,5,5,29,13,13,29,32,1,1,33,31,30,32,4,30,33,4,31,3,14,1,1,3,34,34,2,2,14,6,6,35,36,35,36,1,15,1,16,16,15,7,9,7,9,37,8,8,37,1,1,39,2,38,39,2,40,5,38,40,5,3,3,4,4,10,10,1,1,1,1,41,2,41,2,6,6,1,1,11,42,11,43,3,42,3,17,4,43,1,17,7,1,8,44,4,7,44,5,8,2,5,1,2,48,45,1,12,45,12,48,13,13,1,9,9,46,1,46,47,47,49,18,18,49],
   [1,-1,0,1,-1,2,-2,1,-1,1,-1,1,-1,3,-3,1,-1,-2,2,1,-1,1,-1,4,-4,-2,2,1,-1,1,-1,5,-5,-3,3,2,-2,1,0,-1,1,-1,1,-1,6,-6,2,-2,1,-1,1,1,-1,-1,-3,3,7,2,-7,-2,-4,4,2,-2,2,-2,1,-1,8,-8,3,-3,1,-1,-5,5,9,1,-9,1,-1,-1,1,-1,-4,4,1,-1,3,-3,1,-10,10,1,2,-1,-1,-2,6,-6,2,11,-11,-2,3,-3,1,-4,4,-1,3,-3,1,3,12,-3,-5,-12,-1,5,2,-2,1,-1,-7,1,13,7,-1,-13,2,-2,4,-4,1,2,-2,-1,1,14,-14,1,1,1,-1,-5,-1,-1,5,-1,-6,2,-15,15,6,1,-1,-8,8,-2,-4,4,1,1,-1,-1,16,2,-16,-2,2,-2,4,3,-4,-3,-1,-4,4,1,-17,17,-1,-9,1,1,9,1,-5,-1,-1,5,-7,7,6,-6,3,-3,18,-18,19,-19,1,-10,-1,10,-5,5,20,-20,-3,1,3,1,8,-1,-8,2,7,-1,-21,-2,5,21,5,-1,-7,-5,1,-6,-5,-11,6,22,11,1,1,-22,-3,-1,3,-1,3,-3,-23,4,-4,1,23,-1,1,-1,1,-2,2,-1]],
  [4, 11,
   [1,1,1,1,0,2,2,1,1,3,3,0,1,1,2,2,4,4,1,1,5,5,1,1,2,2,3,3,6,6,1,1,7,7,8,1,8,2,2,1,4,4,1,3,1,3,9,9,2,2,1,5,1,5,10,10,1,1,11,11,3,6,3,4,4,6,2,2,1,12,1,12,7,13,7,13,1,1,8,8,2,2,14,14,16,15,16,5,5,1,3,15,1,3,4,4,1,1,17,17,2,2,6,6,1,18,1,18,22,21,22,21,25,24,25,19,9,20,9,23,19,24,20,3,23,7,3,1,1,7,28,26,29,5,28,26,5,8,29,4,8,27,2,2,4,27,1,1,10,36,10,33,33,36,30,1,32,32,1,30,6,31,31,35,3,6,11,11,3,2,35,2,34,1,34,1,37,37,12,7,12,5,41,5,4,7,1,8,13,4,1,41,13,38,8,38,9,1,40,40,9,1,39,2,2,49,39,42,3,3,14,16,49,14,16,42,43,43,6,6,15,1,1,15,44,44,1,1,50,48,4,5,4,7,5,2,10,10,48,7,50,45,2,1,45,8,8,1,46,46,3,47,47,3,1,1],
   [1,-1,2,-2,0,1,-1,3,-3,1,-1,0,4,-4,2,-2,1,-1,5,-5,1,-1,6,-6,3,-3,2,-2,1,-1,7,-7,1,-1,1,8,-1,4,-4,-8,2,-2,9,3,-9,-3,1,-1,5,-5,10,2,-10,-2,1,-1,11,-11,1,-1,-4,2,4,3,-3,-2,6,-6,12,1,-12,-1,2,1,-2,-1,13,-13,2,-2,7,-7,1,-1,1,1,-1,3,-3,14,5,-1,-14,-5,4,-4,15,-15,1,-1,8,-8,-3,3,16,1,-16,-1,1,1,-1,-1,1,1,-1,1,2,1,-2,1,-1,-1,-1,6,-1,3,-6,17,-17,-3,1,1,1,4,-1,-1,-4,3,-1,5,-3,-1,-9,9,-5,1,18,-18,2,1,-2,1,-1,-1,1,19,-1,1,-19,-1,4,1,-1,1,7,-4,-2,2,-7,10,-1,-10,1,20,-1,-20,1,-1,2,4,-2,5,1,-5,6,-4,21,4,2,-6,-21,-1,-2,1,-4,-1,-3,22,-1,1,3,-22,-1,11,-11,1,1,1,8,-8,2,2,-1,-2,-2,-1,1,-1,-5,5,2,23,-23,-2,1,-1,24,-24,-1,-1,7,6,-7,5,-6,12,-3,3,1,-5,1,1,-12,25,-1,-5,5,-25,-1,1,9,1,-1,-9,26,-26]],
];

const IVI5_BASE_8X8_INTER: number[][] = [[38,58,62,70,74,78,82,90,58,62,66,70,74,78,86,94,62,66,70,72,76,82,90,98,70,70,72,74,78,86,94,102,74,74,76,78,82,90,98,106,78,78,82,86,90,94,102,110,82,86,90,94,98,102,106,114,90,94,98,102,106,110,114,118],[38,58,62,70,74,78,82,90,58,62,66,70,74,78,86,94,62,66,70,72,76,82,90,98,70,70,72,74,78,86,94,102,74,74,76,78,82,90,98,106,78,78,82,86,90,94,102,110,82,86,90,94,98,102,106,114,90,94,98,102,106,110,114,118],[78,170,242,212,222,194,214,194,78,170,242,212,222,194,214,194,78,170,242,212,222,194,214,194,78,170,242,212,222,194,214,194,78,170,242,212,222,194,214,194,78,170,242,212,222,194,214,194,78,170,242,212,222,194,214,194,78,170,242,212,222,194,214,194],[78,78,78,78,78,78,78,78,170,170,170,170,170,170,170,170,242,242,242,242,242,242,242,242,212,212,212,212,212,212,212,212,222,222,222,222,222,222,222,222,194,194,194,194,194,194,194,194,214,214,214,214,214,214,214,214,194,194,194,194,194,194,194,194],[94,94,94,94,94,94,94,94,94,94,94,94,94,94,94,94,94,94,94,94,94,94,94,94,94,94,94,94,94,94,94,94,94,94,94,94,94,94,94,94,94,94,94,94,94,94,94,94,94,94,94,94,94,94,94,94,94,94,94,94,94,94,94,94]];
const IVI5_BASE_8X8_INTRA: number[][] = [[26,46,54,66,70,74,78,90,46,50,62,66,70,78,86,106,54,62,62,68,74,84,102,114,66,66,68,74,82,98,108,122,70,70,74,82,94,102,114,142,74,78,84,98,102,110,134,166,78,86,102,108,114,134,154,202,90,106,114,122,142,166,202,254],[38,58,62,70,74,78,82,90,58,62,66,70,74,78,86,94,62,66,70,72,76,82,90,98,70,70,72,74,78,86,94,102,74,74,76,78,82,90,98,106,78,78,82,86,90,94,102,110,82,86,90,94,98,102,106,114,90,94,98,102,106,110,114,118],[78,170,242,212,222,194,214,194,78,170,242,212,222,194,214,194,78,170,242,212,222,194,214,194,78,170,242,212,222,194,214,194,78,170,242,212,222,194,214,194,78,170,242,212,222,194,214,194,78,170,242,212,222,194,214,194,78,170,242,212,222,194,214,194],[78,78,78,78,78,78,78,78,170,170,170,170,170,170,170,170,242,242,242,242,242,242,242,242,212,212,212,212,212,212,212,212,222,222,222,222,222,222,222,222,194,194,194,194,194,194,194,194,214,214,214,214,214,214,214,214,194,194,194,194,194,194,194,194],[94,94,94,94,94,94,94,94,94,94,94,94,94,94,94,94,94,94,94,94,94,94,94,94,94,94,94,94,94,94,94,94,94,94,94,94,94,94,94,94,94,94,94,94,94,94,94,94,94,94,94,94,94,94,94,94,94,94,94,94,94,94,94,94]];
const IVI5_SCALE_8X8_INTER: number[][] = [[11,17,19,20,21,22,24,26,27,29,32,34,35,37,40,42,46,50,53,57,61,65,68,74],[7,20,22,24,27,30,34,37,41,45,49,53,58,63,68,74,80,86,92,99,106,113,120,126],[21,37,40,45,48,52,58,61,66,72,76,81,86,91,96,101,107,112,118,124,130,136,143,151],[19,31,32,34,37,40,43,45,48,51,54,57,60,63,66,69,72,75,78,82,86,90,94,98],[60,82,88,93,99,104,104,109,115,120,124,128,132,137,142,147,152,157,163,169,173,177,181,186]];
const IVI5_SCALE_8X8_INTRA: number[][] = [[11,14,16,18,20,22,23,24,26,28,30,32,34,36,39,40,42,45,47,49,52,55,57,60],[1,16,18,20,22,24,27,30,34,37,40,44,48,52,56,61,66,71,76,82,88,94,101,108],[19,34,39,42,45,51,54,60,65,69,73,78,83,88,93,99,105,111,117,124,130,136,142,149],[19,31,33,36,39,41,45,47,52,55,58,61,64,68,72,76,79,82,86,90,94,98,102,107],[49,66,71,71,77,82,88,88,93,99,103,107,111,115,120,124,128,132,137,142,147,152,157,164]];
const IVI5_BASE_4X4_INTER: number[] = [30,62,74,82,62,74,82,86,74,82,86,94,82,86,94,102];
const IVI5_BASE_4X4_INTRA: number[] = [30,62,74,82,62,74,82,94,74,82,94,122,82,94,122,146];
const IVI5_SCALE_4X4_INTER: number[] = [11,13,13,14,17,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32,33,34,35];
const IVI5_SCALE_4X4_INTRA: number[] = [1,11,11,13,13,13,14,15,16,17,19,20,21,22,23,24,25,26,27,28,29,30,31,32];
const IVI5_COMMON_PIC_SIZES: number[] = [160,120,80,60,40,30,176,120,88,60,88,72,44,36,60,45,160,60,176,60,20,15,22,18,0,0,0,0,0,0];
const ZIGZAG_DIRECT: number[] = [0,1,8,16,9,2,3,10,17,24,32,25,18,11,4,5,12,19,26,33,40,48,41,34,27,20,13,6,7,14,21,28,35,42,49,56,57,50,43,36,29,22,15,23,30,37,44,51,58,59,52,45,38,31,39,46,53,60,61,54,47,55,62,63];

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const FRAMETYPE_INTRA = 0;
const FRAMETYPE_INTER = 1; // non-droppable P-frame
const FRAMETYPE_INTER_SCAL = 2; // droppable P-frame used in the scalability mode
const FRAMETYPE_INTER_NOREF = 3; // droppable P-frame
const FRAMETYPE_NULL = 4; // empty frame with no data

const IVI5_PIC_SIZE_ESC = 15;
const IVI5_IS_PROTECTED = 0x20;
const IVI_VLC_BITS = 13;
const IVI_VLC_SIZE = 1 << IVI_VLC_BITS;

const ERR = -1;

// Predefined Huffman codebook descriptors (num_rows, xbits[])
const IVI_MB_HUFF_DESC: ReadonlyArray<readonly number[]> = [
  [0, 4, 5, 4, 4, 4, 6, 6],
  [0, 2, 2, 3, 3, 3, 3, 5, 3, 2, 2, 2],
  [0, 2, 3, 4, 3, 3, 3, 3, 4, 3, 2, 2],
  [0, 3, 4, 4, 3, 3, 3, 3, 3, 2, 2, 2],
  [0, 4, 4, 3, 3, 3, 3, 2, 3, 3, 2, 1, 1],
  [0, 4, 4, 4, 4, 3, 3, 3, 2],
  [0, 4, 4, 4, 4, 3, 3, 2, 2, 2],
  [0, 4, 4, 4, 3, 3, 2, 3, 2, 2, 2, 2],
];
const IVI_BLK_HUFF_DESC: ReadonlyArray<readonly number[]> = [
  [1, 2, 3, 4, 4, 7, 5, 5, 4, 1],
  [2, 3, 4, 4, 4, 7, 5, 4, 3, 3, 2],
  [2, 4, 5, 5, 5, 5, 6, 4, 4, 3, 1, 1],
  [3, 3, 4, 4, 5, 6, 6, 4, 4, 3, 2, 1, 1],
  [3, 4, 4, 5, 5, 5, 6, 5, 4, 2, 2],
  [3, 4, 5, 5, 5, 5, 6, 4, 3, 3, 2, 1, 1],
  [3, 4, 5, 5, 5, 6, 5, 4, 3, 3, 2, 1, 1],
  [3, 4, 4, 5, 5, 5, 6, 5, 5],
];

// Scan patterns
const VERTICAL_SCAN_8X8 = new Uint8Array(64);
const HORIZONTAL_SCAN_8X8 = new Uint8Array(64);
for (let i = 0; i < 64; i++) {
  VERTICAL_SCAN_8X8[i] = ((i & 7) << 3) | (i >> 3);
  HORIZONTAL_SCAN_8X8[i] = i;
}
const DIRECT_SCAN_4X4 = Uint8Array.from([0, 1, 4, 8, 5, 2, 3, 6, 9, 12, 13, 10, 7, 11, 14, 15]);
const ZIGZAG_SCAN_8X8 = Uint8Array.from(ZIGZAG_DIRECT);

// Block transform kinds
const TR_SLANT_8X8 = 0;
const TR_ROW_SLANT8 = 1;
const TR_COL_SLANT8 = 2;
const TR_PUT_PIXELS_8X8 = 3;
const TR_SLANT_4X4 = 4;

// ---------------------------------------------------------------------------
// VLC tables (LSB-first bit order, codes are MSB-first prefix codes)
// ---------------------------------------------------------------------------

class VlcTable {
  /** symbol per 13-bit peek value, -1 if the code is not assigned */
  readonly sym = new Int16Array(IVI_VLC_SIZE).fill(-1);
  /** code length per 13-bit peek value */
  readonly len = new Uint8Array(IVI_VLC_SIZE).fill(1);
}

/** Generate a Huffman codebook from a descriptor (ivi_create_huff_from_desc). */
function createHuffFromDesc(numRows: number, xbits: ArrayLike<number>): VlcTable | null {
  const table = new VlcTable();
  let pos = 0;
  for (let i = 0; i < numRows; i++) {
    const codesPerRow = 1 << xbits[i];
    const notLastRow = i !== numRows - 1 ? 1 : 0;
    const prefix = ((1 << i) - 1) << (xbits[i] + notLastRow);
    for (let j = 0; j < codesPerRow; j++) {
      if (pos >= 256) break; // only 256 codes are allowed
      let bits = i + xbits[i] + notLastRow;
      if (bits > IVI_VLC_BITS) return null; // invalid descriptor
      const code = prefix | j;
      if (!bits) bits = 1;
      // bit-reverse the code: the LSB-first reader sees the first code bit in bit 0
      let rev = 0;
      for (let b = 0; b < bits; b++) rev |= ((code >> b) & 1) << (bits - 1 - b);
      for (let idx = rev; idx < IVI_VLC_SIZE; idx += 1 << bits) {
        if (table.sym[idx] !== -1) return null; // colliding codes
        table.sym[idx] = pos;
        table.len[idx] = bits;
      }
      pos++;
    }
  }
  return table;
}

let staticMbVlc: VlcTable[] | null = null;
let staticBlkVlc: VlcTable[] | null = null;

function initStaticVlc(): void {
  if (staticMbVlc) return;
  const mb: VlcTable[] = [];
  const blk: VlcTable[] = [];
  for (let i = 0; i < 8; i++) {
    const m = IVI_MB_HUFF_DESC[i];
    const b = IVI_BLK_HUFF_DESC[i];
    mb.push(createHuffFromDesc(m.length, m) as VlcTable);
    blk.push(createHuffFromDesc(b.length, b) as VlcTable);
  }
  staticMbVlc = mb;
  staticBlkVlc = blk;
}

/** macroblock/block huffman table descriptor */
class HuffTab {
  tabSel = 0;
  tab: VlcTable | null = null;
  custXbits: number[] | null = null;
  custTab: VlcTable | null = null;
}

// ---------------------------------------------------------------------------
// Run-value maps
// ---------------------------------------------------------------------------

class RVMap {
  eob: number;
  esc: number;
  readonly runtab: Uint8Array;
  readonly valtab: Int8Array;
  constructor(d: readonly [number, number, readonly number[], readonly number[]]) {
    this.eob = d[0];
    this.esc = d[1];
    this.runtab = Uint8Array.from(d[2]);
    this.valtab = Int8Array.from(d[3]);
  }
  /** swap two entries (used for applying/undoing band corrections) */
  swap(idx1: number, idx2: number): void {
    const r = this.runtab[idx1];
    this.runtab[idx1] = this.runtab[idx2];
    this.runtab[idx2] = r;
    const v = this.valtab[idx1];
    this.valtab[idx1] = this.valtab[idx2];
    this.valtab[idx2] = v;
    if (idx1 === this.eob || idx2 === this.eob) this.eob ^= idx1 ^ idx2;
    if (idx1 === this.esc || idx2 === this.esc) this.esc ^= idx1 ^ idx2;
  }
}

// ---------------------------------------------------------------------------
// Structures
// ---------------------------------------------------------------------------

/** Macroblock info for one tile (structure of arrays). Integer widths mimic FFmpeg's struct. */
class MbInfo {
  readonly xpos: Int16Array;
  readonly ypos: Int16Array;
  readonly bufOffs: Int32Array;
  readonly type: Uint8Array;
  readonly cbp: Uint8Array;
  readonly qDelta: Int8Array;
  readonly mvX: Int8Array;
  readonly mvY: Int8Array;
  constructor(n: number) {
    this.xpos = new Int16Array(n);
    this.ypos = new Int16Array(n);
    this.bufOffs = new Int32Array(n);
    this.type = new Uint8Array(n);
    this.cbp = new Uint8Array(n);
    this.qDelta = new Int8Array(n);
    this.mvX = new Int8Array(n);
    this.mvY = new Int8Array(n);
  }
}

class Tile {
  xpos = 0;
  ypos = 0;
  width = 0;
  height = 0;
  mbSize = 0;
  isEmpty = 0;
  dataSize = 0;
  numMBs = 0;
  mbs: MbInfo = new MbInfo(0);
  refMbs: MbInfo | null = null;
}

class Band {
  plane = 0;
  bandNum = 0;
  width = 0;
  height = 0;
  aheight = 0;
  pitch = 0;
  bufsize = 0;
  bufs: Array<Int16Array | null> = [null, null, null, null];
  buf: Int16Array | null = null;
  refBuf: Int16Array | null = null;
  isEmpty = 0;
  mbSize = 0;
  blkSize = 0;
  isHalfpel = 0;
  inheritMv = 0;
  inheritQdelta = 0;
  qdeltaPresent = 0;
  globQuant = 0;
  scan: Uint8Array | null = null;
  blkVlc = new HuffTab();
  numCorr = 0;
  corr = new Uint8Array(61 * 2);
  rvmapSel = 0;
  rvMap: RVMap | null = null;
  tiles: Tile[] = [];
  transform = 0;
  transformSize = 0;
  is2dTrans = 0;
  checksumPresent = 0;
  checksum = 0;
  dataSize = 0;
  intraBase: readonly number[] = [];
  interBase: readonly number[] = [];
  intraScale: readonly number[] = [];
  interScale: readonly number[] = [];
}

class Plane {
  width = 0;
  height = 0;
  bands: Band[] = [];
}

interface PicConfig {
  picWidth: number;
  picHeight: number;
  chromaWidth: number;
  chromaHeight: number;
  tileWidth: number;
  tileHeight: number;
  lumaBands: number;
  chromaBands: number;
}

function picConfigDiffers(a: PicConfig, b: PicConfig): boolean {
  return (
    a.picWidth !== b.picWidth ||
    a.picHeight !== b.picHeight ||
    a.chromaWidth !== b.chromaWidth ||
    a.chromaHeight !== b.chromaHeight ||
    a.tileWidth !== b.tileWidth ||
    a.tileHeight !== b.tileHeight ||
    a.lumaBands !== b.lumaBands ||
    a.chromaBands !== b.chromaBands
  );
}

// ---------------------------------------------------------------------------
// DSP: inverse transforms
// ---------------------------------------------------------------------------

/** scratch output of the 1-D transform cores */
const R = new Int32Array(8);
const TMP = new Int32Array(64);

/** inverse slant8 core: inputs in coefficient order, outputs into R[0..7] (no rounding) */
function slant8(i0: number, i1: number, i2: number, i3: number, i4: number, i5: number, i6: number, i7: number): void {
  // parameter naming from FFmpeg: s1,s4,s8,s5,s2,s6,s3,s7
  const s1 = i0, s4 = i1, s8 = i2, s5 = i3, s2 = i4, s6 = i5, s3 = i6, s7 = i7;
  let t0: number, t1: number, t2: number, t3: number, t4: number, t5: number, t6: number, t7: number, t8: number;
  // IVI_SLANT_PART4(s4, s5, t4, t5)
  t0 = s5 + (((s4 * 4) - s5 + 4) >> 3);
  t5 = s4 + ((-s4 - (s5 * 4) + 4) >> 3);
  t4 = t0;
  // butterflies
  t1 = s1 + t5; t5 = s1 - t5;
  t2 = s2 + s6; t6 = s2 - s6;
  t7 = s7 + s3; t3 = s7 - s3;
  t0 = t4 + s8; t8 = t4 - s8; t4 = t0;
  // t1,t2
  t0 = t1 - t2; t1 = t1 + t2; t2 = t0;
  // IVI_IREFLECT(t4, t3, t4, t3)
  t0 = (((t4 + (t3 * 2) + 2) >> 2)) + t4;
  t3 = (((t4 * 2) - t3 + 2) >> 2) - t3;
  t4 = t0;
  // t5,t6
  t0 = t5 - t6; t5 = t5 + t6; t6 = t0;
  // IVI_IREFLECT(t8, t7, t8, t7)
  t0 = (((t8 + (t7 * 2) + 2) >> 2)) + t8;
  t7 = (((t8 * 2) - t7 + 2) >> 2) - t7;
  t8 = t0;
  // t1,t4  t2,t3
  t0 = t1 - t4; t1 = t1 + t4; t4 = t0;
  t0 = t2 - t3; t2 = t2 + t3; t3 = t0;
  // t5,t8  t6,t7
  t0 = t5 - t8; t5 = t5 + t8; t8 = t0;
  t0 = t6 - t7; t6 = t6 + t7; t7 = t0;
  R[0] = t1; R[1] = t2; R[2] = t3; R[3] = t4;
  R[4] = t5; R[5] = t6; R[6] = t7; R[7] = t8;
}

/** inverse slant4 core: parameters (s1,s4,s2,s3) = inputs in coefficient order */
function slant4(i0: number, i1: number, i2: number, i3: number): void {
  const s1 = i0, s4 = i1, s2 = i2, s3 = i3;
  let t0: number, t1: number, t2: number, t3: number, t4: number;
  // BFLY(s1, s2, t1, t2)
  t1 = s1 + s2; t2 = s1 - s2;
  // IREFLECT(s4, s3, t4, t3)
  t4 = (((s4 + (s3 * 2) + 2) >> 2)) + s4;
  t3 = (((s4 * 2) - s3 + 2) >> 2) - s3;
  // BFLY(t1, t4, t1, t4)
  t0 = t1 - t4; t1 = t1 + t4; t4 = t0;
  // BFLY(t2, t3, t2, t3)
  t0 = t2 - t3; t2 = t2 + t3; t3 = t0;
  R[0] = t1; R[1] = t2; R[2] = t3; R[3] = t4;
}

function invSlant8x8(inp: Int32Array, out: Int16Array, o: number, pitch: number, flags: Uint8Array): void {
  const tmp = TMP;
  for (let i = 0; i < 8; i++) {
    if (flags[i]) {
      slant8(inp[i], inp[8 + i], inp[16 + i], inp[24 + i], inp[32 + i], inp[40 + i], inp[48 + i], inp[56 + i]);
      tmp[i] = R[0]; tmp[8 + i] = R[1]; tmp[16 + i] = R[2]; tmp[24 + i] = R[3];
      tmp[32 + i] = R[4]; tmp[40 + i] = R[5]; tmp[48 + i] = R[6]; tmp[56 + i] = R[7];
    } else {
      tmp[i] = tmp[8 + i] = tmp[16 + i] = tmp[24 + i] = tmp[32 + i] = tmp[40 + i] = tmp[48 + i] = tmp[56 + i] = 0;
    }
  }
  for (let i = 0; i < 8; i++) {
    const s = i * 8;
    if (!tmp[s] && !tmp[s + 1] && !tmp[s + 2] && !tmp[s + 3] && !tmp[s + 4] && !tmp[s + 5] && !tmp[s + 6] && !tmp[s + 7]) {
      out[o] = out[o + 1] = out[o + 2] = out[o + 3] = out[o + 4] = out[o + 5] = out[o + 6] = out[o + 7] = 0;
    } else {
      slant8(tmp[s], tmp[s + 1], tmp[s + 2], tmp[s + 3], tmp[s + 4], tmp[s + 5], tmp[s + 6], tmp[s + 7]);
      out[o] = (R[0] + 1) >> 1; out[o + 1] = (R[1] + 1) >> 1; out[o + 2] = (R[2] + 1) >> 1; out[o + 3] = (R[3] + 1) >> 1;
      out[o + 4] = (R[4] + 1) >> 1; out[o + 5] = (R[5] + 1) >> 1; out[o + 6] = (R[6] + 1) >> 1; out[o + 7] = (R[7] + 1) >> 1;
    }
    o += pitch;
  }
}

function invSlant4x4(inp: Int32Array, out: Int16Array, o: number, pitch: number, flags: Uint8Array): void {
  const tmp = TMP;
  for (let i = 0; i < 4; i++) {
    if (flags[i]) {
      slant4(inp[i], inp[4 + i], inp[8 + i], inp[12 + i]);
      tmp[i] = R[0]; tmp[4 + i] = R[1]; tmp[8 + i] = R[2]; tmp[12 + i] = R[3];
    } else {
      tmp[i] = tmp[4 + i] = tmp[8 + i] = tmp[12 + i] = 0;
    }
  }
  for (let i = 0; i < 4; i++) {
    const s = i * 4;
    if (!tmp[s] && !tmp[s + 1] && !tmp[s + 2] && !tmp[s + 3]) {
      out[o] = out[o + 1] = out[o + 2] = out[o + 3] = 0;
    } else {
      slant4(tmp[s], tmp[s + 1], tmp[s + 2], tmp[s + 3]);
      out[o] = (R[0] + 1) >> 1; out[o + 1] = (R[1] + 1) >> 1; out[o + 2] = (R[2] + 1) >> 1; out[o + 3] = (R[3] + 1) >> 1;
    }
    o += pitch;
  }
}

function rowSlant8(inp: Int32Array, out: Int16Array, o: number, pitch: number, _flags: Uint8Array): void {
  for (let i = 0; i < 8; i++) {
    const s = i * 8;
    if (!inp[s] && !inp[s + 1] && !inp[s + 2] && !inp[s + 3] && !inp[s + 4] && !inp[s + 5] && !inp[s + 6] && !inp[s + 7]) {
      out[o] = out[o + 1] = out[o + 2] = out[o + 3] = out[o + 4] = out[o + 5] = out[o + 6] = out[o + 7] = 0;
    } else {
      slant8(inp[s], inp[s + 1], inp[s + 2], inp[s + 3], inp[s + 4], inp[s + 5], inp[s + 6], inp[s + 7]);
      out[o] = (R[0] + 1) >> 1; out[o + 1] = (R[1] + 1) >> 1; out[o + 2] = (R[2] + 1) >> 1; out[o + 3] = (R[3] + 1) >> 1;
      out[o + 4] = (R[4] + 1) >> 1; out[o + 5] = (R[5] + 1) >> 1; out[o + 6] = (R[6] + 1) >> 1; out[o + 7] = (R[7] + 1) >> 1;
    }
    o += pitch;
  }
}

function colSlant8(inp: Int32Array, out: Int16Array, o: number, pitch: number, flags: Uint8Array): void {
  for (let i = 0; i < 8; i++) {
    let p = o + i;
    if (flags[i]) {
      slant8(inp[i], inp[8 + i], inp[16 + i], inp[24 + i], inp[32 + i], inp[40 + i], inp[48 + i], inp[56 + i]);
      for (let k = 0; k < 8; k++, p += pitch) out[p] = (R[k] + 1) >> 1;
    } else {
      for (let k = 0; k < 8; k++, p += pitch) out[p] = 0;
    }
  }
}

function putPixels8x8(inp: Int32Array, out: Int16Array, o: number, pitch: number, _flags: Uint8Array): void {
  for (let y = 0; y < 8; y++, o += pitch) {
    const s = y * 8;
    for (let x = 0; x < 8; x++) out[o + x] = inp[s + x];
  }
}

function invTransform(kind: number, inp: Int32Array, out: Int16Array, o: number, pitch: number, flags: Uint8Array): void {
  switch (kind) {
    case TR_SLANT_8X8: invSlant8x8(inp, out, o, pitch, flags); break;
    case TR_ROW_SLANT8: rowSlant8(inp, out, o, pitch, flags); break;
    case TR_COL_SLANT8: colSlant8(inp, out, o, pitch, flags); break;
    case TR_PUT_PIXELS_8X8: putPixels8x8(inp, out, o, pitch, flags); break;
    default: invSlant4x4(inp, out, o, pitch, flags); break;
  }
}

/** DC-only block reconstruction (ff_ivi_dc_*) */
function dcTransform(kind: number, dc: number, out: Int16Array, o: number, pitch: number, blk: number): void {
  switch (kind) {
    case TR_ROW_SLANT8: {
      const v = (dc + 1) >> 1;
      for (let x = 0; x < blk; x++) out[o + x] = v;
      o += pitch;
      for (let y = 1; y < blk; y++, o += pitch) for (let x = 0; x < blk; x++) out[o + x] = 0;
      break;
    }
    case TR_COL_SLANT8: {
      const v = (dc + 1) >> 1;
      for (let y = 0; y < blk; y++, o += pitch) {
        out[o] = v;
        for (let x = 1; x < blk; x++) out[o + x] = 0;
      }
      break;
    }
    case TR_PUT_PIXELS_8X8: {
      out[o] = dc;
      for (let x = 1; x < 8; x++) out[o + x] = 0;
      o += pitch;
      for (let y = 1; y < 8; y++, o += pitch) for (let x = 0; x < 8; x++) out[o + x] = 0;
      break;
    }
    default: {
      // dc_slant_2d: int16 truncation happens on store
      const v = (dc + 1) >> 1;
      for (let y = 0; y < blk; y++, o += pitch) for (let x = 0; x < blk; x++) out[o + x] = v;
      break;
    }
  }
}

// ---------------------------------------------------------------------------
// DSP: motion compensation
// ---------------------------------------------------------------------------

/** MC with put (no delta): dst = pred */
function mcPut(dst: Int16Array, d: number, ref: Int16Array, r: number, pitch: number, size: number, type: number): void {
  switch (type) {
    case 0:
      for (let i = 0; i < size; i++, d += pitch, r += pitch) for (let j = 0; j < size; j++) dst[d + j] = ref[r + j];
      break;
    case 1:
      for (let i = 0; i < size; i++, d += pitch, r += pitch)
        for (let j = 0; j < size; j++) dst[d + j] = (ref[r + j] + ref[r + j + 1]) >> 1;
      break;
    case 2:
      for (let i = 0; i < size; i++, d += pitch, r += pitch)
        for (let j = 0; j < size; j++) dst[d + j] = (ref[r + j] + ref[r + pitch + j]) >> 1;
      break;
    default:
      for (let i = 0; i < size; i++, d += pitch, r += pitch)
        for (let j = 0; j < size; j++)
          dst[d + j] = (ref[r + j] + ref[r + j + 1] + ref[r + pitch + j] + ref[r + pitch + j + 1]) >> 2;
      break;
  }
}

/** MC with delta: dst += pred (int16 wrap on store, like the C code) */
function mcAdd(dst: Int16Array, d: number, ref: Int16Array, r: number, pitch: number, size: number, type: number): void {
  switch (type) {
    case 0:
      for (let i = 0; i < size; i++, d += pitch, r += pitch) for (let j = 0; j < size; j++) dst[d + j] += ref[r + j];
      break;
    case 1:
      for (let i = 0; i < size; i++, d += pitch, r += pitch)
        for (let j = 0; j < size; j++) dst[d + j] += (ref[r + j] + ref[r + j + 1]) >> 1;
      break;
    case 2:
      for (let i = 0; i < size; i++, d += pitch, r += pitch)
        for (let j = 0; j < size; j++) dst[d + j] += (ref[r + j] + ref[r + pitch + j]) >> 1;
      break;
    default:
      for (let i = 0; i < size; i++, d += pitch, r += pitch)
        for (let j = 0; j < size; j++)
          dst[d + j] += (ref[r + j] + ref[r + j + 1] + ref[r + pitch + j] + ref[r + pitch + j + 1]) >> 2;
      break;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** convert unsigned values into signed ones (the sign is in the LSB) */
function toSigned(val: number): number {
  return -((val >> 1) ^ -(val & 1));
}

function scaleMv(mv: number, mvScale: number): number {
  return (mv + (mv > 0 ? 1 : 0) + (mvScale - 1)) >> mvScale;
}

function mbsPerTile(w: number, h: number, mbSize: number): number {
  return Math.floor((w + mbSize - 1) / mbSize) * Math.floor((h + mbSize - 1) / mbSize);
}

function clip(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** 5/3 wavelet recomposition of the 4 luma bands into dst (ff_ivi_recompose53). */
function recompose53(plane: Plane, dst: Uint8Array, dstPitch: number): void {
  const bands = plane.bands;
  let pitch = bands[0].pitch;
  let backPitch = 0;
  const b0 = bands[0].buf as Int16Array;
  const b1 = bands[1].buf as Int16Array;
  const b2 = bands[2].buf as Int16Array;
  const b3 = bands[3].buf as Int16Array;
  let b0p = 0, b1p = 0, b2p = 0, b3p = 0;
  let d = 0;

  let p0 = 0, p1 = 0, p2 = 0, p3 = 0, tmp0 = 0, tmp1 = 0, tmp2 = 0;
  let b0_1 = 0, b0_2 = 0, b1_1 = 0, b1_2 = 0, b1_3 = 0;
  let b2_1 = 0, b2_2 = 0, b2_3 = 0, b2_4 = 0, b2_5 = 0, b2_6 = 0;
  let b3_1 = 0, b3_2 = 0, b3_3 = 0, b3_4 = 0, b3_5 = 0, b3_6 = 0, b3_7 = 0, b3_8 = 0, b3_9 = 0;

  const width = plane.width;
  const height = plane.height;

  for (let y = 0; y < height; y += 2) {
    if (y + 2 >= height) pitch = 0;
    b0_1 = b0[b0p];
    b0_2 = b0[b0p + pitch];

    b1_1 = b1[b1p + backPitch];
    b1_2 = b1[b1p];
    b1_3 = b1_1 - b1_2 * 6 + b1[b1p + pitch];

    b2_2 = b2[b2p];
    b2_3 = b2_2;
    b2_5 = b2[b2p + pitch];
    b2_6 = b2_5;

    b3_2 = b3[b3p + backPitch];
    b3_3 = b3_2;
    b3_5 = b3[b3p];
    b3_6 = b3_5;
    b3_8 = b3_2 - b3_5 * 6 + b3[b3p + pitch];
    b3_9 = b3_8;

    for (let x = 0, indx = 0; x < width; x += 2, indx++) {
      if (x + 2 >= width) {
        b0p--; b1p--; b2p--; b3p--;
      }

      b2_1 = b2_2;
      b2_2 = b2_3;
      b2_4 = b2_5;
      b2_5 = b2_6;
      b3_1 = b3_2;
      b3_2 = b3_3;
      b3_4 = b3_5;
      b3_5 = b3_6;
      b3_7 = b3_8;
      b3_8 = b3_9;

      // LL band
      tmp0 = b0_1;
      tmp2 = b0_2;
      b0_1 = b0[b0p + indx + 1];
      b0_2 = b0[b0p + pitch + indx + 1];
      tmp1 = tmp0 + b0_1;

      p0 = tmp0 * 16;
      p1 = tmp1 * 8;
      p2 = (tmp0 + tmp2) * 8;
      p3 = (tmp1 + tmp2 + b0_2) * 4;

      // HL band
      tmp0 = b1_2;
      tmp1 = b1_1;
      b1_2 = b1[b1p + indx + 1];
      b1_1 = b1[b1p + backPitch + indx + 1];

      tmp2 = tmp1 - tmp0 * 6 + b1_3;
      b1_3 = b1_1 - b1_2 * 6 + b1[b1p + pitch + indx + 1];

      p0 += (tmp0 + tmp1) * 8;
      p1 += (tmp0 + tmp1 + b1_1 + b1_2) * 4;
      p2 += tmp2 * 4;
      p3 += (tmp2 + b1_3) * 2;

      // LH band
      b2_3 = b2[b2p + indx + 1];
      b2_6 = b2[b2p + pitch + indx + 1];

      tmp0 = b2_1 + b2_2;
      tmp1 = b2_1 - b2_2 * 6 + b2_3;

      p0 += tmp0 * 8;
      p1 += tmp1 * 4;
      p2 += (tmp0 + b2_4 + b2_5) * 4;
      p3 += (tmp1 + b2_4 - b2_5 * 6 + b2_6) * 2;

      // HH band
      b3_6 = b3[b3p + indx + 1];
      b3_3 = b3[b3p + backPitch + indx + 1];

      tmp0 = b3_1 + b3_4;
      tmp1 = b3_2 + b3_5;
      tmp2 = b3_3 + b3_6;

      b3_9 = b3_3 - b3_6 * 6 + b3[b3p + pitch + indx + 1];

      p0 += (tmp0 + tmp1) * 4;
      p1 += (tmp0 - tmp1 * 6 + tmp2) * 2;
      p2 += (b3_7 + b3_8) * 2;
      p3 += b3_7 - b3_8 * 6 + b3_9;

      let v = (p0 >> 6) + 128;
      dst[d + x] = v < 0 ? 0 : v > 255 ? 255 : v;
      v = (p1 >> 6) + 128;
      dst[d + x + 1] = v < 0 ? 0 : v > 255 ? 255 : v;
      v = (p2 >> 6) + 128;
      dst[d + dstPitch + x] = v < 0 ? 0 : v > 255 ? 255 : v;
      v = (p3 >> 6) + 128;
      dst[d + dstPitch + x + 1] = v < 0 ? 0 : v > 255 ? 255 : v;
    }

    d += dstPitch << 1;
    backPitch = -pitch;
    b0p += pitch + 1;
    b1p += pitch + 1;
    b2p += pitch + 1;
    b3p += pitch + 1;
  }
}

/** Add back the bias of 128 and clip (ivi_output_plane). */
function outputPlane(plane: Plane, dst: Uint8Array, dstPitch: number): void {
  const band = plane.bands[0];
  const src = band.buf;
  if (!src) return;
  const pitch = band.pitch;
  const w = plane.width;
  const h = plane.height;
  let s = 0;
  let d = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const t = src[s + x] + 128;
      dst[d + x] = t < 0 ? 0 : t > 255 ? 255 : t;
    }
    s += pitch;
    d += dstPitch;
  }
}

// ---------------------------------------------------------------------------
// Decoder
// ---------------------------------------------------------------------------

export class Indeo5Decoder {
  /** Luma plane (width x height, row stride `strideY`). */
  y: Uint8Array = new Uint8Array(0);
  /** Cb plane ((width+3)>>2 x (height+3)>>2, row stride `strideC`). */
  u: Uint8Array = new Uint8Array(0);
  /** Cr plane (same layout as `u`). */
  v: Uint8Array = new Uint8Array(0);
  /** Picture width in pixels (taken from the stream's GOP header once decoded). */
  width: number;
  /** Picture height in pixels. */
  height: number;
  strideY = 0;
  strideC = 0;
  chromaWidth = 0;
  chromaHeight = 0;
  /** Description of the last error (decode() returned false), or null. */
  lastError: string | null = null;
  /** Frame type of the last parsed picture header (0 intra, 1 inter, 2 inter-scal, 3 inter-noref, 4 null). */
  frameType = FRAMETYPE_INTRA;

  // bit reader
  private data: Uint8Array = new Uint8Array(0);
  private pos = 0;
  private bitsTotal = 0;

  // context
  private prevFrameType = FRAMETYPE_INTRA;
  /** Frame number from the last picture header. */
  frameNum = 0;
  private frameFlags = 0;
  private gopFlags = 0;
  private isScalable = false;
  private interScal = 0;
  private bufSwitch = 0;
  private dstBuf = 0;
  private refBuf = 0;
  private ref2Buf = 0;
  private gopInvalid = 1;
  private bufInvalid = [0, 0, 0, 0];
  private picConf: PicConfig;
  private planes: Plane[] = [new Plane(), new Plane(), new Plane()];
  private rvmapTabs: RVMap[] = RVMAP_DATA.map((d) => new RVMap(d));
  private mbVlc = new HuffTab();
  private trvec = new Int32Array(64);
  private colFlags = new Uint8Array(8);

  constructor(width: number, height: number) {
    initStaticVlc();
    this.width = width;
    this.height = height;
    this.picConf = {
      picWidth: width,
      picHeight: height,
      chromaWidth: (width + 3) >> 2,
      chromaHeight: (height + 3) >> 2,
      tileWidth: width,
      tileHeight: height,
      lumaBands: 1,
      chromaBands: 1,
    };
    this.initPlanes(this.picConf);
  }

  // -- bit reader ---------------------------------------------------------

  private getBits(n: number): number {
    const p = this.pos;
    const d = this.data;
    const b = p >> 3;
    const v = (d[b] | (d[b + 1] << 8) | (d[b + 2] << 16) | (d[b + 3] << 24)) >>> (p & 7);
    this.pos = p + n;
    return v & ((1 << n) - 1);
  }

  private getBits1(): number {
    const p = this.pos;
    this.pos = p + 1;
    return (this.data[p >> 3] >> (p & 7)) & 1;
  }

  private skipBits(n: number): void {
    this.pos += n;
  }

  private alignGetBits(): void {
    this.pos = (this.pos + 7) & ~7;
  }

  private getVlc(tab: VlcTable): number {
    const p = this.pos;
    const d = this.data;
    const b = p >> 3;
    const v = ((d[b] | (d[b + 1] << 8) | (d[b + 2] << 16)) >>> (p & 7)) & (IVI_VLC_SIZE - 1);
    this.pos = p + tab.len[v];
    return tab.sym[v];
  }

  // -- Huffman descriptor ---------------------------------------------------

  private decHuffDesc(descCoded: number, whichTab: number, huff: HuffTab): number {
    const statics = (whichTab ? staticBlkVlc : staticMbVlc) as VlcTable[];
    if (!descCoded) {
      huff.tab = statics[7];
      return 0;
    }
    huff.tabSel = this.getBits(3);
    if (huff.tabSel === 7) {
      const numRows = this.getBits(4);
      if (!numRows) {
        this.lastError = 'Empty custom Huffman table';
        return ERR;
      }
      const xbits: number[] = [];
      for (let i = 0; i < numRows; i++) xbits.push(this.getBits(4));
      const old = huff.custXbits;
      let same = !!old && !!huff.custTab && old.length === numRows;
      if (same) for (let i = 0; i < numRows; i++) if ((old as number[])[i] !== xbits[i]) { same = false; break; }
      if (!same) {
        huff.custXbits = xbits;
        huff.custTab = createHuffFromDesc(numRows, xbits);
        if (!huff.custTab) {
          huff.custXbits = null;
          this.lastError = 'Error while initializing custom vlc table';
          return ERR;
        }
      }
      huff.tab = huff.custTab;
    } else {
      huff.tab = statics[huff.tabSel];
    }
    return 0;
  }

  // -- planes ---------------------------------------------------------------

  private initPlanes(cfg: PicConfig): number {
    if (cfg.picWidth < 1 || cfg.picHeight < 1 || cfg.picWidth > 16384 || cfg.picHeight > 16384 ||
        cfg.lumaBands < 1 || cfg.chromaBands < 1) {
      this.lastError = 'Invalid picture size';
      return ERR;
    }
    const planes = this.planes;
    planes[0].width = cfg.picWidth;
    planes[0].height = cfg.picHeight;
    planes[1].width = planes[2].width = (cfg.picWidth + 3) >> 2;
    planes[1].height = planes[2].height = (cfg.picHeight + 3) >> 2;
    const numBands = [cfg.lumaBands, cfg.chromaBands, cfg.chromaBands];

    for (let p = 0; p < 3; p++) {
      const pl = planes[p];
      pl.bands = [];
      const bWidth = numBands[p] === 1 ? pl.width : (pl.width + 1) >> 1;
      const bHeight = numBands[p] === 1 ? pl.height : (pl.height + 1) >> 1;
      const align = p ? 8 : 16;
      const widthAligned = Math.ceil(bWidth / align) * align;
      const heightAligned = Math.ceil(bHeight / align) * align;
      for (let b = 0; b < numBands[p]; b++) {
        const band = new Band();
        band.plane = p;
        band.bandNum = b;
        band.width = bWidth;
        band.height = bHeight;
        band.pitch = widthAligned;
        band.aheight = heightAligned;
        band.bufsize = widthAligned * heightAligned;
        pl.bands.push(band);
      }
    }

    // output planes
    this.width = cfg.picWidth;
    this.height = cfg.picHeight;
    this.chromaWidth = (cfg.picWidth + 3) >> 2;
    this.chromaHeight = (cfg.picHeight + 3) >> 2;
    this.strideY = (cfg.picWidth + 1) & ~1;
    this.strideC = this.chromaWidth;
    const ySize = this.strideY * ((cfg.picHeight + 1) & ~1);
    const cSize = this.strideC * this.chromaHeight;
    if (this.y.length !== ySize) this.y = new Uint8Array(ySize);
    if (this.u.length !== cSize) { this.u = new Uint8Array(cSize); this.v = new Uint8Array(cSize); }
    return 0;
  }

  private initTiles(tileWidth: number, tileHeight: number): number {
    const planes = this.planes;
    for (let p = 0; p < 3; p++) {
      let tW = !p ? tileWidth : (tileWidth + 3) >> 2;
      let tH = !p ? tileHeight : (tileHeight + 3) >> 2;
      if (!p && planes[0].bands.length === 4) {
        if (tW % 2 || tH % 2) {
          this.lastError = 'Odd tiles are not supported';
          return ERR;
        }
        tW >>= 1;
        tH >>= 1;
      }
      if (tW <= 0 || tH <= 0) {
        this.lastError = 'Invalid tile size';
        return ERR;
      }
      for (let b = 0; b < planes[p].bands.length; b++) {
        const band = planes[p].bands[b];
        const tiles: Tile[] = [];
        let refIdx = 0;
        const refTiles = planes[0].bands[0].tiles;
        for (let y = 0; y < band.height; y += tH) {
          for (let x = 0; x < band.width; x += tW) {
            const tile = new Tile();
            tile.xpos = x;
            tile.ypos = y;
            tile.mbSize = band.mbSize;
            tile.width = Math.min(band.width - x, tW);
            tile.height = Math.min(band.height - y, tH);
            tile.isEmpty = tile.dataSize = 0;
            tile.numMBs = mbsPerTile(tile.width, tile.height, band.mbSize);
            tile.mbs = new MbInfo(tile.numMBs);
            tile.refMbs = null;
            if (p || b) {
              const ref = refTiles[refIdx];
              if (!ref || tile.numMBs !== ref.numMBs) {
                this.lastError = 'ref_tile mismatch';
                return ERR;
              }
              tile.refMbs = ref.mbs;
              refIdx++;
            }
            tiles.push(tile);
          }
        }
        band.tiles = tiles;
      }
    }
    return 0;
  }

  private prepareBuf(band: Band, i: number): Int16Array | null {
    if (this.picConf.lumaBands <= 1 && i === 2) return null;
    let b = band.bufs[i];
    if (!b) {
      b = new Int16Array(band.bufsize);
      band.bufs[i] = b;
    }
    return b;
  }

  // -- headers --------------------------------------------------------------

  private decodeGopHeader(): number {
    this.gopFlags = this.getBits(8);
    if (this.gopFlags & 1) this.getBits(16); // gop_hdr_size
    if (this.gopFlags & IVI5_IS_PROTECTED) {
      this.getBits(16);
      this.getBits(16); // lock word
    }
    const tileSize = this.gopFlags & 0x40 ? 64 << this.getBits(2) : 0;
    if (tileSize > 256) {
      this.lastError = 'Invalid tile size: ' + tileSize;
      return ERR;
    }

    const lumaBands = this.getBits(2) * 3 + 1;
    const chromaBands = this.getBits1() * 3 + 1;
    const isScalable = lumaBands !== 1 || chromaBands !== 1;
    if (isScalable && (lumaBands !== 4 || chromaBands !== 1)) {
      this.lastError = `Scalability: unsupported subdivision (luma bands ${lumaBands}, chroma bands ${chromaBands})`;
      return ERR;
    }

    const picSizeIndx = this.getBits(4);
    let picHeight: number, picWidth: number;
    if (picSizeIndx === IVI5_PIC_SIZE_ESC) {
      picHeight = this.getBits(13);
      picWidth = this.getBits(13);
    } else {
      picHeight = IVI5_COMMON_PIC_SIZES[picSizeIndx * 2 + 1] << 2;
      picWidth = IVI5_COMMON_PIC_SIZES[picSizeIndx * 2] << 2;
    }

    if (this.gopFlags & 2) {
      this.lastError = 'YV12 picture format is not supported';
      return ERR;
    }

    const picConf: PicConfig = {
      picWidth,
      picHeight,
      chromaWidth: (picWidth + 3) >> 2,
      chromaHeight: (picHeight + 3) >> 2,
      tileWidth: tileSize ? tileSize : picWidth,
      tileHeight: tileSize ? tileSize : picHeight,
      lumaBands,
      chromaBands,
    };

    let blkSizeChanged = false;
    if (picConfigDiffers(picConf, this.picConf) || this.gopInvalid) {
      if (this.initPlanes(picConf) < 0) return ERR;
      this.picConf = picConf;
      this.isScalable = isScalable;
      blkSizeChanged = true; // force reallocation of the internal structures
    }

    const planes = this.planes;
    for (let p = 0; p <= 1; p++) {
      const nb = !p ? picConf.lumaBands : picConf.chromaBands;
      for (let i = 0; i < nb; i++) {
        const band = planes[p].bands[i];

        band.isHalfpel = this.getBits1();

        let mbSize = this.getBits1();
        const blkSize = 8 >> this.getBits1();
        mbSize = blkSize << (!mbSize ? 1 : 0);

        if (p === 0 && blkSize === 4) {
          this.lastError = '4x4 luma blocks are unsupported';
          return ERR;
        }

        blkSizeChanged = mbSize !== band.mbSize || blkSize !== band.blkSize;
        if (blkSizeChanged) {
          band.mbSize = mbSize;
          band.blkSize = blkSize;
        }

        if (this.getBits1()) {
          this.lastError = 'Extended transform info is not supported';
          return ERR;
        }

        // select transform function and scan pattern according to plane and band number
        switch ((p << 2) + i) {
          case 0:
            band.transform = TR_SLANT_8X8;
            band.scan = ZIGZAG_SCAN_8X8;
            band.transformSize = 8;
            break;
          case 1:
            band.transform = TR_ROW_SLANT8;
            band.scan = VERTICAL_SCAN_8X8;
            band.transformSize = 8;
            break;
          case 2:
            band.transform = TR_COL_SLANT8;
            band.scan = HORIZONTAL_SCAN_8X8;
            band.transformSize = 8;
            break;
          case 3:
            band.transform = TR_PUT_PIXELS_8X8;
            band.scan = HORIZONTAL_SCAN_8X8;
            band.transformSize = 8;
            break;
          case 4:
            band.transform = TR_SLANT_4X4;
            band.scan = DIRECT_SCAN_4X4;
            band.transformSize = 4;
            break;
        }

        band.is2dTrans = band.transform === TR_SLANT_8X8 || band.transform === TR_SLANT_4X4 ? 1 : 0;

        if (band.transformSize !== band.blkSize) {
          this.lastError = `transform and block size mismatch (${band.transformSize} != ${band.blkSize})`;
          return ERR;
        }

        // select dequant matrix according to plane and band number
        let quantMat: number;
        if (!p) quantMat = picConf.lumaBands > 1 ? i + 1 : 0;
        else quantMat = 5;

        if (band.blkSize === 8) {
          if (quantMat >= 5) {
            this.lastError = `quant_mat ${quantMat} too large`;
            return ERR;
          }
          band.intraBase = IVI5_BASE_8X8_INTRA[quantMat];
          band.interBase = IVI5_BASE_8X8_INTER[quantMat];
          band.intraScale = IVI5_SCALE_8X8_INTRA[quantMat];
          band.interScale = IVI5_SCALE_8X8_INTER[quantMat];
        } else {
          band.intraBase = IVI5_BASE_4X4_INTRA;
          band.interBase = IVI5_BASE_4X4_INTER;
          band.intraScale = IVI5_SCALE_4X4_INTRA;
          band.interScale = IVI5_SCALE_4X4_INTER;
        }

        if (this.getBits(2)) {
          this.lastError = 'End marker missing';
          return ERR;
        }
      }
    }

    // copy chroma parameters into the 2nd chroma plane
    for (let i = 0; i < picConf.chromaBands; i++) {
      const band1 = planes[1].bands[i];
      const band2 = planes[2].bands[i];
      band2.width = band1.width;
      band2.height = band1.height;
      band2.mbSize = band1.mbSize;
      band2.blkSize = band1.blkSize;
      band2.isHalfpel = band1.isHalfpel;
      band2.intraBase = band1.intraBase;
      band2.interBase = band1.interBase;
      band2.intraScale = band1.intraScale;
      band2.interScale = band1.interScale;
      band2.scan = band1.scan;
      band2.transform = band1.transform;
      band2.is2dTrans = band1.is2dTrans;
      band2.transformSize = band1.transformSize;
    }

    // reallocate internal structures if needed
    if (blkSizeChanged) {
      if (this.initTiles(picConf.tileWidth, picConf.tileHeight) < 0) return ERR;
    }

    if (this.gopFlags & 8) {
      if (this.getBits(3)) {
        this.lastError = 'Alignment bits are not zero';
        return ERR;
      }
      if (this.getBits1()) this.skipBits(24); // skip transparency fill color
    }

    this.alignGetBits();
    this.skipBits(23); // unknown meaning

    // skip GOP extension if any
    if (this.getBits1()) {
      let i: number;
      do {
        i = this.getBits(16);
      } while (i & 0x8000);
    }

    this.alignGetBits();
    return 0;
  }

  private skipHdrExtension(): number {
    let len: number;
    do {
      len = this.getBits(8);
      if (8 * len > this.bitsTotal - this.pos) return ERR;
      this.skipBits(8 * len);
    } while (len);
    return 0;
  }

  private decodePicHdr(): number {
    if (this.getBits(5) !== 0x1f) {
      this.lastError = 'Invalid picture start code';
      return ERR;
    }

    this.prevFrameType = this.frameType;
    this.frameType = this.getBits(3);
    if (this.frameType >= 5) {
      this.lastError = 'Invalid frame type: ' + this.frameType;
      this.frameType = FRAMETYPE_INTRA;
      return ERR;
    }

    this.frameNum = this.getBits(8);

    if (this.frameType === FRAMETYPE_INTRA) {
      if (this.decodeGopHeader() < 0) {
        if (!this.lastError) this.lastError = 'Invalid GOP header';
        this.gopInvalid = 1;
        return ERR;
      }
      this.gopInvalid = 0;
    }

    if (this.frameType === FRAMETYPE_INTER_SCAL && !this.isScalable) {
      this.lastError = 'Scalable inter frame in non scalable stream';
      this.frameType = FRAMETYPE_INTER;
      return ERR;
    }

    if (this.frameType !== FRAMETYPE_NULL) {
      this.frameFlags = this.getBits(8);

      if (this.frameFlags & 1) this.getBits(24); // pic_hdr_size
      if (this.frameFlags & 0x10) this.getBits(16); // checksum

      // skip unknown extension if any
      if (this.frameFlags & 0x20) this.skipHdrExtension();

      // decode macroblock huffman codebook
      if (this.decHuffDesc(this.frameFlags & 0x40, 0, this.mbVlc) < 0) return ERR;

      this.skipBits(3); // unknown meaning
    }

    this.alignGetBits();
    return 0;
  }

  private decodeBandHdr(band: Band): number {
    const bandFlags = this.getBits(8);

    if (bandFlags & 1) {
      band.isEmpty = 1;
      return 0;
    }
    band.isEmpty = 0;

    band.dataSize = this.frameFlags & 0x80 ? this.getBits(24) : 0;

    band.inheritMv = bandFlags & 2;
    band.inheritQdelta = bandFlags & 8;
    band.qdeltaPresent = bandFlags & 4;
    if (!band.qdeltaPresent) band.inheritQdelta = 1;

    // decode rvmap probability corrections if any
    band.numCorr = 0;
    if (bandFlags & 0x10) {
      band.numCorr = this.getBits(8);
      if (band.numCorr > 61) {
        this.lastError = 'Too many corrections: ' + band.numCorr;
        return ERR;
      }
      for (let i = 0; i < band.numCorr * 2; i++) band.corr[i] = this.getBits(8);
    }

    // select appropriate rvmap table for this band
    band.rvmapSel = bandFlags & 0x40 ? this.getBits(3) : 8;

    // decode block huffman codebook
    if (this.decHuffDesc(bandFlags & 0x80, 1, band.blkVlc) < 0) return ERR;

    band.checksumPresent = this.getBits1();
    if (band.checksumPresent) band.checksum = this.getBits(16);

    band.globQuant = this.getBits(5);

    // skip unknown extension if any
    if (bandFlags & 0x20) {
      this.alignGetBits();
      this.skipHdrExtension();
    }

    this.alignGetBits();
    return 0;
  }

  // -- macroblock info ------------------------------------------------------

  private decodeMbInfo(band: Band, tile: Tile): number {
    const mbs = tile.mbs;
    const refMbs = tile.refMbs;
    const pitch = band.pitch;
    const rowOffset = band.mbSize * pitch;
    const mbVlc = this.mbVlc.tab as VlcTable;
    const isIntraFrame = this.frameType === FRAMETYPE_INTRA;
    const isLuma0 = !band.plane && !band.bandNum;
    const qdeltaInFrame = isLuma0 && (this.frameFlags & 8) !== 0;

    if (!refMbs && ((band.qdeltaPresent && band.inheritQdelta) || band.inheritMv)) {
      this.lastError = 'Missing reference macroblocks';
      return ERR;
    }

    if (tile.numMBs !== mbsPerTile(tile.width, tile.height, band.mbSize)) {
      this.lastError = 'Allocated tile size mismatches parameters';
      return ERR;
    }

    // scale factor for motion vectors
    const mvScale = (this.planes[0].bands[0].mbSize >> 3) - (band.mbSize >> 3);
    let mvX = 0;
    let mvY = 0;
    let offs = tile.ypos * pitch + tile.xpos;
    let i = 0;
    const s = band.isHalfpel;

    for (let y = tile.ypos; y < tile.ypos + tile.height; y += band.mbSize) {
      let mbOffset = offs;

      for (let x = tile.xpos; x < tile.xpos + tile.width; x += band.mbSize) {
        mbs.xpos[i] = x;
        mbs.ypos[i] = y;
        mbs.bufOffs[i] = mbOffset;

        if (this.getBits1()) {
          if (isIntraFrame) {
            this.lastError = 'Empty macroblock in an INTRA picture';
            return ERR;
          }
          mbs.type[i] = 1; // empty macroblocks are always INTER
          mbs.cbp[i] = 0; // all blocks are empty

          mbs.qDelta[i] = 0;
          if (qdeltaInFrame) {
            mbs.qDelta[i] = toSigned(this.getVlc(mbVlc));
          }

          mbs.mvX[i] = 0;
          mbs.mvY[i] = 0; // no motion vector coded
          if (band.inheritMv && refMbs) {
            // motion vector inheritance
            if (mvScale) {
              mbs.mvX[i] = scaleMv(refMbs.mvX[i], mvScale);
              mbs.mvY[i] = scaleMv(refMbs.mvY[i], mvScale);
            } else {
              mbs.mvX[i] = refMbs.mvX[i];
              mbs.mvY[i] = refMbs.mvY[i];
            }
          }
        } else {
          if (band.inheritMv && refMbs) {
            mbs.type[i] = refMbs.type[i]; // copy mb_type from corresponding reference mb
          } else if (isIntraFrame) {
            mbs.type[i] = 0; // mb_type is always INTRA for intra-frames
          } else {
            mbs.type[i] = this.getBits1();
          }

          const blksPerMb = band.mbSize !== band.blkSize ? 4 : 1;
          mbs.cbp[i] = this.getBits(blksPerMb);

          mbs.qDelta[i] = 0;
          if (band.qdeltaPresent) {
            if (band.inheritQdelta) {
              if (refMbs) mbs.qDelta[i] = refMbs.qDelta[i];
            } else if (mbs.cbp[i] || qdeltaInFrame) {
              mbs.qDelta[i] = toSigned(this.getVlc(mbVlc));
            }
          }

          if (!mbs.type[i]) {
            mbs.mvX[i] = 0;
            mbs.mvY[i] = 0; // there is no motion vector in intra-macroblocks
          } else if (band.inheritMv && refMbs) {
            // motion vector inheritance
            if (mvScale) {
              mbs.mvX[i] = scaleMv(refMbs.mvX[i], mvScale);
              mbs.mvY[i] = scaleMv(refMbs.mvY[i], mvScale);
            } else {
              mbs.mvX[i] = refMbs.mvX[i];
              mbs.mvY[i] = refMbs.mvY[i];
            }
          } else {
            // decode motion vector deltas
            mvY += toSigned(this.getVlc(mbVlc));
            mvX += toSigned(this.getVlc(mbVlc));
            mbs.mvX[i] = mvX;
            mbs.mvY[i] = mvY;
          }
        }

        if (mbs.type[i]) {
          const mx = mbs.mvX[i];
          const my = mbs.mvY[i];
          if (x + (mx >> s) + (y + (my >> s)) * pitch < 0 ||
              x + ((mx + s) >> s) + band.mbSize - 1 + (y + band.mbSize - 1 + ((my + s) >> s)) * pitch > band.bufsize - 1) {
            this.lastError = 'motion vector outside reference';
            return ERR;
          }
        }

        i++;
        mbOffset += band.mbSize;
      }

      offs += rowOffset;
    }

    this.alignGetBits();
    return 0;
  }

  // -- block decoding -------------------------------------------------------

  private decodeCodedBlock(band: Band, prevDc: number, isIntra: number, mcType: number, mvX: number, mvY: number,
                           quant: number, offs: number): number {
    // returns new prevDc, or NaN on error
    const baseTab = isIntra ? band.intraBase : band.interBase;
    const rvmap = band.rvMap as RVMap;
    const colFlags = this.colFlags;
    const trvec = this.trvec;
    const blkSize = band.blkSize;
    const numCoeffs = blkSize * blkSize;
    const colMask = blkSize - 1;
    let scanPos = -1;
    const pitch = band.pitch;
    const minSize = pitch * (band.transformSize - 1) + band.transformSize;
    const bufSize = pitch * band.aheight - offs;
    const scan = band.scan as Uint8Array;
    const vlc = band.blkVlc.tab as VlcTable;
    const eob = rvmap.eob;
    const esc = rvmap.esc;
    const runtab = rvmap.runtab;
    const valtab = rvmap.valtab;

    if (minSize > bufSize) {
      this.lastError = 'block outside buffer';
      return NaN;
    }

    trvec.fill(0, 0, numCoeffs);
    colFlags.fill(0);
    let sym = 0;
    while (scanPos <= numCoeffs) {
      sym = this.getVlc(vlc);
      if (sym === eob) break; // End of block

      let run: number;
      let val: number;
      if (sym === esc) {
        // Escape - run/val explicitly coded using 3 vlc codes
        run = this.getVlc(vlc) + 1;
        const lo = this.getVlc(vlc);
        const hi = this.getVlc(vlc);
        val = toSigned((hi << 6) | lo);
      } else {
        if (sym < 0 || sym >= 256) {
          this.lastError = 'Invalid sym encountered: ' + sym;
          return NaN;
        }
        run = runtab[sym];
        val = valtab[sym];
      }

      // de-zigzag and dequantize
      scanPos += run;
      if (scanPos >= numCoeffs || scanPos < 0) break;
      const pos = scan[scanPos];

      const q = (baseTab[pos] * quant) >> 9;
      if (q > 1) val = (val * q + (val > 0 ? 1 : -1) * (((q ^ 1) - 1) >> 1)) | 0;
      trvec[pos] = val;
      // track columns containing non-zero coeffs
      if (val) colFlags[pos & colMask] = 1;
    }

    if (scanPos < 0 || (scanPos >= numCoeffs && sym !== eob)) {
      this.lastError = 'corrupt block data';
      return NaN;
    }

    // undoing DC coeff prediction for intra-blocks
    if (isIntra && band.is2dTrans) {
      prevDc += trvec[0];
      trvec[0] = prevDc;
      if (prevDc) colFlags[0] = 1;
    }

    if (band.transformSize > blkSize) {
      this.lastError = 'Too large transform';
      return NaN;
    }

    const buf = band.buf as Int16Array;
    // apply inverse transform
    invTransform(band.transform, trvec, buf, offs, pitch, colFlags);

    // apply motion compensation
    if (!isIntra) {
      mcAdd(buf, offs, band.refBuf as Int16Array, offs + mvY * pitch + mvX, pitch, blkSize, mcType);
    }
    return prevDc;
  }

  private decodeBlocks(band: Band, tile: Tile): number {
    let prevDc = 0;
    const blkSize = band.blkSize;
    const numBlocks = band.mbSize !== blkSize ? 4 : 1;
    const mbs = tile.mbs;
    const pitch = band.pitch;
    const buf = band.buf as Int16Array;
    const refBuf = band.refBuf as Int16Array;
    const halfpel = band.isHalfpel;

    for (let mbn = 0; mbn < tile.numMBs; mbn++) {
      const isIntra = mbs.type[mbn] ? 0 : 1;
      let cbp = mbs.cbp[mbn];
      let bufOffs = mbs.bufOffs[mbn];

      let quant = band.globQuant + mbs.qDelta[mbn];
      quant = clip(quant, 0, 23);
      quant = (isIntra ? band.intraScale : band.interScale)[quant];

      let mvX = 0;
      let mvY = 0;
      let mcType = 0;
      if (!isIntra) {
        mvX = mbs.mvX[mbn];
        mvY = mbs.mvY[mbn];
        if (halfpel) {
          mcType = ((mvY & 1) << 1) | (mvX & 1);
          mvX >>= 1;
          mvY >>= 1; // convert halfpel vectors into fullpel ones
        }
        // mb->type is always 0 or 1 in Indeo 5
        const dmvX = mbs.mvX[mbn] >> halfpel;
        const dmvY = mbs.mvY[mbn] >> halfpel;
        const cx = mbs.mvX[mbn] & halfpel;
        const cy = mbs.mvY[mbn] & halfpel;
        if (mbs.xpos[mbn] + dmvX < 0 ||
            mbs.xpos[mbn] + dmvX + band.mbSize + cx > pitch ||
            mbs.ypos[mbn] + dmvY < 0 ||
            mbs.ypos[mbn] + dmvY + band.mbSize + cy > band.aheight) {
          this.lastError = 'motion vector out of bounds';
          return ERR;
        }
      }

      for (let blk = 0; blk < numBlocks; blk++) {
        // adjust block position in the buffer according to its number
        if (blk & 1) bufOffs += blkSize;
        else if (blk === 2) {
          bufOffs -= blkSize;
          bufOffs += blkSize * pitch;
        }

        if (cbp & 1) {
          // block coded
          const r = this.decodeCodedBlock(band, prevDc, isIntra, mcType, mvX, mvY, quant, bufOffs);
          if (r !== r) return ERR; // NaN -> error
          prevDc = r;
        } else {
          const bufSize = pitch * band.aheight - bufOffs;
          const minSize = (blkSize - 1) * pitch + blkSize;
          if (minSize > bufSize) {
            this.lastError = 'block outside buffer';
            return ERR;
          }
          // block not coded: intra -> dc transform, inter -> motion compensation without delta
          if (isIntra) {
            dcTransform(band.transform, prevDc, buf, bufOffs, pitch, blkSize);
          } else {
            mcPut(buf, bufOffs, refBuf, bufOffs + mvY * pitch + mvX, pitch, blkSize, mcType);
          }
        }
        cbp >>= 1;
      }
    }

    this.alignGetBits();
    return 0;
  }

  /** Handle empty tiles by performing data copying and motion compensation respectively. */
  private processEmptyTile(band: Band, tile: Tile, mvScale: number): number {
    const clearFirst = !band.qdeltaPresent && !band.plane && !band.bandNum;
    const mbSize = band.mbSize;
    const xend = tile.xpos + tile.width;
    const isHalfpel = band.isHalfpel;
    const pitch = band.pitch;
    const mbs = tile.mbs;
    const refMbs = tile.refMbs;
    const buf = band.buf as Int16Array;
    const refBuf = band.refBuf as Int16Array;

    if (tile.numMBs !== mbsPerTile(tile.width, tile.height, mbSize)) {
      this.lastError = 'Allocated tile size mismatches parameters in processEmptyTile';
      return ERR;
    }

    let offs = tile.ypos * pitch + tile.xpos;
    const rowOffset = mbSize * pitch;
    let needMc = 0;
    let i = 0;

    for (let y = tile.ypos; y < tile.ypos + tile.height; y += mbSize) {
      let mbOffset = offs;
      for (let x = tile.xpos; x < xend; x += mbSize) {
        mbs.xpos[i] = x;
        mbs.ypos[i] = y;
        mbs.bufOffs[i] = mbOffset;

        mbs.type[i] = 1; // INTER
        mbs.cbp[i] = 0; // all blocks are empty

        if (clearFirst) {
          mbs.qDelta[i] = band.globQuant;
          mbs.mvX[i] = 0;
          mbs.mvY[i] = 0;
        }

        if (refMbs) {
          if (band.inheritQdelta) mbs.qDelta[i] = refMbs.qDelta[i];

          if (band.inheritMv) {
            // motion vector inheritance
            if (mvScale) {
              mbs.mvX[i] = scaleMv(refMbs.mvX[i], mvScale);
              mbs.mvY[i] = scaleMv(refMbs.mvY[i], mvScale);
            } else {
              mbs.mvX[i] = refMbs.mvX[i];
              mbs.mvY[i] = refMbs.mvY[i];
            }
            needMc |= mbs.mvX[i] || mbs.mvY[i] ? 1 : 0; // tracking non-zero motion vectors
            const dmvX = mbs.mvX[i] >> isHalfpel;
            const dmvY = mbs.mvY[i] >> isHalfpel;
            const cx = mbs.mvX[i] & isHalfpel;
            const cy = mbs.mvY[i] & isHalfpel;
            if (mbs.xpos[i] + dmvX < 0 ||
                mbs.xpos[i] + dmvX + mbSize + cx > pitch ||
                mbs.ypos[i] + dmvY < 0 ||
                mbs.ypos[i] + dmvY + mbSize + cy > band.aheight) {
              this.lastError = 'MV out of bounds';
              return ERR;
            }
          }
        }

        i++;
        mbOffset += mbSize;
      }
      offs += rowOffset;
    }

    if (band.inheritMv && needMc) {
      // apply motion compensation if there is at least one non-zero motion vector
      const numBlocks = mbSize !== band.blkSize ? 4 : 1;
      for (let mbn = 0; mbn < tile.numMBs; mbn++) {
        let mvX = mbs.mvX[mbn];
        let mvY = mbs.mvY[mbn];
        let mcType = 0;
        if (isHalfpel) {
          mcType = ((mvY & 1) << 1) | (mvX & 1);
          mvX >>= 1;
          mvY >>= 1;
        }
        for (let blk = 0; blk < numBlocks; blk++) {
          const o = mbs.bufOffs[mbn] + band.blkSize * ((blk & 1) + (blk & 2 ? pitch : 0));
          mcPut(buf, o, refBuf, o + mvY * pitch + mvX, pitch, band.blkSize, mcType);
        }
      }
    } else {
      // copy data from the reference tile into the current one
      let src = tile.ypos * pitch + tile.xpos;
      for (let y = 0; y < tile.height; y++) {
        for (let x = 0; x < tile.width; x++) buf[src + x] = refBuf[src + x];
        src += pitch;
      }
    }
    return 0;
  }

  private decodeTileDataSize(): number {
    let len = 0;
    if (this.getBits1()) {
      len = this.getBits(8);
      if (len === 255) len = this.getBits(24);
    }
    this.alignGetBits();
    return len;
  }

  private decodeBand(band: Band): number {
    band.buf = this.prepareBuf(band, this.dstBuf);
    if (!band.buf) {
      this.lastError = 'Band buffer points to no data';
      return ERR;
    }
    band.refBuf = this.prepareBuf(band, this.refBuf);
    if (!band.refBuf) {
      this.lastError = 'No reference buffer';
      return ERR;
    }

    if (this.decodeBandHdr(band)) {
      if (!this.lastError) this.lastError = 'Error while decoding band header';
      return ERR;
    }

    if (band.isEmpty) {
      this.lastError = 'Empty band encountered';
      return ERR;
    }

    const rvmap = this.rvmapTabs[band.rvmapSel];
    band.rvMap = rvmap;

    // apply corrections to the selected rvmap table if present
    for (let i = 0; i < band.numCorr; i++) rvmap.swap(band.corr[i * 2], band.corr[i * 2 + 1]);

    let pos = this.pos;
    let result = 0;

    for (let t = 0; t < band.tiles.length; t++) {
      const tile = band.tiles[t];

      if (tile.mbSize !== band.mbSize || this.planes[0].bands[0].mbSize < band.mbSize) {
        this.lastError = 'MB sizes mismatch';
        result = ERR;
        break;
      }
      tile.isEmpty = this.getBits1();
      if (tile.isEmpty) {
        result = this.processEmptyTile(band, tile, (this.planes[0].bands[0].mbSize >> 3) - (band.mbSize >> 3));
        if (result < 0) break;
      } else {
        tile.dataSize = this.decodeTileDataSize();
        if (!tile.dataSize) {
          this.lastError = 'Tile data size is zero';
          result = ERR;
          break;
        }

        result = this.decodeMbInfo(band, tile);
        if (result < 0) break;

        result = this.decodeBlocks(band, tile);
        if (result < 0) {
          if (!this.lastError) this.lastError = 'Corrupted tile data encountered';
          break;
        }

        if (((this.pos - pos) >> 3) !== tile.dataSize) {
          this.lastError = 'Tile data_size mismatch';
          result = ERR;
          break;
        }

        pos += tile.dataSize << 3; // skip to next tile
      }
    }

    // restore the selected rvmap table by applying its corrections in reverse order
    for (let i = band.numCorr - 1; i >= 0; i--) rvmap.swap(band.corr[i * 2], band.corr[i * 2 + 1]);

    this.alignGetBits();
    return result;
  }

  private switchBuffers(): void {
    switch (this.prevFrameType) {
      case FRAMETYPE_INTRA:
      case FRAMETYPE_INTER:
        this.bufSwitch ^= 1;
        this.dstBuf = this.bufSwitch;
        this.refBuf = this.bufSwitch ^ 1;
        break;
      case FRAMETYPE_INTER_SCAL: {
        if (!this.interScal) {
          this.ref2Buf = 2;
          this.interScal = 1;
        }
        const t = this.dstBuf;
        this.dstBuf = this.ref2Buf;
        this.ref2Buf = t;
        this.refBuf = this.ref2Buf;
        break;
      }
      case FRAMETYPE_INTER_NOREF:
        break;
    }

    switch (this.frameType) {
      case FRAMETYPE_INTRA:
        this.bufSwitch = 0;
      // fallthrough
      case FRAMETYPE_INTER:
        this.interScal = 0;
        this.dstBuf = this.bufSwitch;
        this.refBuf = this.bufSwitch ^ 1;
        break;
      default:
        break;
    }
  }

  // -- public API -------------------------------------------------------------

  /**
   * Decode one IV50 frame (the payload of an AVI '00dc' chunk).
   *
   * @returns true if a new picture was produced (`y`, `u`, `v` updated);
   *          false for NULL/empty frames (the previous picture stays valid,
   *          "frame not changed") and for undecodable frames (then
   *          `lastError` is set).
   */
  decode(frame: Uint8Array): boolean {
    this.lastError = null;
    const n = frame.length;
    if (n === 0) return false; // empty packet: frame not changed

    // copy into a zero padded buffer so that the bit reader can read ahead safely
    if (this.data.length < n + 16) this.data = new Uint8Array(n + 16 + (n >> 1));
    else this.data.fill(0, n, n + 16);
    this.data.set(frame, 0);
    this.pos = 0;
    this.bitsTotal = n * 8;

    if (this.decodePicHdr() < 0) {
      if (!this.lastError) this.lastError = 'Error while decoding picture header';
      return false;
    }
    if (this.gopInvalid) {
      this.lastError = this.lastError || 'Invalid GOP';
      return false;
    }

    if (this.gopFlags & IVI5_IS_PROTECTED) {
      this.lastError = 'Password-protected clip';
      return false;
    }

    if (!this.planes[0].bands.length) {
      this.lastError = 'Color planes not initialized yet';
      return false;
    }

    this.switchBuffers();

    const nonNull = this.frameType !== FRAMETYPE_NULL;
    if (nonNull) {
      this.bufInvalid[this.dstBuf] = 1;
      for (let p = 0; p < 3; p++) {
        for (let b = 0; b < this.planes[p].bands.length; b++) {
          if (this.decodeBand(this.planes[p].bands[b]) < 0) {
            if (!this.lastError) this.lastError = `Error while decoding band ${b}, plane ${p}`;
            return false;
          }
        }
      }
      this.bufInvalid[this.dstBuf] = 0;
    } else {
      if (this.isScalable) {
        this.lastError = 'NULL frame in scalable stream';
        return false;
      }
      for (let p = 0; p < 3; p++) {
        if (!this.planes[p].bands[0].buf) {
          this.lastError = 'NULL frame without previous picture';
          return false;
        }
      }
    }
    if (this.bufInvalid[this.dstBuf]) {
      this.lastError = 'Invalid buffer';
      return false;
    }

    if (!nonNull) return false; // NULL frame: nothing new to show

    if (this.isScalable) recompose53(this.planes[0], this.y, this.strideY);
    else outputPlane(this.planes[0], this.y, this.strideY);

    // IV5 stores V before U
    outputPlane(this.planes[2], this.u, this.strideC);
    outputPlane(this.planes[1], this.v, this.strideC);
    return true;
  }

  /**
   * Convert the current picture to RGBA (alpha = 255).
   *
   * Conversion: BT.601 limited ("TV") range YCbCr -> full range RGB with
   * 16.16 fixed point coefficients (the same matrix swscale uses by default
   * for yuv410p -> rgb24):
   *   R = 1.164383 (Y-16) + 1.596027 (Cr-128)
   *   G = 1.164383 (Y-16) - 0.391762 (Cb-128) - 0.812968 (Cr-128)
   *   B = 1.164383 (Y-16) + 2.017232 (Cb-128)
   * Chroma (1/4 x 1/4 resolution) is upsampled with bilinear interpolation
   * (chroma samples centred in their 4x4 luma block); swscale's default
   * bicubic chroma scaler differs slightly, so RGB is not bit-identical to
   * ffmpeg's output (the YUV planes are).
   *
   * @param out Uint8ClampedArray / Uint8Array (R,G,B,A byte order, length >= width*height*4) or
   *            Uint32Array (length >= width*height, packed so that the bytes in memory are
   *            R,G,B,A on little-endian hosts, i.e. 0xAABBGGRR).
   */
  toRGBA(out: Uint8ClampedArray | Uint8Array | Uint32Array): void {
    const w = this.width;
    const h = this.height;
    const cw = this.chromaWidth;
    const ch = this.chromaHeight;
    if (!cw || !ch) return;
    const out32 = out instanceof Uint32Array ? out : null;
    const out8 = out instanceof Uint32Array ? null : out;

    // per-column horizontal chroma interpolation: position in 1/8 chroma pixels = 2x-3
    if (this.rgbW !== w) {
      this.rgbW = w;
      this.cx0 = new Int32Array(w);
      this.cx1 = new Int32Array(w);
      this.cwt = new Int32Array(w);
      for (let x = 0; x < w; x++) {
        const p8 = 2 * x - 3;
        const i0 = p8 >> 3;
        this.cwt[x] = p8 & 7;
        this.cx0[x] = clip(i0, 0, cw - 1);
        this.cx1[x] = clip(i0 + 1, 0, cw - 1);
      }
      this.uRow = new Int32Array(w);
      this.vRow = new Int32Array(w);
    }
    const cx0 = this.cx0, cx1 = this.cx1, cwt = this.cwt;
    const uRow = this.uRow, vRow = this.vRow;
    const Y = this.y, U = this.u, V = this.v;
    const sy = this.strideY, sc = this.strideC;
    let o = 0;

    for (let y = 0; y < h; y++) {
      // vertical chroma interpolation
      const p8 = 2 * y - 3;
      const j0 = clip(p8 >> 3, 0, ch - 1);
      const j1 = clip((p8 >> 3) + 1, 0, ch - 1);
      const wy = p8 & 7;
      const r0 = j0 * sc, r1 = j1 * sc;
      for (let x = 0; x < w; x++) {
        const a = cx0[x], b = cx1[x], wx = cwt[x];
        uRow[x] = (((U[r0 + a] * (8 - wx) + U[r0 + b] * wx) * (8 - wy)) + ((U[r1 + a] * (8 - wx) + U[r1 + b] * wx) * wy) + 32) >> 6;
        vRow[x] = (((V[r0 + a] * (8 - wx) + V[r0 + b] * wx) * (8 - wy)) + ((V[r1 + a] * (8 - wx) + V[r1 + b] * wx) * wy) + 32) >> 6;
      }
      const yo = y * sy;
      for (let x = 0; x < w; x++) {
        const c = (Y[yo + x] - 16) * 76309 + 32768;
        const cb = uRow[x] - 128;
        const cr = vRow[x] - 128;
        let r = (c + 104597 * cr) >> 16;
        let g = (c - 25675 * cb - 53279 * cr) >> 16;
        let b = (c + 132201 * cb) >> 16;
        r = r < 0 ? 0 : r > 255 ? 255 : r;
        g = g < 0 ? 0 : g > 255 ? 255 : g;
        b = b < 0 ? 0 : b > 255 ? 255 : b;
        if (out32) {
          out32[o++] = 0xff000000 | (b << 16) | (g << 8) | r;
        } else if (out8) {
          out8[o++] = r;
          out8[o++] = g;
          out8[o++] = b;
          out8[o++] = 255;
        }
      }
    }
  }

  private rgbW = -1;
  private cx0 = new Int32Array(0);
  private cx1 = new Int32Array(0);
  private cwt = new Int32Array(0);
  private uRow = new Int32Array(0);
  private vRow = new Int32Array(0);
}
