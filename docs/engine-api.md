# Engine API (for module authors)

The game is `PLAYER.SCR` run by a port of PARDOES.EXE's script interpreter. Behaviour is specified in `docs/re/`
(`script-core.md`, `graphics.md`, `spr-format.md`); this file only describes how the TypeScript modules fit together.

## Files

| file | what |
|---|---|
| `src/engine/dat.ts` | `DatArchive`: the whole PARDOES.DAT in memory; `get(name, ext?)` returns a view (sync), `text(name)`, `has()` |
| `src/script/parse.ts` | parser: `Stmt` (`kw`, `kv` pairs upper-cased, `get(key)` last wins, `all(key)`, `nums(key)`), `Program`, `findSeq` |
| `src/script/vars.ts` | `Vars`: `get(name)`, `sub(tok)` (whole-token substitution), `expand(v)` (Set-value expansion), `assign(name, v)` (operator semantics), `setLiteral` |
| `src/script/vm.ts` | `Vm`: threads/scheduler, `on(KEYWORD, handler)`, `instr.set(TYPE, handler)` for `Instruction Type=X`, `runNew(item, section, seq)` (an engine event = new thread; -1 if the section does not exist), `event(item, section)` (= runNew + pump), `resume(threadId)`, `killThread(threadId)` (terminate without notifying: a CHANGE takes over a sprite another thread waits on), `pump()`, timers (`timerStatic/Kill/Enable`, `tickTimers`), `onClock(name)` for timers without a script target (sprite clocks) |
| `src/script/sound.ts` | `Sound`: 100 named slots: `load(name, file, flags)`, `play(name, vol, loop)`, `stop`, `isPlaying`, `setVolume`, `modVolume`, `setPan`, `slot(name)?.flags` (`SFX_CANINTERRUPT`, `SFX_PLAYONEATATIME`); volumes/pan in DirectSound hundredths of dB |
| `src/gfx/scene.ts` | `Scene`: node lists (DX set + BG sets, levels 0..9 + FG), `add(node, 'tail'|'head'|'beforeCommands')`, `remove`, `toFront/toBack`, `invalidate(rect|null)` (dirty rects), `compose()`, `order()` (hit-test order), `world` (darkness %), `onFrame` |
| `src/gfx/image.ts` | `Img` (per-file palette, indices, `px` 0x00BBGGRR, `darken(pct, maskIndex)`, `opaqueAt`, `opaqueRgb`, `clone`), `blitIndexed` (BG path, index key + ColFX), `blitKeyed` (DX path, RGB key), `blitPart`, `parseRgb` |
| `src/gfx/gfx.ts` | `Gfx` context: `scene`, `vm`, `dat`, `snd`, `bitmaps` (name -> `Bm`, POPUP included), `bitmap(name)` (with `$VAR`), `loadImg(file)`, `mouseX/Y`, `holding`, `sprites: SpriteHooks` |
| `src/gfx/bitmaps.ts` | `Bitmap` statement, `Instruction BITMAP/OBJECT`, puzzles |
| `src/gfx/commands.ts` | `Command` statement, `Instruction COMMAND`, hit test, mouse/key events, cursor; `onDirectional(cmd)` hook |
| `src/gfx/sprites.ts` | `Sprites`: the `Sprite` statement, `Instruction Type=SPRITE`, sprite clocks (`tick(clock)`), animation / motion / AtEnd chaining, frame sounds, overlay + spawned children, drawing, hit test / press / cursor, the held item (`Type=MOUSE`), `walkTo`; implements `SpriteHooks` |
| `src/gfx/sprites/` | `spr.ts` (.SPR templates, cached per file), `stmt.ts` (`Sprite` statement parse, flag constants), `sprite.ts` (`Sprite` runtime object, `MoveRt`), `draw.ts` (scaled / keyed / sheared / dissolve blit), `group.ts` (`Name=GROUP`: stone puzzles, maze, DIRECTIONAL walking) |
| `src/gfx/media.ts` | `Movie`, `Style`, `Tekst`, `EditBox` |
| `src/game/index.ts` | wiring, main loop, timers, input |
| `src/game/stubs.ts` | no-op handlers for statements whose module is not written yet (DXSCREEN, `Instruction DX/PRINT/TEKST`) |

## Conventions

