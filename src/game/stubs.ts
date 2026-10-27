// Temporary no-op handlers for statements whose modules are still being written (sprites, DXSCREEN, printing).
// They keep the script running: nothing blocks, nothing is drawn.

import type { Gfx } from '../gfx/gfx.ts';

export function installStubs(g: Gfx) {
  const vm = g.vm;
  const warned = new Set<string>();
  const stub = (what: string) => () => {
    if (!warned.has(what)) { warned.add(what); console.info(`(nog niet gebouwd: ${what})`); }
  };
  if (!g.sprites) {
    vm.on('SPRITE', stub('Sprite'));
    vm.instr.set('SPRITE', stub('Instruction SPRITE'));
  }
  vm.on('DXSCREEN', stub('DXSCREEN'));
  vm.instr.set('DX', stub('Instruction DX'));
  vm.instr.set('PRINT', stub('Instruction PRINT'));
  vm.instr.set('TEKST', stub('Instruction TEKST'));
}
