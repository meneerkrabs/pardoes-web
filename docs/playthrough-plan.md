# Een Wonderlijk Avontuur met Pardoes de Tovernar: playthrough and test plan

Source: `PLAYER.SCR` from the extracted game data (`/Users/sander/Documents/pardoes-extract/dat/PLAYER.SCR`, 22,702 lines).
Language references: `pardoes-web/docs/re/script-core.md` (control flow, variables) and `pardoes-web-work/docs/re/graphics.md` (Commands, sprites, puzzle bitmaps, DX screen, maps).
This is a read-only analysis of the script. Nothing in the game or the port was changed. Engine behaviour that is not visible in the script (puzzle bitmaps, tile fields, the DX car game, maze maps) is taken from graphics.md and marked as such.

## Summary

- **43 screen items** set `$CURRENTSCREEN`:
  - the hub STERRENKAMER;
  - 4 realm map hubs (KPRUIG, KPANDER, KPREIS, KPMARE);
  - 33 realm screens, counting PIRANHA2 and PIRANHA2A..E as 6 ride segments;
  - 2 wells (DEPUT1/2);
  - EINDSPEL1/2 and PARDOESEINDE.

  On top of these: INTRO, the credits/exit screen CMDEXITTITEL, the unreachable developer menu TEST, and the 24-cell first-person maze inside DOOLHOF2.
- **Goal:** find the **8 magic rings** (`$KRING1..8`), two per realm, and put them into the ring panel in the Sterrenkamer. That leads to the final picture choice (EINDSPEL1, `ENDPRE.AVI`) and then the diploma (EINDSPEL2, `ENDPOST.AVI`, print) and the program exit.
- **17 puzzles and minigames.** There are also about 20 item locks.

  | Realm / place | Puzzles and minigames |
  |---|---|
  | Ruigrijk | PYTHON1 memory game, OLDTIMER2 "Tuffer" driving game, VOCSCHIP1 planks |
  | Anderrijk | VEERMAN1 word puzzle, PIRANHA1 tree-trunk path, PIRANHA2 piranha boat ride, SPOOKSLOT1 stones, SPOOKSLOT3 tile field plus ghosts |
  | Reizenrijk | CARNAVAL2 jigsaw, CANIBAL1 pots, DOOLHOF2 maze, DOOLHOF3 buttons |
  | Marerijk | TROLLENKONING1 arrow code (optional), ELFJES2 flower melody, VILLAVOLTA2 sliding puzzle |
  | Sterrenkamer | ring panel, EINDSPEL1 final choice |

- **Items:** 13 bag items, the magnifying glass (a direct-use item), the twinkel flask, and 4 helper figures (one per realm). The item chains cross realms, so every realm has to be visited more than once.
- **Critical path:** the bot plan in section 5 has **8 phases and 76 numbered bot steps**, roughly 250 to 300 raw clicks. It has two real-time sections (OLDTIMER2 driving, PIRANHA2 ride) and one timing-dependent section (the SPOOKSLOT3 ghosts).
- **Game over** happens in three places. Each one plays `GAMEOVER.AVI` and fully resets the game:
  1. a ghost in SPOOKSLOT3 catches Pardoes;
  2. a 5th wrong pot in CANIBAL1;
  3. a wrong pick in EINDSPEL1.

## Contents

0. How to read this document; bot primitives
1. Game structure
2. Map of screens (per realm, with exits)
3. Inventory: items, where found, where used
4. Puzzles and minigames
5. Critical path (bot plan)
6. Game over, lose conditions, Rattar
7. Test shortcuts and debug leftovers
8. Uncertainties and open points

## 0. How to read this document

- `L1234` = line 1234 of `PLAYER.SCR` (CRLF original; a CR-stripped copy has identical numbering). Every claim carries a line reference; **UNCERTAIN** marks readings that could not be verified from the script alone.
- Coordinates are 640x480 script coordinates. `RECT=x,y,w,h` for Commands; the bot should click the centre `(x+w/2, y+h/2)`. Sprites are given by their `Start=x,y` (for `ALIGN=CENTERCENTER`/`CENTERBOTTOM` sprites the start is the centre / bottom-centre; otherwise the top-left of the current frame, so click a few pixels inside, **UNCERTAIN** per sprite).
- Item / section names are as in the script (upper-cased by the loader).
- Disabled lines (`/...`, `aInstruction`, `qif`, `rjhSprite` ...) are ignored by the engine and are only mentioned as leftovers.

### 0.1 Bot primitives used in the step lists

| primitive | meaning | script anchor |
|---|---|---|
| `click(NAME)` | click the centre of Command `NAME` (or the sprite `NAME`) | Command -> `[NAME] #CLICK` |
| `openBag()` | click the Pardoes sprite; opens the bag (`[PARDOES] #CLICK` -> `CMDSHOWINVENTORY #CREATE`) | L2821-2823, L1167-1172 |
| `take(item)` | in the open bag, click the slot that holds `item`: `CMDINVENT1` 415,375,60,50 / `CMDINVENT2` 415,430,60,50 / `CMDINVENT3` 480,375,60,50 / `CMDINVENT4` 480,430,60,50. Sets `$INVMOVER`, closes the bag, attaches the item to the mouse | L1525-1539, L1916-1946 |
| `takeHelper()` | click sprite `INVHELP` (Start 335,460, CENTERBOTTOM) | L1484, L1948-1954 |
| `takeTwinkel()` | click sprite `INVTFLES` (Start 163,422, CENTERCENTER); only if `$TWINKELLEVEL`>0; consumes one charge immediately (`TWINKEL #USED`) | L1489, L1956-1973, L2008-2011 |
| `use(item, TARGET)` | `openBag(); take(item); click(TARGET)` - the target's `#CLICK` compares `$INVMOVER` | e.g. L10191 |
| `waitIdle()` | wait until no full-screen blocker exists (`CMDEXITINPROGRESS` L4617, `CMDENTRYINPROGRESS` L4627, `CMDPROTECTION` L1138), no movie is playing and all script threads are blocked/finished | |

A wrong drop normally runs `SYSTEM #WRONGDROP` (L1119-1123: Pardoes turns and says a "wrong" line, nothing else changes). Clicking empty background with an item on the mouse drops it (`CMDBACKSCREEN` L1143-1146 -> `DESTROYMOVER` L1623-1625); the item stays in the bag (the bag variables are not changed by taking an item out, only by `REMOVEMOVER` L1627-1642 when a target consumes it).

### 0.2 State a bot can read (debug build: `__pd.vm.vars`)

`$CURRENTSCREEN` (set in every `#CREATE`), `$PREVIOUSSCREEN` (set by `TIMERS #DISABLE` L4643 during every screen change), `$INVENT1..4`, `$INVHELP`, `$INVMOVER`, `$TWINKELLEVEL` (0..5), `$KRING1..8` (1 = found), the `$..._FINISHED` flags (declared L395-425, reset in `INIT #SETVARS` L845-904), `$SK1_MACHINELEVEL`.

## 1. Game structure in one page

