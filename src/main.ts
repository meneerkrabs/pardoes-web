import './style.css';
import { audio } from './engine/audio.ts';
import { Display } from './engine/vcl.ts';
import { aiSupported } from './engine/ai.ts';
import { addIso, ARCHIVE_PAGE, availableSource, cdFolder, GAME_TITLE, removeIso } from './library.ts';
import type { GameFiles } from './files.ts';
import { clearSave, loadSave, type SaveGame } from './game/save.ts';

const app = document.getElementById('app')!;

function showError(e: unknown) {
  console.error(e);
  const div = document.createElement('div');
  div.className = 'bdb-error';
  div.textContent = e instanceof Error ? e.message : String(e);
  div.onclick = () => div.remove();
  document.body.appendChild(div);
}
addEventListener('unhandledrejection', (e) => showError(e.reason));

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, unknown> = {}, ...kids: (Node | string)[]): HTMLElementTagNameMap[K] => {
  const n = Object.assign(document.createElement(tag), props) as HTMLElementTagNameMap[K];
  n.append(...kids);
  return n;
};

async function startScreen() {
  app.replaceChildren();
  const lib = await availableSource();
  const status = el('div', { className: 'note' });
  const progress = (label: string) => (f: number) => (status.textContent = `${label} ${Math.round(f * 100)}%`);

  const save = loadSave();
  const start = async (resume: SaveGame | null) => {
    await audio.unlock();
    if (!resume) clearSave();
    try {
      status.textContent = 'Spel laden…';
      play(await lib.open((d, t) => (status.textContent = `Spel laden… ${Math.round((100 * d) / t)}%`)), resume);
    } catch (e) { showError(e); }
  };
  const source = lib.source === 'iso' ? 'Van je eigen ISO' : lib.source === 'dev' ? 'Uit public/data (dev)' : 'Van archive.org';
  const buttons = save
    ? [
      el('button', { textContent: 'Verder spelen', title: `${save.name ? save.name + ', ' : ''}opgeslagen ${new Date(save.time).toLocaleString('nl-NL')}`, onclick: () => start(save) }),
      el('button', { textContent: 'Nieuw spel', title: source, onclick: () => start(null) }),
    ]
    : [el('button', { textContent: 'Spelen', title: source, onclick: () => start(null) })];

  const isoInput = el('input', { type: 'file', accept: '.iso,.ISO', hidden: true });
  isoInput.onchange = async () => {
    for (const f of isoInput.files ?? []) {
      try { await addIso(f, progress(f.name)); } catch (e) { showError(e); }
    }
    startScreen();
  };
  const dirInput = el('input', { type: 'file', hidden: true });
  dirInput.webkitdirectory = true;
  dirInput.onchange = async () => {
    try {
      const files = await cdFolder([...(dirInput.files ?? [])].map((f) => [f.webkitRelativePath, f] as [string, Blob]), (d, t) => (status.textContent = `Spel laden… ${Math.round((100 * d) / t)}%`));
      await audio.unlock();
      play(files);
    } catch (e) { showError(e); }
  };

  const look = el('select', { onchange: () => localStorage.setItem('bdb-display', look.value) },
    el('option', { value: 'smooth', textContent: 'Glad (korrel weggefilterd)' }),
    el('option', { value: 'original', textContent: 'Origineel (scherpe pixels)' }),
    el('option', { value: 'ai', textContent: aiSupported() ? 'AI-scherp (extra scherpte via AI, experimenteel)' : 'AI-scherp (vereist WebGPU)', disabled: !aiSupported() }));
  look.value = Display.savedMode();

  const screen = el('div', { className: 'bdb-start' },
    el('h1', { textContent: GAME_TITLE }),
    el('div', { className: 'books' }, ...buttons),
    el('label', { className: 'note' }, 'Beeld: ', look),
    status,
    el('div', { className: 'note', innerHTML: `De spelbestanden worden geladen uit de ISO op <a href="${ARCHIVE_PAGE}" target="_blank" rel="noopener" style="color:#e8c872">archive.org</a> (de eerste keer ongeveer 220 MB, daarna staan ze in je browser). Spelen met de muis. Je voortgang wordt in de browser bewaard.` }),
    el('details', { className: 'note' },
      el('summary', { textContent: 'Eigen cd of ISO gebruiken' }),
      el('div', { className: 'books' },
        el('button', { textContent: 'ISO-bestand kiezen…', onclick: () => isoInput.click() }),
        el('button', { textContent: 'cd-map kiezen…', onclick: () => dirInput.click() }),
        ...(lib.source === 'iso' ? [el('button', { textContent: 'Eigen ISO verwijderen', onclick: async () => { await removeIso(); startScreen(); } })] : [])),
      'Je kunt een ISO ook hierheen slepen.'),
    isoInput, dirInput,
  );
  screen.ondragover = (e) => e.preventDefault();
  screen.ondrop = async (e) => {
    e.preventDefault();
    for (const f of e.dataTransfer?.files ?? []) {
      try { await addIso(f, progress(f.name)); } catch (err) { showError(err); }
    }
    startScreen();
  };
  app.appendChild(screen);
}

async function play(files: GameFiles, resume: SaveGame | null = null) {
  app.replaceChildren();
  const host = el('div');
  app.appendChild(host);
  const display = new Display(host);
  const { startGame } = await import('./game/index.ts');
  await startGame(display, files, () => {
    display.root.remove();
    startScreen();
  }, resume);
}

async function boot() {
  // ?play=1 starts at once (click once for sound); ?section=NAME jumps into a script section (dev)
  const params = new URLSearchParams(location.search);
  if (params.has('play') || params.has('section')) {
    addEventListener('pointerdown', () => audio.unlock(), { once: true });
    return play(await (await availableSource()).open());
  }
  return startScreen();
}

boot().catch(showError);