- A statement handler returns `'cont'` (default), `'retry'` (blocked; the same statement runs again when the thread is
  resumed with `vm.resume(t.id)`) or `'block'` (done, but the thread waits for a resume).
- Engine events: `vm.runNew(item, section, '')` then `vm.pump()` (or `vm.event`). Never run script code inline.
- Drawing: a node's `drawBG(back, clip)` draws its part inside `clip` into the back buffer (BG lists); `drawDX(work)`
  draws the whole object onto the work surface (DX list, `EXTRA=DXBLIT`). Anything that changes pixels calls
  `scene.invalidate(rect)` for the old and the new rect.
- Coordinates are 640x480 game pixels. Colours are `0x00BBGGRR`.
- Debug handle in dev / with `?debug=1`: `globalThis.__pd = { vm, g, cmds, media, bitmaps, snd, prog }`.
- Dev start: `?play=1&mute=1` (intro), `?play=1&mute=1&section=ITEM/SECTION` runs `[INIT]` and then `[ITEM] #SECTION`.

## Sprites (`g.sprites`, class `Sprites` in `src/gfx/sprites.ts`)

Spec: `graphics.md` Part B (+ D1 for GROUP), `spr-format.md`. Created after `Commands` in `src/game/index.ts`; it registers
`Sprite` / `Instruction Type=SPRITE`, sets `cmds.onDirectional` and is `g.sprites` (the `SpriteHooks` of the hit test / cursor / held item).

- **Clocks**: `vm.onClock(name)` -> `sprites.tick(name)` ticks every active, enabled, visible sprite whose `timer` equals `name`; `DX` is
  ticked once per composed frame (`scene.onFrame`) and a small interval keeps frames coming while a `DX`-timer sprite exists. A sprite
  is created with one immediate tick (the original's WM_USER+101) unless it is `Type=MOVING` without `Start=` or `Type=MOUSE`.
- **Blocking**: `Sprite Type=WAIT` returns `'retry'`; the sprite engine calls `vm.resume(sprite.thread)` when the move finishes / a
  BREAKWAIT move is entered / the sprite is hidden, killed or leaves the screen (the statement re-checks, like the original).
- **Scene nodes**: one `NODE_SPRITE` node per sprite (`node.owner` is the `Sprite`), `DXBLIT` sprites in the DX set (plain colour-keyed
  blit, no ColFX/Special), the others in the BG set (palette-index key, ColFX, Special shear). `node.rect` is the bounding rect of hit
  rect and drawn rect (the exact hit test is `sprites.hit`). The carried `Type=MOUSE` sprite has no node: `drawHeld`.
- **Events fired**: `[<sprite>] #CLICK` or `#<trigger name>` (COMMAND sprites), `#COLIDE`, `[<GROUP prefix>] #ENTER`, `[DH2_<tile>] #CREATE`.

Lookup API for other modules (DXSCREEN etc.):

| member | what |
|---|---|
| `sprites.find(name): Sprite \| null` | active sprite by name (`$VAR` names are resolved; case: names are upper-case) |
| `sprites.all(): Sprite[]` | every active sprite (slot order) |
| `Sprite.x, y, w, h` | top-left of the sprite (frame `Shift` not included) and size of the current frame; `right`, `bottom` getters |
| `Sprite.visible, enabled, level, type, f1, f2` | state / flags (`F1_*`, `F2_*`, `T_*` in `sprites/stmt.ts`) |
| `Sprite.node` | the scene node (`null` for the carried item); `Sprite.frame` = current `Frame` (`bmp.shift`, `bmp.center`, `bmp.dib`) |
| `sprites.frameBm(s): Bm \| null` | the script bitmap (`img`, `maskIndex`, `key`) of the current frame, e.g. to draw or to test pixels yourself |
| `sprites.setPos(s, x, y)` | move (like `Start=`), repaints old and new rect |
| `sprites.walkTo(name, x, y)` | displace the sprite so its feet (x + frame centre, bottom) land on (x, y) (click-to-move, FUN_0044c140) |
| `sprites.switchMove(s, name)` | change the move (`HIDE` / `KILL` / `RANDOMxN` / `$VAR` specials included) |
| `sprites.destroy(s)` | kill a sprite (children, sound, node) |
| `sprites.postEvent(item, section)` | `vm.runNew(item, section)` (the caller pumps) |