- Start: `[INIT]` unnamed section (L1-695) declares all variables and `RUN`s `INTRO #CREATE` (L695). INTRO plays `INTROA.AVI` (L908-910), asks the player's name (edit box `EDTNAAM`, copies to `$SPELERNAAM`, L912-917), `CMDINTROEIND` (full screen, KEY=ENTER, L917) plays `INTROB.AVI` (L939-941) and shows `CMDINTROHAND` (RECT 400,365,140,115, KEY=ENTER, L944); its click RUNs `INIT #CONTINUE` (L946-952), which loads sounds/timers, creates SYSTEM, PARDOES, runs `INIT #CREATEGAME` (new-game reset + puzzle randomisation, L831-843) and `PROGRAM #CONTINUE` -> `STERRENKAMER #CREATE` (L1059-1062).
- Hub: **STERRENKAMER** (Pardoes' star chamber, `$CURRENTSCREEN=STERRENKAMER`, L4667-4821). From there the player travels to four Efteling realms, each with a map hub: **KPRUIG** (Ruigrijk), **KPANDER** (Anderrijk), **KPREIS** (Reizenrijk), **KPMARE** (Marerijk).
- Goal: collect the **8 magic rings** (`$KRING1..8`, `[KRING]` L2061-2225), one each in SPOOKSLOT3, PYTHON2, CANIBAL1, DRAAK1, VILLAVOLTA2, VOCSCHIP2, DOOLHOF3, FATAMORGANA2, and place them in the Sterrenkamer machine (`SK1_KRINGVULLEN`), which sets `$SK1_FINISHED` and leads to `EINDSPEL1` (ENDPRE.AVI, final puzzle) and `EINDSPEL2` (ENDPOST.AVI, diploma print, exit).
- Each ring is behind a chain of item puzzles. Items lie at fixed spots (`OBJECTS #ASSIGN` L2229-2246), each realm has a **helper** (Pardotje, Pieter(tje), Paddeltje, Pardijntje) that is given in the Sterrenkamer and used once in its realm.
- **Twinkel** (magic dust, flask with 5 charges `$TWINKELLEVEL`): spent when flying home with the bell (`CMDEXITtoSK #GO` L7165-7166) and against Rattar (L2578); refilled in the Sterrenkamer machine.
- **Rattar** (rat thief) can appear on screen changes and steals an item unless driven off with twinkel (section 6).

### 1.1 Realms at a glance

| Realm (hub) | Screens | Rings | Helper used here (picked up in the Sterrenkamer) | Items produced | Items needed from elsewhere |
|---|---|---|---|---|---|
| Ruigrijk (KPRUIG) | PYTHON1, PYTHON2, OLDTIMER1-3, VOCSCHIP1-2 | KRING2 (PYTHON2), KRING6 (VOCSCHIP2) | PARDOTJE (VC2 stairs, L11823) | KAART (OT3), LUCIFER, STEEN, ZAAG (VC2) | SLINGER (Ander) |
| Anderrijk (KPANDER) | FATAMORGANA1-2, VEERMAN1, PIRANHA1, PIRANHA2+2A..E, PIRANHA3, SPOOKSLOT1-3 | KRING8 (FM2), KRING1 (SS3) | PIETERTJE (FM2 hatch, L12964) | POMP (PI1 rock), PEDDEL (PI1, after VM1), SLEUTEL (FM2 jug), DEURRING (FM2 hatch), SLINGER (PI3) | SPIEGEL (Sterrenkamer wall), LUCIFER (Ruig) |
| Reizenrijk (KPREIS) | CARNAVAL1-2, CANIBAL1, DOOLHOF1-3 | KRING3 (CANIBAL1), KRING7 (DOOLHOF3) | PADDELTJE (DH3 crossing, L19069) | EMMER (CF2) | BANAAN (Mare), KAART (Ruig) |
| Marerijk (KPMARE) | TROLLENKONING1, ELFJES1-2, DRAAK1, VILLAVOLTA1-2 | KRING4 (DRAAK1), KRING5 (VILLAVOLTA2) | PARDIJNTJE (dragon, L21580) | BANAAN (TK1), POT (VV2) | STEEN (Ruig), SLEUTEL (Ander) |

The ring mapping comes from `[KRING]` (L2061-2225). Picking up a ring also runs `INCREASE CMDSK1MACHINE`, which only brightens the room (`$SYSWORLDCOLOR`+5, L6213).

### 1.2 Travel between places

- **Sterrenkamer to a realm.**
  1. Click the chronoscope `SK1_CHRONO` (MOVE zone) to cycle `$SK1_RIJK` through KPMARE, KPREIS, KPRUIG, KPANDER and back (L5356-5378). The initial value is KPMARE (L337), and SETVARS does not reset it.
  2. Open the cabinet (sprite trigger `OPENKAST` on `SK1_KAST`, L5195-5208). The cabinet closes again after 11 s (`SK1DEURTIMER`, L5085).
  3. Click `CMDSKtoKPRANDOM` (RECT 565,212,75,180, L7202-7224). `$NEXTSCREEN` is set to `$SK1_RIJK`.
- **Hub to hub.** Each hub has three 30x30 Commands at 91,361 / 106,396 / 116,428 leading to the other three hubs. The target behind each rect differs per hub (tables in section 2). A 240x40 Command at 190,440 leads back to the Sterrenkamer. Both go through `[TOBOTTOM] #GO` (L19540-19555) and cost nothing.
- **Bell.** Most realm screens set `$SK_RECT`, and `STERRENKAMER #CREATEEXIT` (L4989-4995) turns that into the Command `CMDEXITtoSK`. Clicking it (L7143-7187) flies Pardoes home. It costs one twinkel charge if the flask is not empty. With an empty flask the trip is free (`#NOGO`, L7157-7163).
- **Oops.** After a bell arrival, `CMDSK1_OOPS` (sprite at 184,322, RECT 175,315,32,32, L7086-7108) flies Pardoes back to the previous screen.
- **Wells (DEPUT).** These are optional random shortcuts:
  - Entry points: the Sterrenkamer trapdoor (`CMDSK1_TRAP`, then `CMDSKtoDEPUT`), the `$DP_RECT` exits in VOCSCHIP1, DOOLHOF1 and VILLAVOLTA2 (after the fire), and Commands in FATAMORGANA1, SPOOKSLOT1, VEERMAN1 and CARNAVAL2.
  - Falls into a well: the OLDTIMER2 pit and the TROLLENKONING1 arrow trap.
  - The two wells alternate on `$PUTNR` (L8190-8194).
  - Climbing out runs `SUBRANDOM 7` (L8531-8562) and lands on SPOOKSLOT1, VOCSCHIP1, FATAMORGANA1, STERRENKAMER, DEPUT, VEERMAN1 or DOOLHOF1.

### 1.3 Screen-change protocol (what a bot observes)

A click handler sets `$NEXTSCREEN`, `$PARDOESEXIT` (a PARDOES walk section) and often `$PWALK*`, then calls `SYSTEM #DONEXTSCREEN` (L1125-1135). That call:
1. disables timers (`TIMERS #DISABLE` L4643 sets `$PREVIOUSSCREEN=$CURRENTSCREEN` and drops the held item, L4645);
2. disables random events;
3. plays the exit walk;
4. runs `DESTROY` of the old screen and `CREATE` of `$NEXTSCREEN`;
5. enables timers;
6. runs `INCREASE RATTAR`.

Each `#CREATE` sets `$CURRENTSCREEN` and runs its own `#STARTPARDOES`, which chooses the entry walk from `$PREVIOUSSCREEN` (the `fromXX` sections) or from `$EXITBYBEL` (`fromBel`). During exits and entries the full-screen Commands `CMDEXITINPROGRESS` / `CMDENTRYINPROGRESS` (L4608-4630) swallow clicks.

**A bot step is done when `$CURRENTSCREEN` has the expected value and none of those blockers exist.**

## 2. Map of screens

How to read the tables:
- Column "R/E" lists `$RATTAR_ALLOWED` and the random-event count (`$RANDOMEVENTNR` when `$RANDOMEVENTS=$TRUE`). Every RANDOMEVENTn section in the game is ambience only: animals from `[ALGEMEEN]`, sounds, or the ferryman being startled. None changes game state.
- "Bell" is `$SK_RECT` (the CMDEXITtoSK hotspot). "Well" is `$DP_RECT` (CMDEXITtoDP, L8219-8226).
- Exits are Commands unless marked "sprite". Where two Commands overlap, the one created later wins the hit test (graphics.md C.1). Recommended click points take that into account.

### 2.0 Start, hub and system screens

| Screen | Lines | What | Exits / transitions |
|---|---|---|---|
| INTRO | 906-929 | Plays `INTROA.AVI`, then the name entry: EDITBOX `EDTNAAM` at 170,340, up to 15 characters, stored in `$SPELERNAAM` (L912-916). | `CMDINTROEIND` (full screen, KEY=ENTER, L917) plays `INTROB.AVI` (L939-941). It then shows `CMDINTROHAND` (400,365,140,115, KEY=ENTER, L944), whose click runs `INIT #CONTINUE` (L946-952), then `PROGRAM #CONTINUE` (L1059-1062), then the Sterrenkamer. |
| STERRENKAMER | 4667-5088, plus SK1 items 5090-7326 | Hub. R/E: no Rattar (L4681), no events. No bell (L4703). The `$DP_RECT` at L4706 is never turned into a Command. | See the table below. |
| DEPUT (dispatcher) | 8189-8217 | `$PUTNR` FALSE leads to DEPUT2, TRUE to DEPUT1 (L8190-8194). | – |
| DEPUT1 | 8228-8378 | Well. R/E: Rattar yes, no events. | `CMDDP1toWORLD` 333,40,80,30 (L8258, L8356) goes to a random world (L8531). `CMDRONDJEPUT1a/1b` (280,440,140,40 / 560,280,80,380) walk around the well (cosmetic). |
| DEPUT2 | 8379-8529 | Same as DEPUT1. | `CMDDP2toWORLD` 205,40,80,30 (L8409, L8507). `CMDRONDJEPUT2a/2b` 220,440,140,40 / 0,280,80,380. |
| EINDSPEL1 | 8578-8659 | Plays `ENDPRE.AVI` (L8589-8591), then the final choice of three pictures (section 4.17). | Correct pick goes to EINDSPEL2. Wrong pick goes to PARDOESEINDE (L8661-8689). |
| EINDSPEL2 | 8691-8728 | Plays `ENDPOST.AVI` (L8697-8699), then the diploma with `$SPELERNAAM` at 348,158. | `CMDES2PRINT` 457,371,95,75 prints the diploma and goes on. `CMDES2KLAAR` (full screen) goes to CMDEXITTITEL (L8716-8728). |
| CMDEXITTITEL | 7278-7325 | Credits (XTITEL1/2.BMP alternate on a 4 s timer, L7296). | Full-screen Command, KEY=ESCAPE. Its click runs `Exit` (L7281), which ends the program. |
| PARDOESEINDE | 8167-8187 | `GAMEOVER.AVI`, then `INIT #CREATEGAME` (full reset), then STERRENKAMER (L8176-8183). | – |

**Sterrenkamer clickables.** Sprite trigger centres were computed by the hub analysis from sprite Start plus the .SPR trigger area (UNCERTAIN to a few pixels).

| Name | Where | Lines | Effect |
|---|---|---|---|
| SK1_KAST trigger OPENKAST | approx. 545,261 | sprite L4791, L5195-5208 | Opens the cabinet and creates `CMDSKtoKPRANDOM` and `CMDSK1_SLUITKAST`. Auto-closes after 11 s. |
| CMDSKtoKPRANDOM | 565,212,75,180 | L7202-7224 | Goes to `$SK1_RIJK` (realm hub). Only exists while the cabinet is open. |
| CMDSK1_SLUITKAST | 611,314,25,50 | L7189-7197 | Closes the cabinet. |
| SK1_CHRONO MOVE / KIJK | approx. 290,270 / 290,155 | L5247-5262, L5298-5378 | MOVE advances `$SK1_RIJK`. KIJK shows a realm preview (click to close, `CMDSK1_CSKIJKEND` L5275). |
| SK1_KAST trigger PARDOT | approx. 593,327 | L5179-5185 | Helper PARDOTJE (`CMDINVENTORY #SHOWHELP`). |
| SK1_KAST trigger PARDIJN | approx. 563,145 | L5187-5193 | Helper PARDIJNTJE. |
| CMDSK1_PAD | 195,229,30,40 | L7115-7125 | Helper PADDELTJE. |
| CMDSK1_PIT | 387,236,30,40 | L7129-7139 | Helper PIETERTJE. |
| SK1OBJMUUR | object at approx. 400,340 | L7069-7084, OBJECTS L2345-2360 | Picks up `$OBJSK1_MUUR` = SPIEGEL. |
| SK1_KAST trigger KASTLA, then drawer SK1_BKLA trigger KRING | approx. 535,355, then 530,340 | L5163-5170, L5225-5245 | Opens the ring panel `SK1_KRINGVULLEN` (section 4.16). FOUTLA (approx. 596,379) is a "wrong drawer" sound. |
| CMDSK1MACHINE | 433,256,25,25 | L6183-6346 | Refills the twinkel flask by 1 per click while `$TWINKELLEVEL`&lt;5. Machine stock `$SK1_MACHINELEVEL` starts at 30 (L846). The Command only exists if the stock is not 0 (L4787-4788). |
| CMDSK1_TRAP, then CMDSKtoDEPUT | 386,410,30,15, then 220,425,180,40 | L6091-6164, L7230-7247 | Trapdoor, then the well. |
| SK1VERGROOTGLAS | sprite 291,371 | L5146-5160 | Puts the magnifying glass on the mouse. Its use (fax, map, two books; L6520-7050) is optional reading. UNCERTAIN whether the sprite is visible: bitmap `VWK_VGLAS` is never loaded. |
| SK1_OK1..3, SK1_OKS | organ keys | L5090-5144 | Sound only. |
| CMDSK1_INTRO | 121,218,45,25 | L7052 | Replays the fax message. |
| CMDSK1_EXIT | 576,76,45,45 | L4783, L7251-7275 | **Quits the game** with no confirmation: credits, then Exit. A bot must never click it by accident. |

### 2.1 Ruigrijk

| Screen | Lines | R/E | Bell / Well | Entry branches (`$PREVIOUSSCREEN`) |
|---|---|---|---|---|
| KPRUIG | 8763-9110 | yes / 12 | – / – | STERRENKAMER, PYTHON1/2, OLDTIMER1/3, VOCSCHIP1, other hubs (L8819-8829) |
| PYTHON1 | 9111-9644 | no / – | – / – | STERRENKAMER, OLDTIMER1/3, KPRUIG (L9165-9170). If `$PY1_FINISHED` is set, CREATE builds PYTHON2 instead (L9113-9114). |
| PYTHON2 | 9645-9979 | no / 7 | – / – | STERRENKAMER, PYTHON1, OLDTIMER1/3, KPRUIG (L9694-9699) |
| OLDTIMER1 | 9980-10294 | yes / 5 | 290,90,35,35 / – | STERRENKAMER, PYTHON1/2, OLDTIMER2, KPRUIG (L10035-10041) |
| OLDTIMER2 | 10295-10564 | no / – | – / – | none; DX driving screen |
| OLDTIMER3 | 10565-10786 | yes / 5 | 380,280,50,30 / empty string (L10589, see section 8) | STERRENKAMER, OLDTIMER2, DEPUT1/2 (L10620-10625) |
| VOCSCHIP1 | 10787-11422 | yes / 2 | 97,377,28,27 / 500,350,90,35 | STERRENKAMER, VOCSCHIP2, PYTHON2, KPRUIG, DEPUT1/2 (L10867-10873) |
| VOCSCHIP2 | 11423-11946 | yes / 2 | 600,330,20,30 / – | STERRENKAMER, VOCSCHIP1 (L11545-11547) |

**Exits:**

| From | Command | RECT | Def / CLICK | Condition | To |
|---|---|---|---|---|---|
| KPRUIG | CMDKPRUIGtoPY1 | 275,180,180,120 | L8799 / L9069 | – | PYTHON1 (becomes PYTHON2 once PY1 is solved) |
| KPRUIG | CMDKPRUIGtoOT1 | 0,200,120,200 | L8800 / L9051 | – | OLDTIMER1 |
| KPRUIG | CMDKPRUIGtoVC1 | 560,220,80,200 | L8801 / L9089 | – | VOCSCHIP1. Click at approx. 620,260: the info Command CMDKPRG_VC1I (560,320,50,30) covers the centre. |
| KPRUIG | CMDKPRUIGtoKPMARE / KPANDER / KPREIS | 91,361 / 106,396 / 116,428 (30x30) | L8802-8804 / L9045, L9033, L9039 | – | other hubs |
| KPRUIG | CMDKPRUIGtoSK | 190,440,240,40 | L8805 / L9027 | – | STERRENKAMER |
| PYTHON1 | CMDPY1toKPRUIG | 100,440,440,40 | L9151 / L9602 | – | KPRUIG |
| PYTHON1 | CMDPY1toOT1 | 0,280,60,200 | L9152 / L9617 | – | OLDTIMER1 |
| PYTHON1 | (auto) GAMEWON | – | L9359-9362 | `$PY1_FINISHED` | PYTHON2 |
| PYTHON2 | CMDPY2toKPRUIG | 0,440,640,40 | L9816 / L9946 | – | KPRUIG |
| PYTHON2 | CMDPY2toVC1 | 560,280,80,200 | L9817 / L9954 | – | VOCSCHIP1 |
| PYTHON2 | CMDPY2toOT1 | 0,280,80,200 | L9818 / L9967 | – | OLDTIMER1 |
| OLDTIMER1 | CMDOT1toKPRUIG | 560,190,80,200 | L10264 | – | KPRUIG |
| OLDTIMER1 | CMDOT1toPY1 | 0,250,90,40 | L10290 | – | PYTHON1/2 |
| OLDTIMER1 | CMDOT1toOT2 | 395,260,20,80 | L10244 / L10223 | only after the car is started (`$OT1_FINISHED`) | OLDTIMER2 |
| OLDTIMER2 | DXTUFFER #WIN / #LOOSE / #LOOSEPUT | – | L10544 / L10551 / L10558 | race result | OLDTIMER3 / OLDTIMER1 / DEPUT |
| OLDTIMER3 | CMDOT3toKPRUIG | 580,190,60,200 | L10756 | – | KPRUIG |
| OLDTIMER3 | CMDOT3toPY1 | 545,250,70,60 | L10782 | – | PYTHON1/2. Click at approx. 560,280 (it overlaps the KPRUIG exit). |
| VOCSCHIP1 | CMDVC1toKPRUIG | 150,440,140,40 | L11392 | – | KPRUIG |
| VOCSCHIP1 | CMDVC1toDP1 | 500,350,90,35 | L11056 | – | DEPUT |
| VOCSCHIP1 | CMDVC1toVC2 | 305,130,60,50 | L11418 | `$VC1_FINISHED` (L10859, L11195) | VOCSCHIP2 |
| VOCSCHIP2 | CMDVC2toVC1 | 0,440,640,40 | L11730 | – | VOCSCHIP1 |

**Cosmetic Commands:**
- KPRUIG info clips CMDKPRG_OT1I / PY1I / VC1I (L9003-9025).
- OT1 CMDOT1BENZINE and CMDOT1TOETER.
- VC1 and VC2 LEFT/RIGHT walk-arounds.
- The VC2 cannon (VC2KOGEL1..3 load it, LUCIFER fires it and is kept, L11673-11895).

### 2.2 Anderrijk

| Screen | Lines | R/E | Bell / Well | Entry branches |
|---|---|---|---|---|
| KPANDER | 11947-12297 | yes / 7 | 412,94,50,50 / – | STERRENKAMER, SPOOKSLOT1, FATAMORGANA1, PIRANHA1/3, other hubs (L12013-12023) |
| FATAMORGANA1 | 12298-12689 | no / 7 | 170,285,45,35 / – | STERRENKAMER, SPOOKSLOT1, PIRANHA1, FATAMORGANA2, KPANDER, DEPUT1/2 (L12428-12437) |
| FATAMORGANA2 | 12690-13041 | yes / – | 325,24,30,30 / – | STERRENKAMER, FATAMORGANA1, VEERMAN1 (L12777-12782) |
| VEERMAN1 | 13042-13392 | yes / 5 | 500,355,35,35 / – | STERRENKAMER, FATAMORGANA2, DEPUT1/2 (L13206-13212) |
| PIRANHA1 | 13423-13887 | yes / – | 560,195,35,35 / – | STERRENKAMER, VEERMAN1, FATAMORGANA1, KPANDER, PIRANHA2/2A..E (L13559-13571) |
| PIRANHA2, 2A..2E | 14197-14474 | no / – | – / – | ride segments; no inventory, no exits |
| PIRANHA3 | 14476-14688 | yes / 3 | 15,175,60,40 / – | `$EXITBYBEL` only (L14548) |
| SPOOKSLOT1 | 14689-15337 | yes / 6 | 20,255,30,30 / – | STERRENKAMER, FATAMORGANA1, SPOOKSLOT2/3, KPANDER, DEPUT1/2 (L14793-14802) |
| SPOOKSLOT2 | 15338-15486 | yes / – | 533,333,25,25 / – | STERRENKAMER, SPOOKSLOT1 (L15384). If `$SS2_FINISHED` is set, CREATE builds SPOOKSLOT3 instead (L15342). |
| SPOOKSLOT3 | 15487-16280 | yes / – | 533,333,25,25 / – | STERRENKAMER, SPOOKSLOT1, SPOOKSLOT2 (L15758) |

**Exits:**

| From | Command | RECT | Def / CLICK | Condition | To |
|---|---|---|---|---|---|
| KPANDER | CMDKPANDERtoSS1 | 0,200,80,200 | L11995 / L12246 | – | SPOOKSLOT1 |
| KPANDER | CMDKPANDERtoFM1 | 260,150,130,150 | / L12262 | – | FATAMORGANA1 |
| KPANDER | CMDKPANDERtoPI1 | 550,220,70,200 | / L12282 | – | PIRANHA1 |
| KPANDER | toKPRUIG / toKPMARE / toKPREIS | 91,361 / 106,396 / 116,428 | / L12228, L12240, L12234 | – | hubs |
| KPANDER | CMDKPANDERtoSK | 190,440,240,40 | / L12222 | – | STERRENKAMER |
| FM1 | CMDFM1toKPANDER | 150,440,370,40 | L12540 / L12521 | – | KPANDER |
| FM1 | CMDFM1toDP1 | 25,380,80,30 | L12566 / L12545 | – | DEPUT |
| FM1 | CMDFM1toPI1 | 560,200,80,200 | L12586 / L12571 | – | PIRANHA1 |
| FM1 | CMDFM1toSS1 | 0,200,80,200 | L12606 / L12591 | – | SPOOKSLOT1 |
| FM1 | CMDFM1toFM2 | 280,180,140,120 | L12684 / L12611 | mover must be SPIEGELFM1, i.e. SPIEGEL moved over the rect first (FLYOVER L12638-12644) | FATAMORGANA2 |
| FM2 | CMDFM2toVM1 | 530,180,110,200 | L13014 / L12997 | – | VEERMAN1 |
| FM2 | CMDFM2toFM1 | 120,440,260,40 | L13037 / L13019 | – | FATAMORGANA1 |
| VM1 | CMDVM1toFM2 | 400,440,220,40 | L13366 / L13351 | – | FATAMORGANA2 |
| VM1 | CMDVM1toDP1 | 580,350,60,25 | L13388 / L13371 | – | DEPUT |
| VM1 | (auto) `VM1_PUZZLE #SOLVED` | – | L13311-13349 | word solved | PIRANHA1 by ferry |
| PI1 | CMDPI1toKPANDER | 280,440,120,40 | L13883 / L13865 | – | KPANDER |
| PI1 | sprite P1BOOT + PEDDEL | sprite 430,400 (boat inflated: 290,364) | L13752 / L13738 | `$PI1_FINISHED` (boat pumped) | PIRANHA2 |
| PI2..2E | segment end (TIMERGAME) | – | L14060, L14133-14142 | about 15 s per segment | next segment; after 2E, PIRANHA3 |
| PI2.. | 4th bite (SINK) | – | L13961 | `$PI2_BITECNT=4` | PIRANHA1 (boat deflated) |
| PI3 | CMDPI3open, then CMDPI3toKPANDER | 145,387,50,30, then 280,220,130,120 | L14661 / L14683 | gate opened (every visit) | KPANDER |
| SS1 | CMDSS1toKPANDER | 0,440,640,40 | L15320 / L15306 | – | KPANDER |
| SS1 | CMDSS1toFM1 | 560,280,80,200 | L15279 / L15266 | – | FATAMORGANA1. Click at 600,300; the lower part overlaps stone 4. |
| SS1 | CMDSS1toDP1 | 30,360,60,20 | L15300 / L15285 | – | DEPUT |
| SS1 | CMDSS1toSS2 | 294,270,56,80 | L15260 / L15240 | stones solved (`$SS1_FINISHED`) | SPOOKSLOT2 |
| SS2 | CMDSS2toSS3 | 560,270,40,50 | L15462 / L15420 | drop LUCIFER | SPOOKSLOT3 |
| SS2 | CMDSS2toSS1 | 0,440,640,40 | L15482 / L15467 | – | SPOOKSLOT1 |
| SS3 | CMDSS3toSS1 | 200,470,300,10 | L16270 / L16236 | Pardoes not on the tile field | SPOOKSLOT1 |
| SS3 | CMDSS3EXIT | 125,100,70,115 | L16263 / L16250 | after a TEGEND click or the ring-ghost win | SPOOKSLOT1 |

**Cosmetic Commands:**
- KPANDER: CMDKPAN_BOOM / SS1I / RAAM1 / RAAM2.
- FM1: CMDFM1_BOOM.
- FM2: CMDFM2BEDELAAR (empty handler).
- SS1: CMDSS1_KLIK1..6 (L15119-15148).
- SS3: CMDSS3TOMBE.

### 2.3 Reizenrijk

| Screen | Lines | R/E | Bell / Well | Entry branches |
|---|---|---|---|---|
| KPREIS | 16281-16642 | yes / 14 | 360,170,30,30 / – | STERRENKAMER, DOOLHOF1/3, CARNAVAL1, CANIBAL1, other hubs (L16338-16348) |
| CARNAVAL1 | 16643-16944 | yes / 3 | 75,45,35,30 / – | STERRENKAMER, CARNAVAL2, KPREIS (L16703) |
| CARNAVAL2 | 16945-17211 | no / – | 85,18,80,92 / – | STERRENKAMER, CARNAVAL1, DEPUT1/2 (L17019) |
| CANIBAL1 | 17212-17899 | no / – | 110,15,40,30 / – | STERRENKAMER, KPREIS (L17298) |
| DOOLHOF1 | 17900-18231 | yes / 11 | 305,40,40,40 / 460,330,110,35 | STERRENKAMER, DOOLHOF2/3, KPREIS, DEPUT1/2 (L17972) |
| DOOLHOF2 | 18232-18640 | no / – | none (no bell inside the maze) | STERRENKAMER, everything else as fromSK1 (L18278) |
| DOOLHOF3 | 18641-19163 | yes / 8 | 370,410,70,30 / – | STERRENKAMER, DOOLHOF2 (L18712) |

**Exits:**

| From | Command | RECT | Def / CLICK | Condition | To |
|---|---|---|---|---|---|
| KPREIS | CMDKPREIStoCF1 | 0,220,100,150 | L16320 / L16587 | – | CARNAVAL1 |
| KPREIS | CMDKPREIStoMC1 | 150,190,150,110 | / L16603 | – | CANIBAL1 |
| KPREIS | CMDKPREIStoDH1 | 500,170,140,140 | / L16624 | – | DOOLHOF1 |
| KPREIS | toKPMARE / toKPANDER / toKPRUIG | 91,361 / 106,396 / 116,428 | / L16581, L16569, L16575 | – | hubs |
| KPREIS | CMDKPREIStoSK | 190,440,240,40 | / L16563 | – | STERRENKAMER |
| CF1 | CMDCF1toKPREIS | 0,440,640,40 | L16886 / L16878 | – | KPREIS |
| CF1 | CMDCF1toCF2 | 345,245,50,80 | L16912 / L16891 | `$CF1_FINISHED` (monkey fed) | CARNAVAL2 |
| CF2 | CMDCF2toCF1 | 0,440,480,40 | L17207 / L17200 | – | CARNAVAL1 |
| CF2 | CMDCF2toDP1 | 220,165,30,30 | L17195 / L17165 | `$CF2_FINISHED`. **Before solving, clicking it re-scrambles the jigsaw.** | DEPUT |
| MC1 | CMDMC1toKPREIS | 85,440,400,40 | L17870 / L17856 | not while Pardoes is in a pot | KPREIS |
| DH1 | CMDDH1toKPREIS | 0,200,80,200 | L18227 / L18213 | – | KPREIS |
| DH1 | CMDDH1toDH2 | 250,170,150,170 | L18184 / L18163 | `$DH1_FINISHED` (gate opened with KAART) | DOOLHOF2 |
| DH2 | CMDDH2_FORWARD / LEFT / RIGHT / BACK | 270,160,90,100 / 160,270,100,80 / 370,270,100,80 / 160,440,300,40 | L18553-18640 | open sides of the current view | maze moves. Exit north goes to DOOLHOF3, exit south to DOOLHOF1. |
| DH3 | CMDDH3toDH1 | 280,440,80,40 | L19062 / L19047 | before crossing | DOOLHOF1 |
| DH3 | CMDDH3STEEKTERUG | 180,450,320,30 | L19159 / L19138 | after crossing | DOOLHOF1 |

**Cosmetic:**
- KPREIS info Commands CMDKPRZ_*.
- CF1 decorative sprites CF1_P1..P9 (no handler items).

### 2.4 Marerijk

| Screen | Lines | R/E | Bell / Well | Entry branches |
|---|---|---|---|---|
| KPMARE | 19164-19642 | yes / 14 | 547,158,30,30 / – | STERRENKAMER, ELFJES1, VILLAVOLTA1, TROLLENKONING1, other hubs (L19224-19232) |
| TROLLENKONING1 | 19643-20093 | yes / 11 | 520,230,45,45 / – | STERRENKAMER, ELFJES1, KPMARE (L19739) |
| ELFJES1 | 20262-20535 | yes / 7 | 440,360,80,45 / – | STERRENKAMER, TROLLENKONING1, ELFJES2, KPMARE (L20350) |
| ELFJES2 | 20614-21084 | no / 9 | none | STERRENKAMER, ELFJES1, DRAAK1 (dead branch) (L20688) |
| DRAAK1 | 21224-21541 | yes / – | 580,340,50,45 / – | STERRENKAMER, ELFJES2 (L21364) |
| VILLAVOLTA1 | 21755-21999 | yes / 7 | 330,60,25,20 / – | STERRENKAMER, VILLAVOLTA2, DRAAK1, KPMARE (L21844) |
| VILLAVOLTA2 | 22082-22297 | no / – | upside down 290,310,40,35; upright 310,140,40,35 / 295,295,60,60 once the fire is out | STERRENKAMER, VILLAVOLTA1, DEPUT1/2 (L22141) |

**Exits:**

| From | Command | RECT | Def / CLICK | Condition | To |
|---|---|---|---|---|---|
| KPMARE | CMDKPMAREtoTK1 | 0,220,100,150 | L19206 / L19581 | – | TROLLENKONING1 |
| KPMARE | CMDKPMAREtoLF1 | 140,190,90,110 | L19207 / L19597 | – | ELFJES1 |
| KPMARE | CMDKPMAREtoVV1 | 430,210,130,130 | L19208 / L19624 | – | VILLAVOLTA1 |
| KPMARE | toKPREIS / toKPANDER / toKPRUIG | 91,361 / 106,396 / 116,428 | L19209-19211 / L19575, L19563, L19569 | – | hubs |
| KPMARE | CMDKPMAREtoSK | 190,440,240,40 | L19212 / L19557 | – | STERRENKAMER |
| TK1 | CMDTK1toKPMARE | 160,440,320,40 | L20239 / L20230 | – | KPMARE |
| TK1 | CMDTK1toLF1 | 0,280,80,200 | L20257 / L20244 | – | ELFJES1 |
| TK1 | second wrong arrow (#FOUT) | – | L19851 | – | DEPUT (Pardoes falls) |
| LF1 | CMDLF1toKPMARE | 180,440,240,40 | L20565 / L20551 | – | KPMARE |
| LF1 | CMDLF1toTK1 | 0,280,60,200 | L20584 / L20570 | – | TROLLENKONING1 |
| LF1 | CMDLF1toLF2 | 280,190,110,130 | L20609 / L20589 | – | ELFJES2 |
| LF2 | CMDLF2toLF1 | 120,440,400,40 | L21194 / L21185 | – | ELFJES1 (also clicked automatically after solving) |
| LF2 | CMDLF2toDR1 | 290,150,60,40 | L21219 / L21199 | only when entered with `$LF2_FINISHED` set (L20777) | DRAAK1 |
| DR1 | CMDDR1toVV1 | 0,270,80,210 | L21750 / L21735 | – | VILLAVOLTA1. There is no way back to ELFJES2. |
| VV1 | CMDVV1toKPMARE | 280,440,120,40 | L22047 / L22032 | – | KPMARE |
| VV1 | CMDVV1toVV2 | 300,300,65,65 | L22027 / L22006 | `$VV1_FINISHED` (door unlocked with SLEUTEL) | VILLAVOLTA2 |
| VV2 | CMDVV2toVV1 | 0,440,640,40 | L22419 / L22404 | after the sliding puzzle (`$VV2_FINISHED1`) | VILLAVOLTA1 |

**Cosmetic:**
- Toadstools CMDKPMA_TOAD1..3, CMDTK1_TOAD1/2, CMDLF1_TOAD1..3, CMDLF2_TOAD1, CMDDR1_TOAD1/2, CMDVV1_TOAD1. All share `[CMDKPMA_TOAD]` (L19476), which only sparkles and uses no twinkel.
- KPMA_AN1 volume toggle (L19501).
- TK1 CMDTK1VERTEL: the king's story, only after the arrows are solved.

## 3. Inventory

### 3.1 Mechanics

- **Slots.** There are four bag slots `$INVENT1..4`, one helper slot `$INVHELP`, the twinkel flask `$TWINKELLEVEL` (0-5), and the rings `$KRING1..8`. The item ids are the `$INV...` variables (L234-282); their values are plain words such as `POMP`.
- **Adding an item** (`CMDINVENTORY #ADD`, L1691-1757): the item goes into the first empty slot. If all four slots are full, `#INVREPLACE` (L1749) shifts the slots: slot 1 becomes `$INVLEFTOVER`, slots 2-4 move up one place, and the new item goes into slot 4.
- **Where the leftover goes.** Each `OBJECTS ...@xxxDONE` sequence writes `$INVLEFTOVER` back into the object variable of the spot being picked up, for example `Set $OBJVC2_DEUR=$INVLEFTOVER` (L2372). The pushed-out item now lies at that spot and can be picked up again.
- **No drop command.** There is no other way to discard an item, so bag order matters. The plan in section 5 is arranged so that only dead items get pushed out.
- **Consuming an item.** A target that consumes an item calls `REMOVEMOVER` (L1627-1642), which empties the matching slot. A target that keeps it only calls `DESTROYMOVER` (L1623-1625).
- **Helper slot.** It holds only one helper. `#SHOWHELP` (L1818-1834) replaces whatever helper is there.
- **Rattar.** He can steal slot 1, then 2, 3 or 4 (`MOVEFIRSTAVAILABLE`, L1762-1801). The stolen item is re-hidden at the first empty object spot, in the order VC2_LUIK, OT3_GRND, PI1_ROTS, TK1_GRND, CF2_GRND, FM2_LUIK, VC2_DEUR, VC2_TRAP, VV2_GRND, FM2_KRUIK, PI1_BOOT, SK1_MUUR, PI3_GRND (`OBJECTS #ASSIGNMOVER`, L2248-2343). The developers' comments at L2249-2250 note that SK1_MUUR only fits the mirror and that PI3 could deadlock. Section 6 covers Rattar in full.

### 3.2 Item table

Object spots are fixed at new game by `OBJECTS #ASSIGN` (L2229-2246); they are not random.

| Item (`$INV...` id) | Where it is picked up (screen, object, condition) | Where it is used (target, effect) | Consumed? |
|---|---|---|---|
| SPIEGEL (mirror) | STERRENKAMER, wall object SK1OBJMUUR (`$OBJSK1_MUUR`, L2244; L2345-2360, L7069-7084). Always available. | FATAMORGANA1 `CMDFM1toFM2`: move the mirror over the house; FLYOVER turns the mover into SPIEGELFM1 (L12638-12644). Click to go to FATAMORGANA2 (L12611-12620). | no (L12617) |
| SPIEGELFM1 | not an item; the mover name while the mirror is over the FM1 house | see SPIEGEL | – |
| POMP (pump) | PIRANHA1, rock Command `CMDPI1OBJROTS` 30,180,80,30 (`$OBJPI1_ROTS`, L2238). Only reachable by crossing the tree trunk; the Command is enabled from the rock (L13838, L13846). | PIRANHA1 boat `P1BOOT`: inflate, sets `$PI1_FINISHED` (L13719-13731). Needed again after the boat sinks. | no |
| PEDDEL (paddle) | PIRANHA1 `CMDPI1OBJBOOT` 440,440,80,40. Only after the VEERMAN1 word puzzle sets `$OBJPI1_BOOT=$INVPEDDEL` (L13314; L2440-2454; L13682-13700). | PIRANHA1 inflated boat: starts the ride (`VERTREK`, L13738-13741). | no |
| SLINGER (crank) | PIRANHA3 ground sprite `PI3OBJGRND` at 502,384 (`$OBJPI3_GRND`, L2239; L14632-14646) | OLDTIMER1 `CMDOT1STARTEN` 285,320,20,25: starts the car, sets `$OT1_FINISHED` (L10188-10196) | yes |
| KAART (map) | OLDTIMER3 ground sprite `OT3OBJGRND` at 40,320 (`$OBJOT3_GRND`, L2237; L10727-10740) | DOOLHOF1 gate `CMDDH1HEK` 300,240,50,50: sets `$DH1_FINISHED` (L18189-18196) | yes |
| LUCIFER (matches) | VOCSCHIP2 `VC2OBJDEUR` at 588,338, behind the door `VC2DEUR` (`$OBJVC2_DEUR`, L2234; L11783-11817) | SPOOKSLOT2 torch `CMDSS2toSS3`: sets `$SS2_FINISHED`, goes to SS3 (L15420-15441). Also fires the VC2 cannon (cosmetic, kept; L11874-11895). | yes (SS2) |
| STEEN (stone) | VOCSCHIP2 `VC2OBJLUIK` at 250,317, under the hatch `VC2LUIK` (`$OBJVC2_LUIK`, L2236; L11840-11873) | DRAAK1 chest `CMDDR1RUILSTEEN` (2nd step): sets `$DR1_FINISHED2`, makes ring 4 available (L21679-21705) | yes |
| ZAAG (saw) | VOCSCHIP2 stairs `VC2OBJTRAP` (515,320): drop the helper PARDOTJE on it (`$OBJVC2_TRAP`, L2235; L11818-11839) | VOCSCHIP2 bars `VC2TRALIES`: sets `$VC2_FINISHED`, frees ring 6 (L11752-11766) | yes |
| SLEUTEL (key) | FATAMORGANA2 jug `FM2OBJKRUIK` at 444,360. It appears after clicking the window `CMDFM2RAAM` (`$OBJFM2_KRUIK`, L2245; L12894-12905, L12984-12996). | VILLAVOLTA1 door `CMDVV1OPENDEUR` 300,300,65,65: sets `$VV1_FINISHED` (L22052-22072) | yes |
| DEURRING (door ring) | FATAMORGANA2 hatch `CMDFM2OBJLUIK` 459,244,35,45: drop the helper PIETERTJE on it (`$OBJFM2_LUIK`, L2240; L12962-12983). The basket sprite covers the hatch until it is opened (section 4.4). | FATAMORGANA2 door `FM2DEUR`: sets `$FM2_DEUROPEN`, frees ring 8 (L12933-12944) | yes |
| BANAAN (banana) | TROLLENKONING1 ground sprite `TK1OBJGRND` at 470,400. No puzzle needed (`$OBJTK1_GRND`, L2241; L19718, L20213-20229). | CARNAVAL1 monkey `CMDCF1AAP` 255,85,70,50: sets `$CF1_FINISHED`, door opens (L16917-16934) | yes |
| EMMER (bucket) | CARNAVAL2 ground sprite `CF2OBJGRND` at 257,141. Only after the jigsaw; before that, clicking it re-scrambles the puzzle (`$OBJCF2_GRND`, L2242; L17137-17163). | CANIBAL1 water tap `CMDMC1WATER` 0,335,150,80: the mover becomes WATER (L17875-17895) | no |
| WATER | not a bag item; the mover produced from EMMER at `CMDMC1WATER` (L17884) | CANIBAL1 pots `MC1POT1..5`: puts out the fire (L17639-17855). Afterwards the mover reverts to EMMER (L17888). | – |
| POT | VILLAVOLTA2 ground sprite `VV2OBJGRND` at 236,390, after the sliding puzzle (`$OBJVV2_GRND`, L2243; L22391-22403) | VILLAVOLTA2 fire `CMDVV2VUUR` 303,328,40,35: sets `$VV2_FINISHED2`, ring 5 and the well appear (L22328-22352) | yes |
| PLANK | never placed: `$OBJECT14=$INVPLANK` (L2246) has no `$OBJ...` spot. Its bag picture `VW_PLNK` would show the troll-king code `$TK1_FILE` (L1400). | – (cut content) | – |
| VERGROOTGLAS (magnifying glass) | STERRENKAMER sprite `SK1VERGROOTGLAS` 291,371. It goes straight onto the mouse, not into the bag (L5146-5160). | Sterrenkamer fax, map and two books: full-screen reading only (L6520-7050) | used up per view; can be taken again |
| TWINKEL (magic dust) | Flask `INVTFLES` in the bag (163,422), 5 charges. Refilled at `CMDSK1MACHINE` (L6183-6346). | Rattar: drop it on him (L2578). The bell trip home costs one charge (L7165-7166). Taking it from the flask spends the charge at once (`TWINKEL #USED`, L2008). | 1 charge per use |
| Helper PARDOTJE | STERRENKAMER cabinet trigger PARDOT (L5179-5185) | VOCSCHIP2 stairs: gives ZAAG (L11823-11824) | no |
| Helper PIETERTJE | STERRENKAMER `CMDSK1_PIT` 387,236,30,40 (L7129-7139) | FATAMORGANA2 hatch: gives DEURRING (L12964-12965) | no |
| Helper PADDELTJE | STERRENKAMER `CMDSK1_PAD` 195,229,30,40 (L7115-7125) | DOOLHOF3 `CMDDH3OVERGANG` 110,355,60,35: raises the stepping stone, sets `$DH3_FINISHED1` (L19067-19074) | no |
| Helper PARDIJNTJE | STERRENKAMER cabinet trigger PARDIJN (L5187-5193) | DRAAK1 chest (1st step): calms the dragon, sets `$DR1_FINISHED1` (L21579-21585) | **yes** (REMOVEMOVER clears `$INVHELP`) |
| KRING1..8 (rings) | SS3 (KRING1), PY2 (KRING2), MC1 (KRING3), DR1 (KRING4), VV2 (KRING5), VC2 (KRING6), DH3 (KRING7), FM2 (KRING8) (`[KRING]`, L2061-2225) | STERRENKAMER ring panel (section 4.16) | stay in the bag (`$KRINGn` is not cleared by placing) |

The complete list of drop checks (`If $INVMOVER=...`) was extracted with a single grep. There are 27 targets: RATTAR (L2578), the Sterrenkamer reading targets (L6523-6962), CMDOT1STARTEN, VC2TRALIES, VC2OBJTRAP, VC2KANON, CMDFM1toFM2, FM2DEUR, CMDFM2OBJLUIK, P1BOOT, CMDSS2toSS3, CMDCF1AAP, MC1POT1..5, CMDMC1WATER, CMDDH1HEK, CMDDH3OVERGANG, DR1KOP, CMDDR1RUILSTEEN, CMDVV1OPENDEUR and CMDVV2VUUR. No other drop targets exist.

## 4. Puzzles and minigames

Random choices of the form "SUBRANDOM n" never pick the same number twice in a row; the last pick is remembered across runs (registry in the original, script-core.md s5.3.3). **New-game randomisation:** `INIT #CREATEGAME` (L831-843) calls MAKEPUZZEL of EINDSPEL1, SPOOKSLOT1, SPOOKSLOT3, ELFJES2, DOOLHOF3, VEERMAN1 and TROLLENKONING1. Each of those picks its variant once per game. A bot can always read the chosen variant from the variables listed below (debug build).

### 4.1 PYTHON1: memory "which piece fits" (Ruigrijk)
- **Start.** The puzzle runs automatically on entry while `$PY1_FINISHED` is false. Timer `PY1_TIMERSTART` fires after 1.5 s (L9163), then `#START` (L9212) sets `$PY1_TRYCNT=3` (L568) and `$PY1_SOLVED=0`.
- **Each round** (`#CREATEPUZZEL`, L9252-9266):
  - `SUBRANDOM 6 PUZZEL` picks the picture and its correct piece (L9462-9496).
  - Two wrong pieces are picked; they may be identical (L9498-9576).
  - `SUBRANDOM 6 RECT` places the correct piece in slot `$PY1_PUZ_OKPOS` (L9404-9460): RECT1/2 give 1, RECT4/5 give 2, RECT3/6 give 3.
  - Slots are 72x72 at 545,100 / 545,191 / 545,282.
- **Timing.** After 5 s (L9265) the pieces are covered and the answer Commands `CMDPY1_SOLVE1..3` appear at the slot rects (L9284). A 300 ms countdown (L9294, L9300) gives about **5.7 s** to answer. No answer counts as a mistake.
- **Answer** (L9578-9600, L9314-9336):
  - Clicking `CMDPY1_SOLVE<$PY1_PUZ_OKPOS>` adds 1 to `$PY1_SOLVED` (L9324).
  - Any other click, or a timeout, subtracts 1 from `$PY1_TRYCNT` (L9330).
- **Solution.** Win 3 rounds (`$PY1_TOSOLVE=3`, L569) before 3 mistakes. Click (581, 136 / 227 / 318) according to `$PY1_PUZ_OKPOS`.
- **Lose.** `$PY1_TRYCNT=0` runs `#GAMEOVER` (L9355): Pardoes is sent back to KPRUIG. Nothing is lost; the next visit restarts the puzzle.
- **Finished.** `$PY1_FINISHED=$TRUE` (L9360), then an automatic move to PYTHON2. There the ring Command `PY2KRING` (236,376,60,60) gives KRING2 (L9786-9804, L9931-9942, L2072-2079).

### 4.2 OLDTIMER2: "Tuffer" driving game (Ruigrijk)
Engine side: graphics.md D2. Script facts below.

- **Start.** DXSCREEN `DXTUFFER` (L10316): world 5120x480, the car `OT2TUFFER` at screen 346,300, the world scrolls from x=4480 toward 0.
  - `DX SPEED -1` (L10378): the car starts rolling at once.
  - `$OT2_TIJD=100` (L448, L10376). A 300 ms timer (L10377, `#TICK` L10387) subtracts 1, so the fuel lasts **30 s**.
- **Controls** (L10371-10374, handlers L10461-10475):

  | Command | Key | RECT | Effect |
  |---|---|---|---|
  | `CMDAUTOSNEL` | LEFT | 0,230,40,30 | faster |
  | `CMDAUTOSTOP` | RIGHT | 80,230,40,30 | slower / reverse (up to +3) |
  | `CMDAUTORECHTS` | UP | 45,185,30,40 | toggles up / stop |
  | `CMDAUTOLINKS` | DOWN | 45,265,30,40 | toggles down / stop |

  The bot must reach speed at least 3 early. At speed 1 the track takes about 75 s, more than the fuel allows.
- **Obstacles** (`#COLIDE`; every collision stops the car):

  | Obstacle | Lines | Effect |
  |---|---|---|
  | `OT2_PUT` (pit, world x 4416-4596) | L10501 | **LOOSEPUT** |
  | `OT2_SPIJKER` (nails) | L10509 | **LOOSE** |
  | `OT2EGEL` (moving hedgehog, x 2800) | L10485 | **LOOSE** |
  | `OT2_KUIL`, `OT2_VBOVEN`, `OT2_VONDER`, `OT2_ROTS`, `OT2_KEI`, `OT2_BOOM`, `OT2RATTAR` | L10478-10541 | bump only |

  Safe corridors are given in graphics.md D2.7. The car starts at y=300 and **hits the pit unless it moves up at least 3 px**.
- **Outcomes** (`[DXTUFFER]`):

  | Event | Line | Cause | Next screen |
  |---|---|---|---|
  | `#WIN` | L10544 | left end reached | OLDTIMER3 (no flag set) |
  | `#LOOSE` | L10551 | time out, nails, hedgehog | OLDTIMER1. The car still runs, so retry immediately. |
  | `#LOOSEPUT` | L10558 | pit | DEPUT. A random way out follows; nothing is lost. |

- **No finished flag.** Progress is simply being in OLDTIMER3.

### 4.3 VOCSCHIP1: planks (Ruigrijk)
- **Pieces.** Eight loose plank sprites `VC1PLANG1..8` (`EXTRA=COMMAND`) at -50,132 / 4,374 / 17,390 / 0,419 / 56,438 / 392,396 / 395,402 / 583,208 (L11260-11367).
- **Placing.** Click a plank to pick it up (`$VC1_CMD`, `$VC1_MOVER`), then click the gangway `CMDVC1PLANKIER` (250,180,145,165, L11210). Each placement shows the next rung (`#NEXT` L11147-11192, counter `$VC1_DONE`).
- **No order is checked.** Any 8 planks in any order work.
- **Errors.** Clicking the gangway with nothing in hand gives `#FOUT` (no penalty). Clicking empty space (`CMDVC1SCREEN #UNDO`) drops the held plank.
- **Reset.** `$VC1_DONE` resets on every visit (L10790), so all 8 must be placed in one visit.
- **Finished.** `$VC1_FINISHED=$TRUE` (L11193) creates `CMDVC1toVC2`.

### 4.4 VOCSCHIP2: ship item chain (Ruigrijk)
1. Door `VC2DEUR` (sprite 572,218) opens and reveals `VC2OBJDEUR`, which gives LUCIFER. Opening the door also removes the bell hotspot that covers the object (L11794).
2. Hatch `VC2LUIK` (228,285) reveals `VC2OBJLUIK`, which gives STEEN.
3. Drop helper PARDOTJE on the stairs `VC2OBJTRAP` (515,320). This gives ZAAG (L11823-11824).
4. Mast door `VC2MASTDEUR` (152,298) is a toggle. UNCERTAIN whether it must be open to reach the bars.
5. Drop ZAAG on the bars `VC2TRALIES` (162,300). This sets `$VC2_FINISHED` (L11760).
6. Click the ring `VC2KRING` (164,314). It only works after step 5; it gives KRING6 (L11768-11782, L2132-2139).

The cannon (`VC2KOGEL1..3` + LUCIFER, L11673-11895) is cosmetic.

### 4.5 FATAMORGANA1/2: mirror, jug, hatch, door (Anderrijk)
- **Mirror.** Covered in section 3.
- **Jug.** Window `CMDFM2RAAM` (580,45,30,60) sets `$FM2_GOOIRAAM` and drops the jug `FM2OBJKRUIK`, which gives SLEUTEL (L12894-12905).
- **Basket.** `FM2MAND` (446,227, Level 5) covers the hatch Command `CMDFM2OBJLUIK` (459,244,35,45, Level 4). Click the basket first; it opens 43 px to the right (L12918-12931).
  - Then drop helper PIETERTJE on the hatch at about 472,266. This gives DEURRING.
  - `$FM2_OPENMAND` persists across visits, but the sprite is recreated closed, so the first click after re-entry may close it (UNCERTAIN; read the sprite position).
- **Door and ring.** Drop DEURRING on the door `FM2DEUR` (47,96). This sets `$FM2_DEUROPEN` (L12944). Then click `FM2KRING` (68,150) for KRING8 (L12951-12957, L2151-2158).

### 4.6 VEERMAN1: word puzzle (Anderrijk)
- **Setup.** `MAKEPUZZEL` (L13112) picks one of six words into `$VM1_PUZZEL`, once per game:

  | Variant | Word | Line |
  |---|---|---|
  | PUZZEL1 | OVERSTEKEN | L13116 |
  | PUZZEL2 | OVERZIJDE | L13119 |
  | PUZZEL3 | BOOTJEVAREN | L13122 |
  | PUZZEL4 | MAGIKOVER | L13125 |
  | PUZZEL5 | DEOVERKANT | L13128 |
  | PUZZEL6 | OVERVAREN | L13131 |

- **Board.** Bitmap `VM1_PUZZLE`, `FX=PUZZLE PUZZLE=WORD SIZE=60,8 REF=$VM1_PUZZEL` (L13095). The letter tiles sit in one row at y=27. `#SCRAMBLE` (L13160-13161) randomises their x positions within 80..530.
- **Engine rule** (graphics.md, word puzzle). A drop is accepted if |dy|≤8 and the tile stays within x 40..620. After every accepted drop, the tiles are sorted by x. If the letters spell the word, `[VM1_PUZZLE] #SOLVED` fires.
  - There is no error state.
  - If the scramble already spells the word, at least one drop is still needed.
- **Finished** (L13311-13349):
  - `$VM1_FINISHED=$TRUE` (L13313);
  - **`$OBJPI1_BOOT=$INVPEDDEL`** (L13314), which places the paddle at PIRANHA1;
  - the ferry animation, then automatic travel to PIRANHA1.

### 4.7 PIRANHA1: tree trunk and boat (Anderrijk)
- **Map.** The trunk map `P1STAM.MAP` is E,8,8,8,8,8,8,8,S. It has no sinking stones.
- **Going out to the rock:**
  1. Click `PSTAMSTART` (50,420,150,40, L13795-13826) to jump on.
  2. Click the stones `PSTAM07` to `PSTAM01` in turn. Approximate centres: 135,406 / 167,375 / 107,350 / 97,297 / 95,275 / 105,257 / 94,239.
  3. Click `PSTAMEND` (20,210,100,20) to stand on the rock. This enables `CMDPI1OBJROTS` (L13827-13840).
- **Trap.** Clicking `PSTAMAK` (centre about 117,321) while on the trunk makes Pardoes fall into the water. He is reset to the bank and loses nothing (L13764-13790).
- **Coming back.** Retrace the steps in reverse.
- **Boat** (`P1BOOT`, L13702-13752):
  - POMP inflates it and sets `$PI1_FINISHED` (L13720).
  - PEDDEL then starts the ride.
  - Wrong order or a wrong item gives WRONGDROP.
- **Overlap.** The paddle Command (440..520 x 440..480) overlaps the deflated boat. Drop the pump at about 590,430.

### 4.8 PIRANHA2..2E: piranha boat ride (Anderrijk)
- **Structure.** Six segments: PIRANHA2, 2A, 2B, 2C, 2D, 2E. Each lasts about 15 s with 3 piranha attacks (`TIMERGAME` 5 s, `$P2COUNT=4`, L14017-14028, L14060).
- **Controls** (`CMDPI2toPI2 #CREATE`, L14151-14155):

  | Command | RECT | Key | Effect |
  |---|---|---|---|
  | `CMDBOOTL` | 260,40,40,27 | LEFT | move left |
  | `CMDBOOTC` | 300,40,40,27 | `5` | stop. The key is inert because "5" is not a recognised key name. |
  | `CMDBOOTR` | 340,40,40,27 | RIGHT | move right |

  The boat moves 10 px per frame within `$P2BAREA`.
- **Attacks.** The fish appears at a random x on `$P2AREA` and jumps. The direction alternates (`SUBRANDOM 2`, L14041).
- **Bite.** A bite is a collision between the fish hit box (+12,3,32,50) and the boat hit box (28,15,130,90): `[P2PIRANHA] #COLIDE` (L14033), then `PVAARBOOT #BIJT` (L13951), which adds 1 to `$PI2_BITECNT`.
- **Lose.** The 4th bite (`$PI2_MAXBITES=4`, L521) runs `#SINK` (L13961). Pardoes ends up wet in PIRANHA1, `#FROMPIW` resets `$PI1_FINISHED` to false (L13547-13550), and the boat must be pumped again. POMP and PEDDEL stay in the bag.
- **Counter reset.** `$PI2_BITECNT` is reset only by `P2PIRANHA #CREATE` (L13985), which runs at ride start and on every KPANDER visit.
- **Win.** Survive the end of segment 2E. `CMDPI2toPI2 #DONE` (L14142) creates PIRANHA3. No flag is set.

### 4.9 PIRANHA3 (Anderrijk)
- Click `PI3OBJGRND` for SLINGER.
- Click `CMDPI3open` (145,387,50,30), then `CMDPI3toKPANDER`.
- **Bug** (L2458): the existence check tests the misspelled `$OBJPI3_GROND`, so the object sprite is created on every visit, even when the spot is empty.

### 4.10 SPOOKSLOT1: four stones (Anderrijk)
- **Stones.** `CMDSTEEN1..4` are on/off Commands (L14872-14875):

  | Stone | RECT |
  |---|---|
  | 1 | 130,327,80,84 |
  | 2 | 389,321,100,95 |
  | 3 | 460,323,96,110 |
  | 4 | 536,353,88,94 |

  Each click flips `$SS1_STEENn` (0/1) and runs `#CHECKSTONES` (L15086-15105). All four start at 0 and keep their state across visits.
- **Variants.** `MAKEPUZZEL` (L15046) picks one, and exactly two stones must be ON:

  | Variant | Line | Stones ON |
  |---|---|---|
  | PUZZEL1 | L15050 | 1+2 |
  | PUZZEL2 | L15056 | 3+4 |
  | PUZZEL3 | L15062 | 1+3 |
  | PUZZEL4 | L15068 | 2+4 |
  | PUZZEL5 | L15074 | 1+4 |
  | PUZZEL6 | L15080 | 2+3 |

  Target values are in `$SS1_STEEN1..4_VAL`. Click order does not matter.
- **Wrong combination.** No penalty (`#CHECKNOK`, L15114). The bridge-closing call is disabled (L15116).
- **Brute force** from all-OFF: 1,2,1,3,2,4,3,1,4,3,1,3,2,4. Stop as soon as the puzzle is solved.
- **Finished.** `$SS1_FINISHED=$TRUE` (L15108). `#OPENBRUG` creates `CMDSS1toSS2`.
- **Hint.** No in-game hint for the combination was found. `CMDSS1_KLIK1..6` are cosmetic.

### 4.11 SPOOKSLOT2: torch (Anderrijk)
- Drop LUCIFER on `CMDSS2toSS3` (560,270,40,50). This sets `$SS2_FINISHED` (L15427), consumes LUCIFER (L15429), plays the light-up animation and goes to SPOOKSLOT3.
- A plain click gives WRONGDROP (L15422).

### 4.12 SPOOKSLOT3: tile field and ghosts (Anderrijk)
- **Map variants.** `MAKEPUZZEL` (L15741) picks `SS3_HOF1..6.MAP` (L15745-15756). **HOF2 to HOF6 are byte-identical** (checked with md5), so there are only two layouts.
- **Map cells.** `8` = safe tile, `0` = sinking tile, `S` = start row, `E` = goal. There are 71 tile sprites, TEG10..TEG92 (L15626-15702).
- **Moving.**
  - Click `TEGSTART` (200,440,300,30) to jump on (`#STARTSPRING`, L16206).
  - Then click an adjacent tile. That fires `[TEG] #ENTER` (L16177). Neighbouring `0` tiles sink and cannot be clicked, so **the field itself cannot be failed**.
  - Clicking `TEGSTART` again goes back to solid ground.
- **Shortest routes.** Click points are sprite Start plus the AFFECTPOS centre.
  - **HOF1**, 23 tiles: TEG88 (212,423), 76 (161,384), 65 (239,350), 66 (293,348), 54 (348,315), 55 (398,315), 69 (460,351), 82 (529,385), 71 (561,350), 59 (588,315), 44 (518,287), 30 (499,261), 15 (451,236), 28 (424,261), 13 (380,236), 12 (343,237), 25 (306,261), 38 (253,287), 37 (208,286), 50 (142,315), 49 (88,317), 34 (65,286), 20 (90,260). Then TEGEND (187,232).
  - **HOF2-6**, 14 tiles: TEG91 (420,423), 81 (469,384), 70 (513,353), 58 (541,316), 45 (561,285), 30 (499,261), 29 (461,260), 14 (414,237), 13 (380,236), 26 (345,259), 25 (306,261), 38 (253,287), 37 (208,286), 22 (174,261). Then TEGEND.
- **Ghosts.**
  - `SPOOK1..3` and `KSPOOK` start with collisions OFF (`#STARTSPOKEN`, L15725-15738).
  - Collisions are switched **on only by clicking `TEGEND`** (145,220,85,25; L16223-16232). Any tile click switches them off again (L16181-16184).
  - A collision with SPOOK1/2/3 runs `PARDOES #EINDE` (L16028, L16059, L16090). That is **game over with a full reset**.
  - A collision with KSPOOK, the ghost that visibly carries the ring, is the win (L16118-16141): the ghosts vanish, `CMDSS3EXIT` appears, and the ring `SS3KRING` (144,156) is created if `$KRING1` is not set.
- **Timing** (from the .SPR data, UNCERTAIN):
  - Ghosts fly right from x=20.
  - First passes: SPOOK2 at about 9 s, KSPOOK at about 20 s, SPOOK3 at about 30 s.
  - The loop repeats about every 39 s.
  - **Recommended:** wait on the last safe tile until the ring ghost is the next ghost to arrive, then click TEGEND. If a plain ghost comes first, step back onto the tile.
- **Finishing.** Click the ring (about 160,175) for KRING1 (L16167, L2112). Then click `CMDSS3EXIT`. There is no `$SS3_FINISHED`.

### 4.13 CARNAVAL2: jigsaw (Reizenrijk)
- **Pieces.** 17 moveable bitmaps, `CF2_STUK01..17` (L16986-17002). The `Rect=` value of each is its home position:

  | Piece | Home x,y | Piece | Home x,y | Piece | Home x,y |
  |---|---|---|---|---|---|
  | 01 | 4,262 | 07 | 239,268 | 13 | 159,343 |
  | 02 | 80,237 | 08 | 314,251 | 14 | 227,357 |
  | 03 | 224,220 | 09 | 433,266 | 15 | 232,396 |
  | 04 | 368,229 | 10 | 2,324 | 16 | 361,373 |
  | 05 | 45,276 | 11 | 39,369 | 17 | 494,356 |
  | 06 | 146,251 | 12 | 108,388 | | |

- **Start.** Every entry while unsolved scatters all pieces into x 501..600, y 201..440: `BITMAP Value=Randomize Target=500,200,100,240` (L17062-17064).
- **Snapping** (graphics.md A.9.1). A piece dropped within |dx|≤3 and |dy|≤2 of its home snaps in and locks (`#PIECEOK`, L17129). Otherwise `#PIECENOK` (L17133).
- **Solution.** Order does not matter.
- **Finished.** `[CF2_STUK] #SOLVED` sets `$CF2_FINISHED=$TRUE` (L17118-17120).
- **Trap.** Clicking `CF2OBJGRND` or `CMDCF2toDP1` before the puzzle is solved runs `#SCRAMBLE` (L17110), which loses all progress.

### 4.14 CANIBAL1: five pots (Reizenrijk)
- **Setup.**
  - `SUBRANDOM 5 MAKE` picks the start positions of the five pot sprites `MC1POT1..5` (L17331-17382). The pots then circle continuously through `$MC1_RECT1..5` (L458-462).
  - Each CREATE resets `$MC1_NEXT=1`, `$MC1_ERROR=0` and `$MC1_FAILED` (L17246-17253).
- **Start.** Click any pot with an empty hand. Pardoes is put into that pot (`#PUTPARDOESINPOT`, L17398-17447) and `CMDMC1WATER` (0,335,150,80) appears.
- **Water.**
  1. Click the Pardoes-in-pot sprite `MC1PARDOES` (L17629). It opens the bag.
  2. Take EMMER.
  3. Click `CMDMC1WATER`. The mover becomes WATER (L17881).
  4. Click a pot. Afterwards the mover reverts to EMMER, so refill before every pot (L17888).
- **Rule.** The pots must be doused in sprite order **MC1POT1, MC1POT2, MC1POT3, MC1POT4, MC1POT5**, the same for every variant.
  - Correct pot: `#OK`, `$MC1_NEXT+1`.
  - A pot later in the sequence than `$MC1_NEXT` (`Operator=LT`, L17657): `$MC1_ERROR+1`, and the fire relights when the pot passes the cannibal (`#COLIDE`).
  - A pot already done costs nothing.
- **Errors.** At 3 errors a hint bitmap appears (L17600). At **5 errors `$MC1_FAILED=$TRUE`** (L17596-17597), and the next pot click runs `PARDOES #EINDE`: **game over** (e.g. L17643). At most 4 errors are survivable.
- **Solved** (L17515-17534). Exit restored, ring sprite `MC1KRING` (133,260).
- **Finished.** Clicking the ring sets `$MC1_FINISHED=$TRUE` (L17622) and `$KRING3` (L2190). If you leave without taking the ring, the pots must be redone next time.
- **Colours** (UNCERTAIN, from palettes). MC1POT1..5 use bitmaps MC1POTP/B/G/Y/R, measured as red / orange / green / blue / purple.

### 4.15 DOOLHOF2/3: maze and buttons (Reizenrijk)
- **Maze map.** `DH2_HOF1.MAP` (L502), a 6x4 grid. Each cell value is a bitmask of open sides: bit0=S, bit1=W, bit2=N, bit3=E (graphics.md D1.11.3).

  ```
  1  8 11  6  9  3
  13 10 14 10  7  4
  13  3  8 11 15  2
  12 14 11 14 14  2
  ```

- **Start and exit.** Start at cell (2,3), facing north. The exit is north of (3,0).
- **Movement.** Commands `FORWARD`, `LEFT`, `RIGHT`, `BACK` (RECTs in section 2.3). Only the open directions of the current view are created (`DH2_<view> #GOCMD`, L18341-18552).
- **Wells.** The dead-end wells are disabled (L18438).
- **Shortest path**, 9 clicks: LEFT, FORWARD, RIGHT, FORWARD, RIGHT, FORWARD, LEFT, RIGHT, LEFT. Expected views: T, TR, R, TR, TR, V, TL, T, L. `$DH2_CURRENTSCREEN` shows the current view. The last click fires `DH2_END`, which goes to DOOLHOF3.
- **DOOLHOF3 crossing.**
  1. Drop helper PADDELTJE on `CMDDH3OVERGANG` (110,355,60,35). This sets `$DH3_FINISHED1` (L19074).
  2. Click `CMDDH3STEEKOVER` (240,320,220,40). This enables the buttons (L19103-19133).
- **Buttons.** `CMDDH3KNOP1..4` (12x22 each, at x 308/322/336/350, y 268; L18861-18864) toggle `$DH3_KNOPn`.
- **Variants.** `MAKEPUZZEL` (L18885) picks one. Target values are in `$DH3_KNOP1..4_VAL`:

  | Variant | Line | Buttons ON |
  |---|---|---|
  | PUZZEL1 | L18889 | 1+2 |
  | PUZZEL2 | L18895 | 3+4 |
  | PUZZEL3 | L18901 | 1+3 |
  | PUZZEL4 | L18907 | 2+4 |
  | PUZZEL5 | L18913 | 1+4 |
  | PUZZEL6 | L18919 | 2+3 |

  There is no penalty for wrong presses.
- **Finished.** `#CHECKOK` sets `$DH3_FINISHED2` (L18946) and creates the ring `DH3KRING` (335,220), which gives KRING7.

### 4.16 STERRENKAMER: ring panel (end of hub)
- **Opening.** Click cabinet trigger KASTLA, then drawer trigger KRING. This runs `SK1_KRINGVULLEN #CREATE` (L5448-5485).
- **Layout.** The panel is set up again on every opening:
  - `DECIDEFOUND` (L5503-5560) shows the found rings in the bottom row (sprites `SK1_KRING1..8`, `$SK1KRINGi`).
  - The order of the bottom row is one of 7 permutations (`SUBRANDOM 7 RPOS`, L5562-5650; table in the hub analysis).
- **Moving rings.**
  - Click a bottom ring to pick it up.
  - Click a circle target `CMDKRINGn`. This runs `CMDKRINGEXCHANGE` (L5866-5911), which puts down, swaps or picks up.
  - A ring put on its own number locks (`$SK1_KRINGn=$TRUE`, e.g. L5925).
  - The full-screen `CMDSK1KRING` returns a held ring.
- **Click points.**
  - Bottom slots: (209,361) (187,383) (236,381) (282,387) (330,392) (371,385) (421,391) (398,364).
  - Targets 1..8: (211,280) (222,248) (248,222) (282,212) (322,211) (360,221) (384,246) (399,278).
- **Solution.** Ring n goes to target n, all 8 in one session. Closing the panel (`CMDSK1KRINGSTOP` 490,330,70,50) loses the placements.
- **Finished.** `$SK1_FINISHED=$TRUE` (L5713). Then `STERRENKAMER #FINISHED` (L5002-5019) creates EINDSPEL1.
  - Setting `$SK1_FINISHED` by hand does nothing, because the checks at L4785-4786 are disabled.

### 4.17 EINDSPEL1: final picture choice
- **Variant.** `MAKEPUZZEL` (L8614-8659) picks one of six. It sets the three pictures `$ES1_FILE1..3` and the correct Command `$ES1_COMMAND`:

  | Variant | Correct Command |
  |---|---|
  | PUZZEL1 | KLIK1 |
  | PUZZEL2 | KLIK2 |
  | PUZZEL3 | KLIK3 |
  | PUZZEL4 | KLIK1 |
  | PUZZEL5 | KLIK2 |
  | PUZZEL6 | KLIK3 |

  The hint picture `$ES1_FILEOK` (es_bordN) was shown when the ring panel closed (L5717-5722).
- **Click rects:**
  - `CMDES1_KLIK1` 215,295,60,40
  - `CMDES1_KLIK2` 322,295,60,40
  - `CMDES1_KLIK3` 434,297,60,40
- **Result.** There is only one try.
  - Correct: `CMDES1GELUKT`, then EINDSPEL2.
  - Wrong: `CMDES1MISLUKT`, then PARDOESEINDE: **game over, full reset** (L8661-8689).

### 4.18 Marerijk puzzles
**TROLLENKONING1 arrows (optional).**
- **Variants.** `MAKEPUZZEL` (L19893) picks a code of 5 arrows (`$TK1_NR1..5`, `$TK1_FILE`):

  | Variant | Line | Arrow code |
  |---|---|---|
  | PUZZEL1 | L19906 | NE, NW, SW, W, E |
  | PUZZEL2 | L19914 | N, SE, S, E, W |
  | PUZZEL3 | L19922 | SE, S, W, N, NW |
  | PUZZEL4 | L19930 | NW, NE, N, S, E |
  | PUZZEL5 | L19938 | S, W, SE, SW, N |
  | PUZZEL6 | L19946 | SW, S, SE, NE, W |

- **Arrow Commands.** `CMDTK1PIJL1..8` are N, NE, E, SE, S, SW, W, NW. Their 30x30 rects start at:

  | Arrow | Rect origin |
  |---|---|
  | 1 (N) | 330,287 |
  | 2 (NE) | 368,297 |
  | 3 (E) | 384,326 |
  | 4 (SE) | 368,355 |
  | 5 (S) | 330,370 |
  | 6 (SW) | 292,355 |
  | 7 (W) | 276,326 |
  | 8 (NW) | 292,297 |

- **Errors** (L19977).
  - The 1st error shows the code bitmap and restarts the sequence.
  - The 2nd error in the same visit drops Pardoes into DEPUT (`#FOUT`, L19851).
  - After solving, every arrow click counts as an error again, so stop clicking.
- **Finished.** `$TK1_FINISHED` (L19878, L19994) is not checked anywhere else, so the whole puzzle is optional.

**ELFJES2 flowers.**
- **Variants.** `MAKEPUZZEL` (L20864, `SUBRANDOM 3`) picks one:

  | Variant | Line | Flower order |
  |---|---|---|
  | PUZZEL1 | L20869 | B2, B4, B6, B8, B1, B3, B5, B7 |
  | PUZZEL2 | L20895 | B5, B8, B1, B2, B4, B3, B6, B7 |
  | PUZZEL3 | L20921 | B3, B7, B8, B5, B6, B4, B2, B1 |

  The order is always tones 1..8 in sequence.
- **Errors.** Mistakes only show after 8 clicks (`#DONEERROR`, L20965). Retries are unlimited.
- **Finished.** `$LF2_FINISHED=$TRUE` (L20982), followed by an automatic exit to ELFJES1. Re-enter ELFJES2 to get `CMDLF2toDR1`.
- **Flower click points** (approximate, per-pixel hit test; UNCERTAIN): B1 (319,127), B2 (375,145), B3 (395,196), B4 (377,247), B5 (319,269), B6 (258,249), B7 (242,199), B8 (264,149).

**DRAAK1 dragon lock.**
- **Steps.** Both are drops on `CMDDR1RUILSTEEN` (312,320,80,30).
  1. PARDIJNTJE: `$DR1_FINISHED1` (L21585). The helper is consumed.
  2. STEEN: `$DR1_FINISHED2` (L21685).
- **Errors.** A wrong drop only makes the dragon snap.
- **Ring.** `DR1KRING` (230,260,60,60) gives KRING4.

**VILLAVOLTA2 sliding puzzle.**
- **Puzzle.** `VV2_PUZZLE`, `FX=PUZZLE PUZZLE=SHIFT SIZE=2,3` (L22235): 2 columns x 3 rows of 80x22 tiles at 233,17.
  - The blank starts bottom-right.
  - The engine shuffles the puzzle with 1000 random slides **on every visit** until it is solved.
  - Cell click centres: x 273/353, y 28/50/72. Clicking a cell in the blank's row or column slides toward the blank.
  - A bot needs a small solver: BFS over 360 states, using the tile positions read from the engine.
- **Finished.** `#SOLVED` sets `$VV2_FINISHED1` (L22302-22303). Then:
  1. Click POT `VV2OBJGRND` to pick it up.
  2. Drop POT on the fire `CMDVV2VUUR`. This sets `$VV2_FINISHED2` (L22350).
  3. Click the ring `CMDVV2KRING` (310,325,32,32) for KRING5.

## 5. Critical path (bot plan)

### 5.1 Ordering

The item chains cross realms:
- SLINGER: Ander to Ruig.
- KAART: Ruig to Reis.
- LUCIFER: Ruig to Ander.
- STEEN: Ruig to Mare.
- SLEUTEL: Ander to Mare.
- BANAAN: Mare to Reis.

There are only 4 slots, a 5th pickup pushes slot 1 back into the scene, and the bag cannot be emptied any other way. The plan below is ordered so that **only dead items are ever pushed out**: SPIEGEL after FM1, and POMP after the ride.

| Phase | Area | Helper to take in the Sterrenkamer | Rings | Bag after the phase (slots 1-4) |
|---|---|---|---|---|
| 0 | Intro, Sterrenkamer | – | – | – |
| A | Anderrijk I: PI1, FM1, FM2, VM1, ride, PI3 | PIETERTJE | 8 | POMP, SLEUTEL, PEDDEL, SLINGER (SPIEGEL was pushed out at PI3) |
| B | Marerijk I: VV1, VV2, ELFJES | – | 5 | POMP, –, PEDDEL, SLINGER |
| C | Ruigrijk: PY1/2, OT1-3, VC1/2 | PARDOTJE | 2, 6 | KAART, PEDDEL, LUCIFER, STEEN (POMP was pushed out at the VC2 hatch) |
| D | Anderrijk II: SS1-3 | – | 1 | KAART, PEDDEL, –, STEEN |
| E | Marerijk II: DR1, TK1 | PARDIJNTJE | 4 | KAART, PEDDEL, BANAAN, – |
| F | Reizenrijk: CF1/2, MC1, DH1-3 | PADDELTJE | 3, 7 | –, PEDDEL, EMMER, – (KAART and BANAAN are consumed) |
| G | Sterrenkamer endgame | – | all 8 placed | – |

### 5.2 Rules that apply to every step

1. **Wait.** After every click, wait until `$CURRENTSCREEN` matches the expected screen and none of the blockers are present (`CMDEXITINPROGRESS`, `CMDENTRYINPROGRESS`, `CMDPROTECTION`, a playing movie).
2. **Rattar** (section 6). He can show up after a screen change into a screen with `$RATTAR_ALLOWED=$TRUE`. Drop the twinkel on him: `takeTwinkel()`, then click the RATTAR sprite (L2578). Keep `$TWINKELLEVEL` above 0 and refill at the Sterrenkamer machine on every hub visit (`CMDSK1MACHINE` 445,268, one click per charge).
3. **Going home.** Prefer the free walk (hub `...toSK` Command 190,440,240,40) over the bell, which costs a twinkel charge.
4. **Variants.** Read the random variants once, right after phase 0:
   - `$VM1_PUZZEL`
   - `$SS1_STEEN1..4_VAL`
   - `$SS3_PUZZELFILE`
   - `$LF2_FILE1`
   - `$DH3_KNOP1..4_VAL`
   - `$TK1_NR1..5`
   - `$ES1_COMMAND`

   The per-visit random values are read live: `$PY1_PUZ_OKPOS`, the jigsaw piece positions, the pot positions, the VV2 tiles, the ring-panel permutation and the piranha position.

Coordinates below are click points. Sprite points are approximate (UNCERTAIN, see section 8).

### Phase 0: intro, then Sterrenkamer
1. **INTRO.** `INTROA.AVI` plays. Wait for it or skip it with a key. The name screen appears (L908-917).
2. Type a name into the edit box at 170,340 (max 15 characters, stored in `$SPELERNAAM`), then press ENTER (`CMDINTROEIND` KEY=ENTER). `INTROB.AVI` plays (L939-941).
3. Click `CMDINTROHAND` at (470,422), or press ENTER. `INIT #CONTINUE` runs: new-game reset and variant choice (L831-843). The screen becomes STERRENKAMER with `$PREVIOUSSCREEN=LEEG`, and the fax intro plays (L4941-4948). Wait until `CMDPROTECTION` is gone.

### Phase A: Anderrijk I (ring 8, SLINGER)
4. **STERRENKAMER.** Click the wall object `SK1OBJMUUR` (~400,340). Result: `$INVENT1=SPIEGEL` (L2352-2355).
5. Click `CMDSK1_PIT` (402,256). Result: `$INVHELP=PIETERTJE` (L7129-7139).
6. Click the chronoscope MOVE zone (~290,270) until `$SK1_RIJK=KPANDER`. From KPMARE that takes 3 clicks (L5356-5378).
7. Click cabinet trigger OPENKAST (~545,261). Within 11 s, click `CMDSKtoKPRANDOM` (602,302). Result: KPANDER.
8. **KPANDER.** Click `CMDKPANDERtoPI1` (585,320). Result: PIRANHA1.
9. **PIRANHA1.** Click `PSTAMSTART` (125,440). Then click the stones 135,406, 167,375, 107,350, 97,297, 95,275, 105,257, 94,239. Then click `PSTAMEND` (70,220). Never click `PSTAMAK` (~117,321).
10. Click `CMDPI1OBJROTS` (70,195). Result: `$INVENT2=POMP`.
11. Go back: `PSTAMEND` (70,220), the stones in reverse order, then `PSTAMSTART` (125,440).
12. `use(POMP, P1BOOT)` at ~590,430, away from the paddle Command. Result: `$PI1_FINISHED=1` and the boat moves to 290,364.
13. Click `CMDPI1toKPANDER` (340,460), then `CMDKPANDERtoFM1` (325,225). Result: FATAMORGANA1.
14. **FATAMORGANA1.** `openBag(); take(SPIEGEL)`. Move the mouse into 280..420 x 180..300 so that FLYOVER changes the mover to SPIEGELFM1, then click (350,240). Result: FATAMORGANA2. The mirror is kept.
15. **FATAMORGANA2.** Click `CMDFM2RAAM` (595,75); the jug falls. Click `FM2OBJKRUIK` (~444,345). Result: `$INVENT3=SLEUTEL`.
16. Click the basket `FM2MAND` (~482,262) so it opens. Then `takeHelper()` and click `CMDFM2OBJLUIK` (~472,266). Result: `$INVENT4=DEURRING`.
17. `use(DEURRING, FM2DEUR)` at ~81,143. Result: `$FM2_DEUROPEN=1` and slot 4 is empty again.
18. Click `FM2KRING` (~90,165). Result: `$KRING8=1`.
19. Click `CMDFM2toVM1` (585,280). Result: VEERMAN1.
20. **VEERMAN1.** Wait for the intro. Drag the letter tiles in row y≈27 so that, read left to right, they spell `$VM1_PUZZEL`. Keep the x values distinct. Result: `$VM1_FINISHED=1`, `$OBJPI1_BOOT=PEDDEL`, and the ferry takes Pardoes to PIRANHA1 automatically.
21. **PIRANHA1.** Click `CMDPI1OBJBOOT` (480,460). Result: `$INVENT4=PEDDEL`.
22. `use(PEDDEL, P1BOOT)` at ~400,400. Result: PIRANHA2.
23. **Ride (PIRANHA2..2E).** For each attack, read the x of the `P2PIRANHA` sprite. Steer with LEFT / RIGHT / `CMDBOOTC` (320,53) so that the boat's hit span (boat x+28..x+158) avoids the fish (x+12..x+44). After 6 segments the game goes to PIRANHA3.
    - If 4 bites happen, Pardoes ends up in PIRANHA1 with `$PI1_FINISHED=0`. Repeat step 12 and step 22.
24. **PIRANHA3.** Click `PI3OBJGRND` (~502,370). Result: SLINGER is added. The bag is full, so SPIEGEL is pushed out to the PI3 spot. Bag is now POMP, SLEUTEL, PEDDEL, SLINGER.
25. Click `CMDPI3open` (170,402), then `CMDPI3toKPANDER` (345,280). Result: KPANDER.

### Phase B: Marerijk I (ring 5, flowers)
26. **KPANDER.** Click `CMDKPANDERtoKPMARE` (121,411). Result: KPMARE.
27. **KPMARE.** Click `CMDKPMAREtoVV1` (495,275). Result: VILLAVOLTA1.
28. **VILLAVOLTA1.** `use(SLEUTEL, CMDVV1OPENDEUR)` at (332,332). Result: `$VV1_FINISHED=1`. Then click `CMDVV1toVV2` (332,332). Result: VILLAVOLTA2.
29. **VILLAVOLTA2.** The room flips. Solve the 2x3 sliding puzzle; the cells are at x 273/353 and y 28/50/72. Result: `$VV2_FINISHED1=1`.
30. Click `VV2OBJGRND` (236,380) to pick up POT. `use(POT, CMDVV2VUUR)` at (323,345). Result: `$VV2_FINISHED2=1`. Click `CMDVV2KRING` (326,341). Result: `$KRING5=1`.
31. Click `CMDVV2toVV1` (320,460), then `CMDVV1toKPMARE` (340,460). Result: KPMARE.
32. Click `CMDKPMAREtoLF1` (185,245), then `CMDLF1toLF2` (335,255). Result: ELFJES2.
33. **ELFJES2.** Click the 8 flowers in the variant order (section 4.18). Result: `$LF2_FINISHED=1`, and Pardoes is taken back to ELFJES1 automatically.
34. Click `CMDLF1toKPMARE` (300,460), then `CMDKPMAREtoSK` (310,460). Result: STERRENKAMER.

### Phase C: Ruigrijk (rings 2 and 6)
35. **STERRENKAMER.** Refill the twinkel flask at the machine (445,268) until `$TWINKELLEVEL=5`. Click cabinet trigger PARDOT (~593,327). Result: `$INVHELP=PARDOTJE`.
36. Click the chronoscope until `$SK1_RIJK=KPRUIG`. Open the cabinet and click `CMDSKtoKPRANDOM`. Result: KPRUIG.
37. **KPRUIG.** Click `CMDKPRUIGtoPY1` (365,240). Result: PYTHON1.
38. **PYTHON1.** Play 3 winning rounds. In each round, about 5 s after the pictures appear, click (581, 136 / 227 / 318) according to `$PY1_PUZ_OKPOS`, within about 5.7 s. Result: `$PY1_FINISHED=1`, then PYTHON2.
39. **PYTHON2.** Click `PY2KRING` (266,406). Result: `$KRING2=1`.
40. Click `CMDPY2toOT1` (40,380). Result: OLDTIMER1.
41. **OLDTIMER1.** `use(SLINGER, CMDOT1STARTEN)` at (295,332). Result: `$OT1_FINISHED=1` and SLINGER is consumed.
42. Click `CMDOT1toOT2` (405,300). Result: OLDTIMER2.
43. **OLDTIMER2.** Press LEFT twice or more (speed ≥3). Press UP once to leave y=300 and avoid the pit. Steer through the corridors in graphics.md D2.7.
    - WIN: OLDTIMER3.
    - LOOSE: OLDTIMER1; repeat step 42.
    - LOOSEPUT: a well. Click the well's `...toWORLD` Command, then make your way back to KPRUIG and OLDTIMER1.
44. **OLDTIMER3.** Click `OT3OBJGRND` (~40,305). Result: KAART goes into slot 2.
45. Click `CMDOT3toKPRUIG` (620,220), then `CMDKPRUIGtoVC1` (620,260). Result: VOCSCHIP1.
46. **VOCSCHIP1.** Repeat 8 times: click any loose `VC1PLANGn`, then click `CMDVC1PLANKIER` (322,262). Result: `$VC1_FINISHED=1`.
47. Click `CMDVC1toVC2` (335,155). Result: VOCSCHIP2.
48. **VOCSCHIP2.**
    1. `takeHelper()`, then click `VC2OBJTRAP` (~515,305). Result: ZAAG goes into slot 4.
    2. Click `VC2MASTDEUR` (~170,320) to open it (UNCERTAIN whether this is needed).
    3. `use(ZAAG, VC2TRALIES)` at ~175,320. Result: `$VC2_FINISHED=1`.
    4. Click `VC2KRING` (~174,324). Result: `$KRING6=1`.
49. Click `VC2DEUR` (~590,260) to open the door. Click `VC2OBJDEUR` (~598,348). Result: LUCIFER goes into slot 4.
50. Click `VC2LUIK` (~240,300) to open the hatch. Click `VC2OBJLUIK` (~260,327). Result: STEEN is added and POMP is pushed out to the hatch spot. Bag is now KAART, PEDDEL, LUCIFER, STEEN.
51. Click `CMDVC2toVC1` (320,460), then `CMDVC1toKPRUIG` (220,460). Result: KPRUIG.

### Phase D: Anderrijk II (ring 1)
52. **KPRUIG.** Click `CMDKPRUIGtoKPANDER` (121,411). Result: KPANDER. Then click `CMDKPANDERtoSS1` (40,300). Result: SPOOKSLOT1.
53. **SPOOKSLOT1.** Click each stone whose `$SS1_STEENn_VAL=1`, once each. Stone centres: 1 (170,369), 2 (439,368), 3 (508,378), 4 (580,400). Result: `$SS1_FINISHED=1` and the bridge opens. Do not click any more stones.
54. Click `CMDSS1toSS2` (322,310). Result: SPOOKSLOT2.
55. **SPOOKSLOT2.** `use(LUCIFER, CMDSS2toSS3)` at (580,295). Result: `$SS2_FINISHED=1`, then SPOOKSLOT3.
56. **SPOOKSLOT3.**
    1. Click `TEGSTART` (350,455).
    2. Click the tile route for `$SS3_PUZZELFILE` (section 4.12), ending on TEG20 (HOF1) or TEG22 (HOF2-6).
    3. Wait until the ring ghost (KSPOOK) is the next ghost to arrive, then click `TEGEND` (187,232). If a plain ghost is close, step back onto the last tile.
    4. After the win, click the ring (~160,175). Result: `$KRING1=1`.
    5. Click `CMDSS3EXIT` (160,157). Result: SPOOKSLOT1.
57. Click `CMDSS1toKPANDER` (320,460), then `CMDKPANDERtoSK` (310,460). Result: STERRENKAMER.

### Phase E: Marerijk II (ring 4, BANAAN)
58. **STERRENKAMER.** Refill the twinkel flask. Click cabinet trigger PARDIJN (~563,145). Result: `$INVHELP=PARDIJNTJE`. Set the chronoscope to KPMARE, open the cabinet, and click `CMDSKtoKPRANDOM`. Result: KPMARE.
59. Click `CMDKPMAREtoLF1` (185,245), then `CMDLF1toLF2` (335,255). ELFJES2 is now finished, so `CMDLF2toDR1` exists. Click it at (320,170). Result: DRAAK1.
60. **DRAAK1.**
    1. `takeHelper()`, then click `CMDDR1RUILSTEEN` (352,335). Result: `$DR1_FINISHED1=1`; the helper is consumed.
    2. `use(STEEN, CMDDR1RUILSTEEN)` at (352,335). Result: `$DR1_FINISHED2=1`.
    3. Click `DR1KRING` (260,290). Result: `$KRING4=1`.
61. Click `CMDDR1toVV1` (40,375), then `CMDVV1toKPMARE` (340,460). Result: KPMARE.
62. Click `CMDKPMAREtoTK1` (50,295). Result: TROLLENKONING1. Click `TK1OBJGRND` (~470,390). Result: BANAAN goes into slot 3. **Do not click the arrows**: two errors drop Pardoes into a well. Then click `CMDTK1toKPMARE` (320,460) and `CMDKPMAREtoSK` (310,460). Result: STERRENKAMER.

### Phase F: Reizenrijk (rings 3 and 7)
63. **STERRENKAMER.** Click `CMDSK1_PAD` (210,249). Result: `$INVHELP=PADDELTJE`. Set the chronoscope to KPREIS, open the cabinet, and click `CMDSKtoKPRANDOM`. Result: KPREIS.
64. **KPREIS.** Click `CMDKPREIStoCF1` (50,295). Result: CARNAVAL1. `use(BANAAN, CMDCF1AAP)` at (290,110). Result: `$CF1_FINISHED=1`. Click `CMDCF1toCF2` (370,285). Result: CARNAVAL2.
65. **CARNAVAL2.** Drag each of the 17 pieces to its home position (section 4.13). Do not click the ground object or the well before the puzzle is solved. Result: `$CF2_FINISHED=1`. Then click `CF2OBJGRND` (sprite at 257,141). Result: EMMER is added.
66. Click `CMDCF2toCF1` (240,460), then `CMDCF1toKPREIS` (320,460). Back in KPREIS, click `CMDKPREIStoMC1` (225,245). Result: CANIBAL1.
67. **CANIBAL1.**
    1. Click any pot with an empty hand; Pardoes is put in the pot. Wait for the scene to unlock.
    2. Click `MC1PARDOES` to open the bag, and take EMMER.
    3. For n = 1 to 5: click `CMDMC1WATER` (75,375), then click the current position of sprite `MC1POTn`. Watch `$MC1_NEXT` go up by one each time.
    4. After SOLVED, click `MC1KRING` (~150,280). Result: `$KRING3=1` and `$MC1_FINISHED=1`.
    5. Click `CMDMC1toKPREIS` (285,460). Result: KPREIS.
68. **KPREIS.** Click `CMDKPREIStoDH1` (570,240). Result: DOOLHOF1. `use(KAART, CMDDH1HEK)` at (325,265). Result: `$DH1_FINISHED=1`. Click `CMDDH1toDH2` (325,255). Result: DOOLHOF2.
69. **DOOLHOF2.** Click LEFT (210,310), FORWARD (315,210), RIGHT (420,310), FORWARD, RIGHT, FORWARD, LEFT, RIGHT, LEFT. Wait for the walk animation after each click. Result: DOOLHOF3.
70. **DOOLHOF3.**
    1. `takeHelper()`, then click `CMDDH3OVERGANG` (140,372). Result: `$DH3_FINISHED1=1`.
    2. Click `CMDDH3STEEKOVER` (350,340).
    3. Click each button whose `$DH3_KNOPn` differs from `$DH3_KNOPn_VAL`. Button centres: (314,279), (328,279), (342,279), (356,279). Result: `$DH3_FINISHED2=1`.
    4. Click `DH3KRING` (~350,235). Result: `$KRING7=1`.
71. Click `CMDDH3STEEKTERUG` (340,465), then `CMDDH1toKPREIS` (40,300), then `CMDKPREIStoSK` (310,460). Result: STERRENKAMER.

### Phase G: endgame
72. **STERRENKAMER.** Click cabinet trigger KASTLA (~535,355), then the drawer trigger KRING (~530,340). Result: the ring panel opens.
73. Repeat 8 times: click bottom slot i, then target `CMDKRING<n>`, where n is the number in `$SK1KRINGi`. Click points are in section 4.16. Result: `$SK1_FINISHED=1`, the hint picture is shown, then EINDSPEL1 starts with `ENDPRE.AVI`.
74. **EINDSPEL1.** Click `CMDES1_KLIK<$ES1_COMMAND>`: KLIK1 (245,315), KLIK2 (352,315), KLIK3 (464,317). Result: EINDSPEL2 with `ENDPOST.AVI` and the diploma. A wrong click means game over.
75. **EINDSPEL2.** Click `CMDES2PRINT` (504,408) to print, or click anywhere else. Result: CMDEXITTITEL (credits).
76. **CMDEXITTITEL.** Click anywhere or press ESC. Result: `Exit`; the program ends (L7281).

**Completion checks:**
- After step 73: `$KRING1..8=1`, `$SK1_KRING1..8=1`, `$SK1_FINISHED=1`.
- All of these flags are set: `$PY1/$OT1/$VC1/$VC2/$VM1/$PI1/$SS1/$SS2/$CF1/$CF2/$MC1/$DH1/$LF2/$VV1_FINISHED`, `$DH3_FINISHED1/2`, `$DR1_FINISHED1/2`, `$VV2_FINISHED1/2`.
- `$TK1_FINISHED` stays 0 because the arrow puzzle is optional.
- Exception: `$PI1_FINISHED` may be 0 if the ride was lost and the boat not re-pumped.

## 6. Game over, lose conditions and Rattar

### 6.1 Real game over (`PARDOESEINDE`, L8167-8187)

`PARDOESEINDE` plays `GAMEOVER.AVI` (L8176-8178), runs `TIMERS #DISABLE`, destroys the current screen, and calls `INIT #CREATEGAME` (L8181). That call resets the bag, the rings, every finished flag, the objects and all puzzle variants. The game then restarts in the STERRENKAMER with the fax intro, because SETVARS sets `$PREVIOUSSCREEN=LEEG` (L854).

What survives the reset: `$SK1_RIJK`, `$PUTNR`, `$SPELERNAAM`, and the "never the same twice" memory of SUBRANDOM.

Every way to reach it:

| Trigger | Lines | How to avoid it |
|---|---|---|
| SPOOKSLOT3: SPOOK1, SPOOK2 or SPOOK3 collides with Pardoes, calling `PARDOES #EINDE` (L4125-4131) | L16024-16028, L16055-16059, L16086-16090 | Ghosts only collide after a `TEGEND` click (L16229-16232). Click `TEGEND` only when the ring ghost KSPOOK is the next ghost to reach Pardoes. |
| CANIBAL1: the 5th wrong pot sets `$MC1_FAILED`, and the next pot click runs `PARDOES #EINDE` | L17596-17597, e.g. L17643 | Douse the pots in the order MC1POT1..5. Re-dousing a finished pot costs nothing. |
| EINDSPEL1: wrong picture (`CMDES1MISLUKT`) | L8685-8689 | Click `CMDES1_KLIK<$ES1_COMMAND>`. |
| `CMDEXITtoSK #AFGELOPEN` | L7150-7155 | Dead code: nothing calls it. |
| TEST menu `CMDTGO1` | L7909-7913 | Unreachable in normal play. |

`PARDOES #PRAATGAMEOVER` (L3157) is a voice section that nothing calls.

### 6.2 Setbacks that are not game over

| Where | Trigger | Consequence | Lines |
|---|---|---|---|
| PYTHON1 | 3 mistakes or timeouts | Sent back to KPRUIG; the puzzle restarts on the next visit | L9338-9358 |
| OLDTIMER2 | fuel at 0 (30 s), nails, hedgehog | Back to OLDTIMER1. The car still runs, so you can retry. | L10381, L10485-10515, L10551 |
| OLDTIMER2 | the pit | DEPUT, then a random world | L10501-10507, L10558, L8531 |
| PIRANHA1 | clicking `PSTAMAK` while on the trunk | Pardoes falls into the water and is reset to the bank | L13764-13790 |
| PIRANHA2..2E | 4th bite | Back to PIRANHA1; the boat is deflated (`$PI1_FINISHED=0`) | L13951-13969, L13547-13550 |
| TROLLENKONING1 | 2nd wrong arrow in one visit | Pardoes falls to DEPUT | L19977-19990, L19851 |
| CARNAVAL2 | clicking the ground object or the well before the jigsaw is solved | All pieces are re-scrambled | L17110, L17137-17190 |
| VOCSCHIP1, ring panel, VV2 | leaving mid-puzzle | Progress is lost: `$VC1_DONE` reset (L10790), panel placements reset (L5503-5527), VV2 reshuffled each visit | – |
| CANIBAL1 | leaving after SOLVED without taking the ring | The whole pot puzzle repeats | L17622 |
| Rattar | not chased away | One bag item is stolen and re-hidden (6.3) | L2738-2752 |

### 6.3 Rattar (the rat thief)

- **When he can appear.** Every `DONEXTSCREEN` runs `RATTAR #INCREASE` (L1134, L2786-2792). `$RATTAR_APPEAR` counts up to `$RATTAR_APPEARS` = `$RATTAR_APPEARSDEF` = 5 (L223, L226). After that, every screen change runs `#DOCHECK` (L2794):
  - if the bag is not empty, `SUBRANDOM 3 TRY` runs (L2800);
  - only TRY2 creates Rattar (L2807-2809), and only when `$RATTAR_ALLOWED=$TRUE`;
  - so the chance per screen change is about 1/3, but never the same SUBRANDOM pick twice in a row.

  The counter is reset to 0 only when Rattar leaves (L2661).
- **Screens where he is allowed:**

  | Realm | Screens |
  |---|---|
  | Ruigrijk | KPRUIG, OT1, OT3, VC1, VC2 |
  | Anderrijk | KPANDER, FM2, VM1, PI1, PI3, SS1-3 |
  | Reizenrijk | KPREIS, CF1, DH1, DH3 |
  | Marerijk | KPMARE, TK1, LF1, DR1, VV1 |
  | Wells | DEPUT1/2 |

  He never appears in the Sterrenkamer.
- **What happens** (`#CREATE` L2581-2599). A full-screen Command `CMDRATTAR` (Level 6) appears, scene objects are disabled, and Pardoes speaks. Rattar (sprite `RATTAR`, created in PARDOES `#CREATE` L2977) shows up at one of the six spots in `$RATTAR_RECTLIST` of the current screen. He does this up to `$RATTAR_APPMAX`=3 times (L2706-2764).
- **Defence.** Drop the twinkel on him. This sets `$INVMOVER=TWINKEL` and runs `RATTAR #CLICK` → `#END` → `#DOEND` (L2576-2578, L2720-2736). He is beaten, Pardoes cheers, and the twinkel charge is spent (`TWINKLEUSED`).
- **If not chased away.** After the 3rd appearance `#STOP` (L2738-2752) runs `CMDINVENTORY #MOVEFIRSTAVAILABLE`. The first non-empty slot is taken and placed at the first empty object spot (`OBJECTS #ASSIGNMOVER`, L2248-2343). The item can be found again at that spot.
- **UNCERTAIN.** It is not clear whether the bag can be opened while `CMDRATTAR` (Level 6) covers the screen. The Pardoes sprite is Level 7 and `PARDOES #DISABLE` only stops the idle animations (L2995-3001), so it most likely can. A bot that wants to be safe can hold the twinkel on the mouse in advance.
- **Test switch.** Set `$RATTAR_APPEARS=9999` (an existing variable; `#INCREASE` compares with EXACT EQUAL). Rattar then needs about 10,000 screen changes, so he effectively never comes. This is better than `$RATTAR_ALLOWED`, which every screen `#CREATE` overwrites.

### 6.4 Timers that matter for gameplay

All other timers are cosmetic: the bag sounds, the bell sparkle, the SK1 ring twinkle, the volume fades and the 10 s random events.

| Timer | Lines | Effect |
|---|---|---|
| `SK1DEURTIMER` 11 s | L5085 | The cabinet closes again |
| `PY1_TIMER*` 1.5 s / 5 s / 0.3 s / 3 s | L9163, L9265, L9294, L9321 | Memory game pacing (≈5.7 s to answer) |
| `OT2_TIMER` 0.3 s × 100 | L10377, L10387 | Fuel; LOOSE at 0 |
| `TIMERGAME` 5 s | L14022, L14060 | Piranha attacks; segment end after 3 attacks |
| `EXITTIMER` 4 s | L7296 | Credits picture swap |

## 7. Test shortcuts and debug leftovers

### 7.1 How the browser port enters a section

`?section=ITEM/SECTION` in `pardoes-web/src/game/index.ts` (L66-71) does three things in order:
1. runs the unnamed `[INIT]` section;
2. pumps the VM;
3. runs `ITEM/SECTION`, where SECTION defaults to CREATE.

There are two problems:
- **The intro still starts.** The last line of `[INIT]` is `RUN CREATE INTRO` (L695). So `INTROA.AVI`, the name entry and the full-screen `CMDINTROEIND` run **in parallel** with the jumped-to section. If the bot then clicks through the intro, `CMDINTROHAND` runs `INIT #CONTINUE` a second time (L952).
- **`#CONTINUE` never runs.** `[INIT] #CONTINUE` (L697-752) is skipped. So SYSTEM, PARDOES (the Pardoes and Rattar sprites, cursors, bag bitmaps), the base timers, `INIT #CREATEGAME` (object placement, puzzle variants, machine level) and the step sounds are all missing. A bare `?section=KPRUIG/CREATE` therefore gives a screen with no Pardoes, no bag, and empty `$OBJ...` and puzzle variables.

**Recommended procedure** (needs `&debug` or a dev build, which exposes `__pd`):
1. Load `?section=INIT/CONTINUE&debug`. This gives a proper new game in the Sterrenkamer. Press a key to skip `INTROA`, then run `__pd.vm.runNew('INTRO','DESTROY','')` to remove the name screen and `CMDINTROEIND` (L923-928).
   Alternative: load `?play=1` and play the 3 intro inputs (phase 0 of section 5).
2. Wait until the Sterrenkamer is idle (no `CMDPROTECTION`).
3. Preset the variables with `__pd.vm.vars.setLiteral('$NAME','value')`. This only works for variables that exist; all of them are declared in `[INIT]`. Use the literal values: `1`/`0` for `$TRUE`/`$FALSE`, item ids such as `POMP`, and helper ids such as `PARDOTJE`.
4. **Teleport** with the game's own transition:
   - `$NEXTSCREEN=<target>`
   - `$PARDOESEXIT=NOTHING` (an empty PARDOES section, L4028)
   - `$EXITBYBEL=1`, so the target takes its "arrived by bell" entry. Every screen that has a `fromSk`/`fromBel` branch handles it.
   - then run `__pd.vm.runNew('SYSTEM','DONEXTSCREEN','')`.

   This destroys the current screen properly and sets `$PREVIOUSSCREEN`. Because it is a normal screen change, Rattar can appear (see 6.3), so also set `$RATTAR_APPEARS=9999`.
5. To jump straight into a section of a screen that is already running (for example `VV2_PUZZLE/SOLVED`), use `__pd.vm.runNew(item, section, '')`.

A **suggestion for the port**, not implemented: a `&set=$A=1,$B=X` URL parameter, plus suppressing the `RUN INTRO` when `?section` is given. That would turn steps 1-4 into a single URL.

### 7.2 Per-screen preset table

**Always (base state for any test):**
- Run `INIT #CONTINUE`. This already sets the object spots and the puzzle variants.
- `$RATTAR_APPEARS=9999`.
- `$TWINKELLEVEL=5`.
- Bag slots: fill `$INVENT1..4` from the left.

| Screen | Preset needed to behave like a real playthrough | Direct puzzle / finish sections |
|---|---|---|
| STERRENKAMER, ring panel | `$KRING1..8=1` | `SK1_KRINGVULLEN/CREATE`. `STERRENKAMER/FINISHED` jumps to EINDSPEL1. Setting `$SK1_FINISHED` alone does nothing (L4785-4786 are disabled). |
| EINDSPEL1 | `$ES1_COMMAND`, `$ES1_FILEOK`, `$ES1_FILE1..3`. These are set by CREATEGAME; with a bare entry, run `EINDSPEL1/MAKEPUZZEL` first. | `CMDES1GELUKT/CLICK` (win), `CMDES1MISLUKT/CLICK` (game over) |
| EINDSPEL2 | `$SPELERNAAM` | `CMDES2KLAAR/CLICK` |
| KPRUIG / KPANDER / KPREIS / KPMARE | none | – |
| PYTHON1 | `$PY1_FINISHED=0` | `PYTHON1/GAMEWON` |
| PYTHON2 | `$PY1_FINISHED=1`, `$KRING2=0` | `PY2KRING/CLICK` |
| OLDTIMER1 | `$OT1_FINISHED=0`, SLINGER in a slot | `CMDOT1STARTEN/STARTEN` |
| OLDTIMER2 | `$OT1_FINISHED=1` (so a LOOSE returns sensibly) | `DXTUFFER/WIN`, `/LOOSE`, `/LOOSEPUT` |
| OLDTIMER3 | `$OBJOT3_GRND=KAART` (set by ASSIGN) | – |
| VOCSCHIP1 | `$VC1_FINISHED=0` | – (8 plank clicks) |
| VOCSCHIP2 | `$INVHELP=PARDOTJE`, `$VC2_FINISHED=0`, `$KRING6=0`, one free slot | `VC2TRALIES/GO` (needs ZAAG as mover) |
| FATAMORGANA1 | SPIEGEL in a slot | – |
| FATAMORGANA2 | `$INVHELP=PIETERTJE`, `$FM2_GOOIRAAM=0`, `$FM2_DEUROPEN=0`, `$KRING8=0` | – |
| VEERMAN1 | `$VM1_FINISHED=0`, `$VM1_PUZZEL` (or run `VEERMAN1/MAKEPUZZEL`) | `VM1_PUZZLE/SOLVED` |
| PIRANHA1 | `$PI1_FINISHED=0/1`; POMP/PEDDEL in the bag or `$OBJPI1_BOOT=PEDDEL` | `P1BOOT/OPBLAZEN`, `P1BOOT/VERTREK` |
| PIRANHA2 (ride) | Run `PWATER/CREATE` first; it loads the water bitmaps (L13471). Set `$PI2_MAXBITES=99` to make the ride unlosable. 2A..2E cannot be entered on their own. | – |
| PIRANHA3 | none (SLINGER spot from ASSIGN) | – |
| SPOOKSLOT1 | `$SS1_FINISHED=0`, `$SS1_STEEN1..4=0`, `$SS1_STEEN1..4_VAL` (or `SPOOKSLOT1/MAKEPUZZEL`) | `SPOOKSLOT1/CHECKOK` |
| SPOOKSLOT2 | `$SS2_FINISHED=0`, LUCIFER in a slot | `CMDSS2toSS3/GO` |
| SPOOKSLOT3 | `$SS2_FINISHED=1` (entering SPOOKSLOT2 then builds SS3), `$SS3_PUZZELFILE`, `$KRING1=0` | `KSPOOK/COLIDE` (ring-ghost win), `SS3KRING/CLICK` |
| CARNAVAL1 | `$CF1_FINISHED=0`, BANAAN in a slot | `CMDCF1AAP/GO` |
| CARNAVAL2 | `$CF2_FINISHED=0` (jigsaw) or `1` (skip), `$OBJCF2_GRND=EMMER` | `CF2_STUK/SOLVED` |
| CANIBAL1 | EMMER in a slot, `$MC1_FINISHED=0`, `$KRING3=0` | `CANIBAL1/SOLVED`, then `MC1KRING/CLICK` |
| DOOLHOF1 | `$DH1_FINISHED=0`, KAART in a slot | `CMDDH1HEK/GO` |
| DOOLHOF2 | `$DH2_PUZZELFILE=DH2_HOF1.MAP` (L502) | `DH2_END/CREATE` goes to DOOLHOF3 |
| DOOLHOF3 | `$INVHELP=PADDELTJE`, `$DH3_FINISHED1/2=0`, `$DH3_KNOP1..4=0`, `$DH3_KNOP1..4_VAL` (or `DOOLHOF3/MAKEPUZZEL`), `$KRING7=0` | `CMDDH3OVERGANG/GO`, `DOOLHOF3/CHECKOK` |
| TROLLENKONING1 | `$TK1_NR1..5`, `$TK1_FILE` (or `TROLLENKONING1/MAKEPUZZEL`) | `TROLLENKONING1/EXPLAIN` (shows the code), `/OK` |
| ELFJES2 | `$LF2_NR*`/`$LF2_NT*`/`$LF2_FILE*` (or `ELFJES2/MAKEPUZZEL`); `$LF2_FINISHED=1` for the DRAAK1 exit | `ELFJES2/DONEOK` |
| DRAAK1 | `$INVHELP=PARDIJNTJE`, STEEN in a slot, `$DR1_FINISHED1/2=0`, `$KRING4=0` | `DR1KOP/GO`, `CMDDR1RUILSTEEN/GO2`, `DR1KRING/CLICK` |
| VILLAVOLTA1 | SLEUTEL in a slot, `$VV1_FINISHED=0` | `CMDVV1OPENDEUR/GO` |
| VILLAVOLTA2 | Phase 1: `$VV2_FINISHED1=0`. Phase 2: `$VV2_FINISHED1=1`, `$VV2_FINISHED2=0`, `$OBJVV2_GRND=POT`. Also `$KRING5=0`. | `VV2_PUZZLE/SOLVED`, `CMDVV2VUUR/GO` |
| DEPUT | `$PUTNR` chooses DEPUT1 (1) or DEPUT2 (0) | `CMDDPtoWORLD/WORLDn` (n=1..10) for a fixed destination |
| PARDOESEINDE | none | `PARDOES/EINDE` (full game over) |

### 7.3 Debug and cheat leftovers in the script

- **`[TEST]` developer menu** (L7327-7511) with the `CMDT*` items (L7513-8166).
  - It has jump buttons to every screen (`#STARTSCHERM`, L7504-7511).
  - It has on/off buttons for the finished flags (`CMDTxxxF1/F2`). Some handlers have item-name typos (L7679, L7747, L7764), and `CMDTVV2F1` tests a non-existent `$VV2_FINISHED` (L7424).
  - Its entry `CMDTEST` (`KEY=F2`, L4790) and handler (L7059-7067) are disabled, so **it is unreachable in the shipped script**.
  - It can be opened in the port with the teleport above: `$NEXTSCREEN=TEST`. The menu's own jumps do not set an entry branch, so Pardoes may not be placed (UNCERTAIN).
- **`CMDDEBUGF2..F9`** (L737-744) are disabled. Their handlers (L1017-1057) do these things:

  | Key | Action |
  |---|---|
  | F2 | force a Rattar check |
  | F3 | thread dump |
  | F4 | thread dump |
  | F5, F6 | volume |
  | F7, F8 | machine colour |
  | F9 | object debug |

- **`INIT #CREATETEST`** (L754-829). The call at L750 is commented out, and L749 reads `rjh Weghalen!!!!` ("remove this"). It holds per-realm test inventories (L779-815) and all-rings presets (L763-778), all disabled. **These are useful as ready-made preset lists for 7.2.**
- **`PROGRAM #CONTINUE` direct jumps** (L1063-1105). These are disabled `aInstruction ... CREATE Name=<screen>` lines, one per screen.
- **`CMDDR1RUILSTEEN #CLICKHAHA`** (L21648-21677). It runs on Ctrl+Shift+click on the dragon chest. It is a gag: the dragon snaps and Pardoes laughs. It skips the normal handler and **sets no variables**, so it is not a progress cheat.
- **`CMDTESTPUZZEL`** (L9105-9109). It rebuilds the PY1 puzzle. Both its creation (L9150, F3) and its kill (L9237) are commented out.
- **Other disabled shortcuts and test values:**
  - `DH2_TEST.MAP` (L503, L18265);
  - DH2 dead-end wells, with a removed jump straight to DOOLHOF3 (L18438, L18470);
  - a disabled auto-award of ring 3 (`ASet $KRING3=$FOUND`, L17516);
  - disabled SS1 penalty (L15116);
  - TK1 `#TEST` variant (L19895-19898);
  - LF2 forced `PUZZEL2` (L20865);
  - Rattar test position lists (L19175-19176);
  - `CMDEINDSPEL` (L6167-6181), created only by the disabled line L5016.
- **Command line in the original EXE** (script-core.md s13): `-TEST` draws the Command hit rectangles, which is handy to compare with the RECTs in this document. `/V` shows the version.

## 8. Uncertainties and open points

### 8.1 Click points and hit testing

- Sprite click points are approximate. Most sprites have no `ALIGN`; their `Start` is the top-left of the current frame, so the frame size comes from the .SPR file and the exact point is UNCERTAIN.
- Sprite trigger zones (cabinet, chronoscope, drawer) were computed from the .SPR trigger areas.
- Some sprites hit-test per pixel (ELFJES2 flowers, CF2 pieces).
- A bot should click by **sprite name and current bounds**, read from the engine, rather than by fixed coordinates. This matters most for moving sprites: the CANIBAL1 pots, the piranha and the ghosts.

### 8.2 Overlapping Commands

The later-created Command wins (graphics.md C.1). Known overlaps:

| Screen | What overlaps | What to do |
|---|---|---|
| KPRUIG | info `CMDKPRG_VC1I` covers the VC1 exit centre | click the exit at 620,260 |
| KPMARE | info Commands sit inside the exits | use the exit centres given in section 2.4 |
| OLDTIMER3 | `CMDOT3toPY1` overlaps the KPRUIG exit | – |
| SPOOKSLOT1 | stone 4 overlaps the FM1 exit | – |
| PIRANHA1 | paddle Command overlaps the boat | – |
| FATAMORGANA2 | basket sprite covers the hatch | open the basket first |
| VILLAVOLTA2 | ring Command is above the well | – |

### 8.3 Timing

- **SPOOKSLOT3 ghosts.** The schedule comes from the .SPR files and is UNCERTAIN: the AtEnd parse and the exact Pardoes rect are not confirmed. A bot should watch the ghost x positions live.
- **OLDTIMER2 corridors.** They come from graphics.md D2.7. It is UNCERTAIN whether the stretch from the nails to the door can be passed without a bump.
- **PIRANHA ride.** Several bites may register per attack before the fish hides (UNCERTAIN).

### 8.4 Possible original bugs a port should reproduce, not fix

| Lines | Bug |
|---|---|
| L2458 | `$OBJPI3_GROND` is misspelled, so the PI3 object is always created |
| L10589 | OLDTIMER3 sets `$DP_RECT` to an empty string, which gives a `CMDEXITtoDP` with an empty RECT |
| L10710 | OLDTIMER3 `#DESTROY` calls `DESTROYKLIKS` of KPMARE |
| L4784 | Sterrenkamer calls the non-existent `CHECKFINISHED`. This only triggers the "failing GOSUB skips the last instruction" quirk |
| L11862 | VC2 hatch object sets the wrong `$INVSPRITEAFFECT` |
| L19399-19400 | KPMARE `#DESTROY` unloads misspelled sound names |
| L19513 | `KPMA_AN1` SUBRANDOM 6 has only 5 targets |

The 8 static dangling references are listed in script-inventory.md s7.

### 8.5 Open questions

- **Magnifying glass sprite.** Its frame bitmap `VWK_VGLAS` is never loaded (hub analysis), so the sprite may be invisible. It is optional.
- **Rattar defence.** Can the bag be opened while the Level 6 `CMDRATTAR` is up? See 6.3.
- **VOCSCHIP2.** Does the mast door have to be open to reach the bars?
- **VOCSCHIP1 plank 1.** It starts at x=-50, so it is partly off screen. All 8 planks are needed, so click its visible part.
- **ELFJES2 → DRAAK1.** The DRAAK1 branch in ELFJES2 `#STARTPARDOES` is dead: DRAAK1 has no exit back.
- **VEERMAN1 random events.** Events 1 and 5 make the ferryman flinch while the puzzle is unsolved. This is cosmetic, but it may move nothing else (UNCERTAIN).
- **Bot counts.** "About 250-300 raw clicks" for the critical path is an estimate. The exact number depends on the jigsaw, the sliding puzzle, the word puzzle, the twinkel refills and the Rattar encounters.
