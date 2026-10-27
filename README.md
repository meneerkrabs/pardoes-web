# Een Wonderlijk Avontuur met Pardoes de Tovernar in de browser

Een web-port van het Efteling-avonturenspel *Een Wonderlijk Avontuur met Pardoes de Tovernar* (2000).

Het originele `PARDOES.EXE` (C++, DirectDraw/DirectSound) is een interpreter voor één groot scriptbestand (`PLAYER.SCR`) met
sprites, klikgebieden en geluiden uit `PARDOES.DAT`. Die interpreter wordt hier in TypeScript nagebouwd op basis van de
reverse-engineering in [docs/re/](docs/re/); de Indeo 5-films worden met een eigen decoder in de browser afgespeeld.

**Er zitten geen spelbestanden in deze repo.** De app laadt de bestanden rechtstreeks uit de ISO op
[archive.org](https://archive.org/details/een-wonderlijk-avontuur-met-pardoes-de-tovernar) (of uit je eigen ISO/CD) en bewaart
ze in de browser.

Status: in ontwikkeling.

## Ontwikkelen

```bash
npm install
npm run dev
```

Voor snelle lokale tests: zet `PARDOES.DAT` en de map `MEDIA` van de CD in `public/data/pardoes/` (genegeerd door git).
Headless tests: `node tools/browse.mjs <url> [steps.mjs]`.

## Credits

- AI-opschaling: Real-ESRGAN `realesr-general-x4v3` (BSD-3-Clause) via onnxruntime-web.
