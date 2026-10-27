// The game: PLAYER.SCR run by the script machine, with the graphics/sound modules attached, a 640x480 form as the
// screen, timers, and mouse/keyboard input routed like PARDOES.EXE's WndProc.

import { Form, type Display } from '../engine/vcl.ts';
import type { GameFiles } from '../files.ts';
import { parseScript } from '../script/parse.ts';
import { Vm } from '../script/vm.ts';
import { Sound, installSound } from '../script/sound.ts';
import { Gfx } from '../gfx/gfx.ts';
import { Bitmaps } from '../gfx/bitmaps.ts';
import { Commands } from '../gfx/commands.ts';
import { Media } from '../gfx/media.ts';
import { installStubs } from './stubs.ts';

export async function startGame(display: Display, files: GameFiles, onQuit: () => void): Promise<void> {
  const prog = parseScript(files.dat.text('PLAYER.SCR'));
  const vm = new Vm(prog);
  const snd = new Sound(files);
  installSound(vm, snd);
  const g = new Gfx(vm, files.dat, snd);
  const bitmaps = new Bitmaps(g);
  const cmds = new Commands(g, bitmaps);
  const media = new Media(g, files, display, cmds);
  installStubs(g);
  vm.onClock = (name) => g.sprites?.tick(name);
  g.scene.onFrame = () => g.sprites?.tick('DX');

  // ---- screen
  const form = new Form(display);
  form.cursor = 'none';
  let quit = false;
  form.onPaint = () => {
    if (media.playing) form.surface.px.set(media.movieSurface.px);
    else form.surface.px.set(g.scene.compose().px);
  };
  const frame = () => {
    if (quit) return;
    if (media.playing || g.scene.changed) form.invalidate();
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  form.show();

  // ---- timers (WM_TIMER: coalesced, no catch-up)
  const timer = setInterval(() => vm.tickTimers(), 4);

  // ---- input
  form.onMouseDown = (button, shift, x, y) => { if (button === 'left') cmds.mouseDown(x, y, shift.ctrl && shift.shift); };
  form.onMouseUp = (button, shift, x, y) => { if (button === 'left') cmds.mouseUp(x, y, shift.ctrl && shift.shift); };
  form.onMouseMove = (_shift, x, y) => cmds.mouseMove(x, y);
  form.onKeyDown = (key) => cmds.keyDown(key);

  vm.quit = () => {
    quit = true;
    clearInterval(timer);
    snd.stopAll();
    form.close();
    onQuit();
  };

  if (import.meta.env.DEV || new URLSearchParams(location.search).has('debug')) {
    (globalThis as { __pd?: unknown }).__pd = { vm, g, cmds, media, bitmaps, snd, prog };
  }

  // first WM_PAINT: RUN [INIT] (unnamed section)
  const section = new URLSearchParams(location.search).get('section');
  if (section) {
    const [item, sec] = section.toUpperCase().split('/');
    vm.runNew('INIT', '', ''); // declarations + cursors, then jump
    vm.pump();
    vm.runNew(item, sec ?? 'CREATE', '');
  } else vm.runNew('INIT', '', '');
  vm.pump();
}
