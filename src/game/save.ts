// Progress saving (not in the original, which keeps everything in memory). The script is variable-driven: every screen
// rebuilds itself in #CREATE from variables (inventory $INVENT1..4, rings, $..._FINISHED flags, the random puzzle
// variants), so a save is the variable table plus the current screen. It is written to localStorage a few seconds after
// each screen change and when the page is hidden. Resuming runs the normal game setup ([INIT] #CONTINUE, without the
// intro), puts the variables back and changes to the saved screen like the game does ($NEXTSCREEN + [SYSTEM] #DONEXTSCREEN).

import type { Vm } from '../script/vm.ts';

const KEY = 'pardoes-save-v1';

/** Screens that are not a place to come back to (cut scenes, the end, game over). */
const NO_RESUME = new Set(['', 'LEEG', 'INTRO', 'EINDSPEL1', 'EINDSPEL2', 'PARDOESEINDE', 'CMDEXITTITEL', 'AFTITELING']);
/** Screen bookkeeping that the screen change itself sets. */
const SKIP_VARS = new Set(['$CURRENTSCREEN', '$PREVIOUSSCREEN', '$NEXTSCREEN']);

export interface SaveGame { screen: string; name: string; time: number; vars: Record<string, string> }

export function loadSave(): SaveGame | null {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? 'null') as SaveGame | null;
    return s && s.screen && !NO_RESUME.has(s.screen) ? s : null;
  } catch {
    return null;
  }
}

export function clearSave() {
  try { localStorage.removeItem(KEY); } catch { /* private mode */ }
}

/** Watch the current screen and save after each change. Returns a stop function. */
export function autosave(vm: Vm): () => void {
  let last = '', since = 0;
  const save = () => {
    const screen = vm.vars.get('$CURRENTSCREEN') ?? '';
    if (NO_RESUME.has(screen)) return;
    const data: SaveGame = { screen, name: vm.vars.get('$SPELERNAAM') ?? '', time: Date.now(), vars: vm.vars.snapshot() };
    try { localStorage.setItem(KEY, JSON.stringify(data)); } catch { /* quota / private mode */ }
  };
  const t = setInterval(() => {
    const screen = vm.vars.get('$CURRENTSCREEN') ?? '';
    if (screen !== last) { last = screen; since = Date.now(); return; }
    // settled on a screen for 3 s: the #CREATE chain and the entrance are done
    if (since && Date.now() - since > 3000) { since = 0; save(); }
  }, 500);
  const onHide = () => { if (document.visibilityState === 'hidden') save(); };
  document.addEventListener('visibilitychange', onHide);
  addEventListener('pagehide', save);
  return () => { clearInterval(t); document.removeEventListener('visibilitychange', onHide); removeEventListener('pagehide', save); };
}

/** After the game setup: restore the variables and go to the saved screen. */
export function restore(vm: Vm, s: SaveGame) {
  for (const [k, v] of Object.entries(s.vars)) if (!SKIP_VARS.has(k)) vm.vars.setLiteral(k, v);
  // always a real screen change (also back into the same screen): #CREATE rebuilds it from the restored variables
  vm.vars.setLiteral('$NEXTSCREEN', s.screen);
  vm.runNew('SYSTEM', 'DONEXTSCREEN', '');
  vm.pump();
}
