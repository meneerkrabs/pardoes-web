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

Lose/failure paths are in the "Lose paths" section below. Not covered: real audio, layouts other than 640x480.

Run: `tools/qa/run.sh <phase>.mjs ''` in order (each phase boots from the previous phase's save; `?noprint=1` for `pG`).

## Lose paths

Scripts: `tools/qa/lose-*.mjs` (run with `tools/qa/run.sh lose-<name>.mjs ''`; each boots from a save written by the phase scripts, so run `p0` .. `pF` first). Line numbers refer to `PLAYER.SCR`. All of them passed in the headless run; screenshots were looked at (`/tmp/pd-qa/lose-*.png`).

| Path | Script | Expected (PLAYER.SCR) | Observed | Result |
|---|---|---|---|---|
| Cannibals: 5 wrong pots | `lose-cannibal` | 5th wrong douse sets `$MC1_FAILED` (L17596-17597) and the same click runs `PARDOES #EINDE` (L17643): GAMEOVER.AVI, `INIT #CREATEGAME`, Sterrenkamer | errors 1..5 counted, the 5th click played the movie and ended in the Sterrenkamer with bag, rings and helper empty; mirror pick-up, KPREIS and CANIBAL1 (pots clickable) work again | pass |
| Memory game lost | `lose-python` | 3 mistakes (`$PY1_TRYCNT`=0) run `#GAMEOVER` (L9338-9358): back to KPRUIG, puzzle restarts on the next visit | 3 wrong answers: back in KPRUIG, `$PY1_FINISHED` still 0; second visit restarts with 3 tries, 3 right answers lead to PYTHON2 | pass |
| Piranha ride: sinking | `lose-ride` | 4th bite (`$PI2_MAXBITES`=4) runs `#SINK` (L13951-13969), `#FROMPIW` resets `$PI1_FINISHED` (L13547-13550) | chasing the fish: 4 bites, back in PIRANHA1, boat deflated, pump and paddle still in the bag; pump, paddle and a second ride (dodging) reached PIRANHA3 | pass |
| Tuffer: pit | `lose-tuffer` | `OT2_PUT` collision: `LOOSEPUT` -> DEPUT (L10501-10507, L10558) | car and Pardoes end in a well (DEPUT1/2); `dx.active`, scene hook and `dirtyOff` are released, no car sprite left, normal composition; the way out led back to OLDTIMER1 | pass |
| Tuffer: fuel out | `lose-tuffer` | `$OT2_TIJD` 0 after 30 s: `LOOSE` -> OLDTIMER1 (L10381, L10551) | after 28 s back in OLDTIMER1 with a clean scene; the car keeps running, retry works | pass |
| Tuffer: hedgehog | `lose-tuffer` | `OT2EGEL` collision: `LOOSE` (L10485) | dived into the bottom lane at scroll x about 2716: LOOSE, OLDTIMER1, clean scene | pass |
| Tuffer: retry | `lose-tuffer` | `WIN` -> OLDTIMER3 (L10544) | the autopilot (pixel-mask path plan) won after the three losses | pass |
| Wells | `lose-wells` | DEPUT picks DEPUT1/2 on `$PUTNR` (L8189-8194); way out `CMDDPnWORLD` -> `SUBRANDOM 7` (L8531-8562) | 12 trips chained: in through the trapdoor, VOCSCHIP1, SPOOKSLOT1, FATAMORGANA1, VEERMAN1 and DOOLHOF1 well exits; DEPUT1 and DEPUT2 alternate; destinations seen: STERRENKAMER, SPOOKSLOT1, VOCSCHIP1, FATAMORGANA1, VEERMAN1, DOOLHOF1 and the other well; no stuck state | pass |
| Troll king arrows | `lose-troll` | 1st wrong arrow: code shown, restart; `$TK1_MAXERR`=2: 2nd wrong arrow `#FOUT` -> DEPUT (L19851, L19977-19990) | 1st error: still in TROLLENKONING1 (`$TK1_ERRCNT`=1); 2nd: Pardoes falls into the well; way back to TROLLENKONING1: counter 0, the code solved (`$TK1_FINISHED`) | pass |
| Boat sinking / race loss | - | not separate from the ride and the Tuffer game | covered by the ride and Tuffer rows | - |
| Magnifying glass | `lose-glass` | sprite `SK1VERGROOTGLAS` (L5146-5160) picks the glass up onto the mouse; dropping it on `CMDSK1_LEESFAX` opens the fax (L6521-6545) | the sprite is visible on the table (frame `VWK_VGLAS`, `Dib=SK1_VGLAS1`, loaded as `sk1_vgg1.bmp` at L4748, 462 opaque pixels); picking it up, reading the fax and closing it work. The plan's suspicion (picture never loaded) was wrong | pass |

Notes:
- The wrong-pot count in the cannibals game is 5 and the game over comes on the 5th wrong click itself (not on a 6th).
- After a pit the way out of the well is random (7 destinations), so `lose-tuffer` uses the navigator in `tools/qa/lib.mjs` (`navTo`) to get back to OLDTIMER1.
- Test state writes: only `$RATTAR_APPEARS=9999` after each boot (and the save chain); no other variable is set.
