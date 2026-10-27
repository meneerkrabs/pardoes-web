# Headless playthrough (QA)

The whole game was played headlessly with real clicks/keys/drags (`tools/qa/`, muted Chromium via `tools/browse.mjs`), from the
intro to the diploma and the exit, following the critical path in [playthrough-plan.md](playthrough-plan.md). Phases are chained through
the real "Verder spelen" restore (save files in /tmp). The only state writes: `$RATTAR_APPEARS=9999` on the main path (Rattar off) and
`$RATTAR_APPEAR(S)=5` in the Rattar test; everything else is read through the debug handle `__pd`.

| phase | script | covers | result |
|---|---|---|---|
| 0 | `p0` | intro movies, name entry, the hand, arrival in the Sterrenkamer | pass |
| A | `pA` | mirror and helper, trunk walk, pump the boat, FATAMORGANA1/2 (ring 8), word puzzle, piranha ride (steering bot), PIRANHA3 crank | pass |
| B | `pB` | VILLAVOLTA1/2 (door, sliding puzzle by BFS, pot, fire, ring 5), flower melody | pass |
| C | `pC` | memory game (ring 2), crank, Tuffer drive, map, planks, ship chain (ring 6, matches, stone) | pass |
| D | `pD` | four stones, torch, tile field + ghosts (ring 1) | pass |
| E | `pE` | dragon (helper + stone, ring 4), banana | pass |
| F | `pF` | monkey, jigsaw (bucket), five pots (ring 3), gate + map, maze, buttons (ring 7) | pass |
| G | `pG` | ring panel, final choice, diploma, print page, credits, exit to the start screen | pass |
| lose | `pG` `QA_LOSE=1`, `pD` `QA_DIE=1` | wrong final choice / ghost: GAMEOVER.AVI and a full reset | pass |
| R | `pR` | Rattar theft and defence with the twinkel | pass |

Bugs found and fixed (all in the port, none in the data):
1. "Verder spelen": variables were restored after the start room was built (stranded entrance thread, protection command stuck;
   Sterrenkamer -> Sterrenkamer has no entrance). Now restored between `[INIT] #CREATEGAME` and the start room, entering as from a realm.
2. `Move=` resolving to an empty name must keep the current move (FUN_004452c3); Pardoes' walk series hung on the later legs.
3. The word puzzle's base file (`VM1_L`) is only a prefix: the base bitmap has no image of its own.
4. `Instruction OBJECT Value=DISABLE`: only PARDOES/RATTAR/CMDSCREEN/INVTFLES stay hittable (was inverted).

Not covered: the wells (DEPUT), the cannibal 5-errors game over, losing the memory game, sinking on the piranha ride, the Tuffer
LOOSE/LOOSEPUT variants, the troll king's arrows, the magnifying glass, real audio, layouts other than 640x480.

Run: `tools/qa/run.sh <phase>.mjs ''` in order (each phase boots from the previous phase's save; `?noprint=1` for `pG`).
