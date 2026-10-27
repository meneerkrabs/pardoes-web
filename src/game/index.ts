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
import { Sprites } from '../gfx/sprites.ts';
import { Media } from '../gfx/media.ts';
import { autosave, restoreScreen, restoreVars, type SaveGame } from './save.ts';
import { DxScreen } from '../gfx/dxscreen.ts';

export async function startGame(display: Display, files: GameFiles, onQuit: () => void, resume: SaveGame | null = null): Promise<void> {
  const prog = parseScript(files.dat.text('PLAYER.SCR'));
  const vm = new Vm(prog);
  const snd = new Sound(files);
  installSound(vm, snd);
  const g = new Gfx(vm, files.dat, snd);
  const bitmaps = new Bitmaps(g);
  const cmds = new Commands(g, bitmaps);
  g.sprites = new Sprites(g, cmds);
  const media = new Media(g, files, display, cmds);
  const dx = new DxScreen(g);
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
    stopSave();
    clearInterval(timer);
    snd.stopAll();
    form.close();
    onQuit();
  };

  if (import.meta.env.DEV || new URLSearchParams(location.search).has('debug')) {
    (globalThis as { __pd?: unknown }).__pd = { vm, g, cmds, media, bitmaps, snd, prog, dx };
  }

  // first WM_PAINT: RUN [INIT] (unnamed section). Dev/test shortcuts:
  //   ?skipintro=1      skip the intro and the name screen: [INIT] without its RUN INTRO, then [INIT] #CONTINUE (the hand)
  //   ?vars=$A=1,$B=x   preset variables after [INIT] (literal values)
  //   ?screen=NAME      then change to that screen like the game does ($NEXTSCREEN + [SYSTEM] #DONEXTSCREEN)
  //   ?section=ITEM/SEC then run that section (after the above)
  const q = new URLSearchParams(location.search);
  const skip = !!resume || q.has('skipintro') || q.has('screen') || q.has('section');
  if (skip) {
    const run = vm.instr.get('RUN')!;
    // no intro; on resume the saved variables go in between the new-game reset and the creation of the start room
    vm.instr.set('RUN', (st, t, m) => {
      const name = st.get('NAME');
      if (name === 'INTRO') return 'cont';
      if (resume && name === 'PROGRAM' && st.get('TARGET') === 'CONTINUE') restoreVars(vm, resume);
      return run(st, t, m);
    });
    vm.runNew('INIT', '', '');
    vm.pump();
    for (const kv of (q.get('vars') ?? '').split(',').filter(Boolean)) {
      const k = kv.slice(0, kv.indexOf('=')).toUpperCase(), v = kv.slice(kv.indexOf('=') + 1);
      if (!vm.vars.setLiteral(k, v)) console.warn('onbekende variabele', k);
    }
    vm.runNew('INIT', 'CONTINUE', '');
    vm.pump();
    vm.instr.set('RUN', run);
    if (resume) restoreScreen(vm, resume);
    const screen = q.get('screen')?.toUpperCase();
    if (screen) {
      // after the start room is up: change screens the game's way
      setTimeout(() => {
        vm.vars.setLiteral('$NEXTSCREEN', screen);
        vm.runNew('SYSTEM', 'DONEXTSCREEN', '');
        vm.pump();
      }, 1500);
    }
    const section = q.get('section');
    if (section) {
      const [item, sec] = section.toUpperCase().split('/');
      setTimeout(() => { vm.runNew(item, sec ?? 'CREATE', ''); vm.pump(); }, screen ? 3000 : 1500);
    }
  } else vm.runNew('INIT', '', '');
  const stopSave = autosave(vm);
  vm.pump();
}
