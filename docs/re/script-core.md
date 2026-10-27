# PARDOES.EXE - script language core (reverse engineering notes)

Game: "Een Wonderlijk Avontuur met Pardoes de Tovernar" (2000, ReHo Productions, MSVC C++, Win32, DirectDraw/DirectSound).
Scope of this document: the script language core, control flow, variables, events/timers, text/edit boxes,
printing, saving and sound. Graphics (Bitmap, Sprite/.SPR, Command regions, OBJECT/inventory, MAP, Movie, DX, cursors,
screen transitions) are documented by the graphics agent; only the *interface points* are listed here (s7).

Companion files
- `script-inventory.md` - generated keyword/parameter inventory of PLAYER.SCR (tool: `tools/scr_inventory.py`).
- `tools/set_sim.py` - executable reference of the variable semantics (s4), runs the `[INIT]` Set statements.
- `tools/engine_sim.py` - executable reference of the whole script core (loader, items/sections/sequences, variables, Set/If/GOSUB/RUN/RUNRANDOM/SUBRANDOM/EXIT, frames with the idx/ptr quirk, FIFO scheduler; graphics/sound are stubs). `python3 -I tools/engine_sim.py PLAYER.SCR --clicks 600 --seed 1` plays INIT -> intro -> Sterrenkamer and random-clicks Commands; use it as a differential oracle for the TypeScript interpreter.

Conventions
- `FUN_xxxxxxxx` = function address in the Ghidra decompile (`decomp-pardoes/Pardoes.c`, headers `// ==== FUN_xxx @ addr`).
  Data addresses are virtual (image base 0x400000; `.data` VA 0x46d000 = file offset 0x6c000).
- **UNCERTAIN** = derived from code reading only / not verifiable without running the game; what was checked is stated.
- "uppercased" = the loader upper-cases every script line (s2.3), so all strings below are compared case-sensitively
  *after* upper-casing; the language is effectively case-insensitive.

## Table of contents
1. Overview and file inventory
2. Loading: container, script file, line reading, classification, tokenizing
3. Program structure: Item / Section / Sequence / Instruction
4. Variables
5. Statement reference: Set, If, Instruction (all types), Exit, other statements
6. Execution model: threads, stepping, blocking, message queue, frame loop
7. Events the engine raises + input handling (interface to the graphics side)
8. Timers (and `TimeLine`)
9. Text: Style, Tekst, EditBox, text resources (`TEKST031.TXT`)
10. Printing (diploma), `PRINTER.RPT`
11. Saving / persistence
12. Sound: Sfx, Instruction SFX, sprite sounds, Wave, DirectSound
13. Debug keys, hidden keys, command line
14. Inventory summary
15. The 10 most important pitfalls for the implementer
16. Reference implementation sketch (TypeScript)
17. UNCERTAIN list and open questions
Appendix A - function index

---------------------------------------------------------------------------------------------------

## 1. Overview and file inventory

PARDOES.EXE is a generic "REHO menu system" interpreter ("REHOMenuSysteem" window class, can also run as screensaver:
`/S /P /C /V` switches, FUN_00404a1e). The whole game is the data-driven script `PLAYER.SCR` (904,936 bytes, 22,7k lines, CRLF, ASCII).
Everything else (BMP, WAV, SPR, MAP, `PRINTER.RPT`, `TEKST031.TXT`, `PLAYER`) is data read **from the archive
`PARDOES.DAT`** that sits next to the EXE. AVI movies and the title music (`MEDIA\PARDOES.WAV`) are loose files in `MEDIA\`.

| file | what it is | how the engine uses it |
|---|---|---|
| `PARDOES.DAT` | archive, 2192 entries | opened by FUN_0046a5ea from `<exe path minus extension>.DAT` (FUN_00404e76); lookup FUN_0046a81f |
| `PLAYER.SCR` | the script | read by FUN_00402522 (s2.2) |
| `PLAYER` (21 bytes) | "Pardoes de Tovernar\r\n" | first line = window title (FUN_00405069); falls back to string resource 1 |
| `PRINTER.RPT` | report layout for the diploma | `Instruction Type=Print Contents=printer.rpt` (s10) |
| `TEKST031.TXT` (28 bytes) | text resource `#HELPESCAPE` / `Escape = Stop` | text lookup for `Tekst Contents=` (s9.4) |
| `ALTZ.EDM` (101 bytes) | a WordPerfect 6 fragment ("\xffWPC9", text "KILL;") | **not referenced** by the engine or the script (stray artifact) |
| `*.SPR`, `*.MAP`, `*.BMP`, `*.WAV` | graphics / sound data | other agent / s12 |
| `MEDIA\*.AVI`, `MEDIA\PARDOES.WAV` | movies, title music | loose files relative to the EXE directory |

Window: 640x480 popup (0x92000000), centered, background not erased; all script coordinates are relative to the 640x480
canvas (the engine adds the centering offsets `DAT_0047a8b0/b4` = (screen - 640/480)/2; in a browser port they are 0).

Startup sequence (FUN_00404e76 -> FUN_00405069 -> WM_CREATE -> first WM_PAINT):
1. parse command line (FUN_00404c08);
2. open `<exe>.DAT` (FUN_0046a5ea, max 5 simultaneously open entries; if the EXE itself contains an RT_RCDATA resource of that name it is used instead);
3. read window title from entry `PLAYER`; create the window;
4. FUN_00402522 loads `PLAYER.SCR` (s2.2) - the whole script is parsed up front;
5. on the **first WM_PAINT** (FUN_004056fd case 0xF, guarded by `DAT_0046e4f0` = 1 and `DAT_0046e0d8` = -1) the engine runs
   `RUN [INIT] #<unnamed section> @<first sequence>` = `FUN_004019f3(-1, "INIT", "", "")` and posts the first step message.
   In PLAYER.SCR `[Init]` is item 1: its unnamed section (lines 2-695, 672 `Set`s, 2 `Uses`, `Style`, `Timer`, `Bitmap`...) ends with
   `Instruction Type=RUN Target=CREATE Name=INTRO`, which starts the intro. (Screensaver preview mode runs item `THUMBNAIL` instead.)

---------------------------------------------------------------------------------------------------

## 2. Loading

### 2.1 Container: `PARDOES.DAT` (FUN_0046a5ea, FUN_0046a81f, FUN_0046b710, FUN_0046a590)
Layout (verified on the file; equivalent to the description "count, dataStart, then name/end pairs"): `u32 count`, then `count` records of 17 bytes `{u32 offset; char name[13]}`.
The **last record is a sentinel** (empty name, `offset` = end of file = 216,187,505), so there are `count-1` = 2191 real files. Entry `i` spans `[offset_i, offset_{i+1})`.
Lookup = `bsearch` over the records with `_strcmpi` on the name (FUN_0046a590 compares `rec+4`): **case-insensitive, exact name, no
directories**. The records are *not* strictly sorted under a plain ASCII sort (the engine's own `strcmpi` order is what matters), so a
port should simply build a `Map<UPPERCASE name, bytes>`.
If the archive is not open the engine falls back to loose files in the current directory (FUN_00402522 branch `FUN_0046a5d3()==0`;
that path is buggy - it prepends `"\."`, i.e. the drive root - so it was never meant to be used).
`DAT_00479c14` (initial 1) is the global "use DAT" switch; FUN_0046a5ab/FUN_0046a5bf clear/set it around loads of *external* files
(`Sfx EXTRA=EXTERNAL`).

### 2.2 The script file (FUN_00402522)
- Entry `PLAYER.SCR` (904,936 bytes at offset 103,731,327) is opened (`-S:name` on the command line replaces the name, `-D:dir` sets `$LANGUAGEDIR`).
- Lines are read with FUN_0046aa55 (DAT) or `fgets(.., 0x3ff)` (loose file). **A DAT "line" is the text up to CR/LF plus ALL
  following CR/LF characters (blank lines are swallowed into the previous line)**; FUN_00415cc0 strips the trailing CR/LFs. A line
  of 1023+ characters makes FUN_0046aa55 return 0 = *end of file*, i.e. loading silently stops (longest line in PLAYER.SCR: 337).
- Every line goes to FUN_00415f71 (s2.3). The whole file is parsed once; there is no include mechanism and no re-reading.
- After loading, `DAT_0047a210` (a linked list of raw lines) and FUN_00402794 (built-in default INIT/SCRIPT/END items) belong to the
  authoring/"film maker" part of the program (Script `Value=CREATE/SAVEAS/TEST` etc., s5.3.6) and are irrelevant at runtime.

### 2.3 Line classification (FUN_00415f19, FUN_00415f71)
1. FUN_00415f19: the **whole line is upper-cased** (`toupper` per byte) and cut at the first CR/LF. (So `$grndPLL` and `$GRNDPLL`, `Sfx` and `SFX`,
   file names, section names, even string literals are the same thing; text typed by the player at run time is *not* upper-cased.)
2. The decision is made with `strncmp(line, prefix, n) == 0`, tested **in this order**; the first hit wins; no hit = the line is ignored:

   1 `[` (n=1) Item; 2 `#` (1) Section; 3 `@` (1) Sequence; 4 `SET` (3); 5 `STYLE` (5) (global record, not an instruction); 6 `BITMAP` (6); 7 `COMMAND` (7);
   8 `EXIT` (n=7: only the **exact line** `EXIT` matches, `strncmp` stops at the NULs); 9 `AREA` (4); 10 `FLYOVER` (7); 11 `TEKST` (5); 12 `INSTRUCTION` (11); 13 `INSTALL` (7);
   14 `QUIZ` (4); 15 `PUZJAPANS` (9); 16 `DXSCREEN` (8); 17 `EXECUTE` (7); 18 `MOVIE` (5); 19 `SFX` (3); 20 `CDAUDIO` (7); 21 `WAVE` (4); 22 `MIDI` (4); 23 `SPRITE` (6);
   24 `TIMER` (5); 25 `TIMELINE` (8); 26 `IF` (2); 27 `LISTBOX` (7); 28 `EDITBOX` (7); 29 `MESSAGE` (7).
   (`tools/scr_inventory.py` contains the same list; FUN_00415f71 is a 29-deep if/else chain.)
3. **Consequences - what is a "disabled" line**: anything whose first characters do not match: a leading `/` or `//` (715 lines), blank lines,
   a prefix letter (`aSet`, `aInstruction`, `qSet`, `tSprite`, `rjh ...`), a leading space or tab (no line in PLAYER.SCR starts with one),
   `Set$ Dummy=` is *not* disabled: it matches `SET` and creates a variable named `DUMMY` (no `$`). Because matching is by prefix, any word starting with a
   keyword is that keyword (`SETX`, `IFX`) and an unclosed `[` still starts an item.
4. No inline comments, no quoting, no escapes, no line continuation.

### 2.4 Tokenizing and `key=value` (FUN_00415dcf, FUN_00415ee3, FUN_00415d25)
- The line is split on **space and TAB** into at most 50 tokens (more = tokenizer returns -1 and the statement gets default values). Token 0 (the keyword) is skipped
  by every statement parser (that is why `Set$ Dummy=` works: token 0 = `SET$`, token 1 = `DUMMY=`).
- A token is split at the **first `=` or space**: key = text before; value = text after the run of `=`. If the value contains another `=`, the value buffer is
  *restarted* (`A=B=C` -> key `A`, value `C`). A token without `=` has key = token and value = "" (flags such as `FX`, `PRINTER`).
- **Values cannot contain spaces** (no quoting). The back-tick is the escape: `Set $X=a`b` stores `a b` (FUN_004167f9 replaces 0x60 by 0x20, applied on assignment, s4).
  A `Set` line may contain several assignments (`Set $A=1 $B=2` = two records); PLAYER.SCR never does.
- Repeated keys: scalar fields (`Name`, `Type`, `Volume`, ...) -> the **last** one wins; `Extra=` values OR their flag bits together (Sfx, EditBox, Command, Bitmap: `EXTRA=NOCLEAR EXTRA=FULLSCREEN`); `Rect=` on Tekst, EditBox and Command **adds** repeated values component-wise (accumulator) - so give `Rect` once.
- Unknown keys: ignored by Instruction, Timer, Sfx, Wave, Tekst, Style; **EditBox shows a message box** ("Onbekende EditBox instructie");
  `If` treats every unknown key as its comparison operand (s5.2).
- Names are limited to **19 characters**: item/section/sequence names are `strncpy`'d into 20-byte fields (FUN_0040105d etc.) and *lookups
  truncate the query to 19 characters as well* (FUN_004011ac, FUN_004013ea, FUN_00401647). No name in PLAYER.SCR exceeds 19.
  Variable names are copied into a 20-byte field without a length check (buffer overflow for longer names; none exist).

---------------------------------------------------------------------------------------------------

## 3. Program structure

### 3.1 Three levels + instructions (FUN_0040105d addItem, FUN_0040126a addSection, FUN_004014b9 addSequence, FUN_00401e19 addInstruction)
```
[ITEM]          item name = line minus first and last character (so the line must end with ']')
#SECTION        section name = rest of the line after '#'  (trailing blanks are part of the name!)
@SEQUENCE       sequence name = rest of the line after '@'
<statement>...  instructions, appended to the current sequence
```
- Instructions are stored as `{name[20], type, ptr}` records (0x1c bytes). Statement parse functions fill their own object and register it with
  addInstruction(type): Bitmap 1, Command 2, Area 3, Flyover 4, Tekst 5, Movie 6, Wave 7, Sfx 8, CdAudio 9, Execute 10, Instruction 0xD, Midi 0xE, Sprite 0xF,
  ListBox 0x10, EditBox 0x11, Message 0x12, Install 0x13, Timer 0x14, If 0x15, Set 0x16, Quiz 0x17, TimeLine 0x18, Puzzle 0x19, DxScreen 0x1A, Exit -1.
  `Style` creates no instruction (it fills the global style table at parse time).
- A `[ITEM]` line creates an item and resets "current section/sequence". A `#SECTION` creates a section in the current item and resets "current sequence".
  The first instruction after a `#` creates an **implicit unnamed sequence** (name ""); after `@NAME` instructions go into that sequence.
  Statements before any `[` create an unnamed item and section. A line `#` (just the hash) or `@` is the unnamed section/sequence.
  Lines between `[Init]` and its first `#` therefore form the **unnamed section** of INIT (that is what `RUN INIT` runs).
- **Duplicates**: every `[X]`/`#X`/`@X` appends a new record, but lookups return the *first* record with that name, so a second block with
  the same name is dead code (PLAYER.SCR: 1 duplicate, `PYTHON2/#RANDOMEVENT3`).
- **A sequence ends where the next `@`, `#` or `[` line starts: there is no fall-through** into the next sequence/section (FUN_004018c1 pops the
  frame when the index runs past the instruction count).
- A sequence with **zero instructions cannot be started** (FUN_004017ac returns -1). Hence the idiom `Set $Dummy=` at the end of ~1500 sections
  (also absorbs the "failed GOSUB skips the last instruction" quirk, s6.4).

### 3.2 Lookup (FUN_004011ac, FUN_004013ea, FUN_00401647, FUN_004017ac)
`start(item, section, sequence)`: item by name (first match) -> section by name inside it (`""` matches only an unnamed section) -> sequence by name
inside the section (`""`/missing = **the first sequence of the section**). Any miss, or an empty sequence, = failure (-1).
Item/section/sequence names are compared with `strcmp` on the uppercased names.

### 3.3 Reading the names an instruction refers to
`Instruction Type=GOSUB Target=<SECTION> Contents=<SEQUENCE> Name=<ITEM>`; `If ... Item=<ITEM> SECTION=<SECTION> Sequence=<SEQUENCE>`; `Timer ... Item= Section= Sequence=`.
The "item" is the one named by `Name=`, **not** the current item - there are no relative calls; in PLAYER.SCR every call names its item explicitly.

### 3.4 Engine limits (not needed in a port, but explain failures)
Variables 8000 records (PLAYER.SCR needs 6800: one record per `Set` token), Instructions 5000 (3162), If 1000 (956!), Sfx statements 1000 (534),
Timer statements 100 (43), simultaneously active timers 20, sound slots 100, Tekst 200, EditBox 20, concurrent script threads 30,
styles 40. Exceeding a limit opens a message box ("Maximum van type ... bereikt") and the statement is lost.

---------------------------------------------------------------------------------------------------

## 4. Variables

### 4.1 Storage (FUN_00413e10 `Set` parse, FUN_0041423f lookup, FUN_00413e9a read)
- Each `Set` token creates a record `{name[0x14], value[0x108] (+0x14), display[0x108] (+0x11c), length (+0x228)}` at **parse time**
  (array `DAT_006a75f0`, 0x22c bytes each). The **variable is the first record with that name** (`strcmp` from index 0); later `Set` statements for the same
  name are only instructions whose own record's name/value are the "template".
- Consequence (important): **the initial value of a variable is the raw value text of its first `Set` in file order**, *not evaluated*:
  `Set $ISPARDOESRUNNING=$FALSE` initializes the variable to the literal string `$FALSE` until that statement has run. PLAYER.SCR declares everything
  in `[INIT]`'s unnamed section, which runs before anything else (672 of the 6800 sets), so this normally does not show. `tools/set_sim.py`
  reproduces the state after INIT.
- Values are strings; numbers are decimal strings; there is no separate numeric type. "Undefined" = no record.
- Names include the `$` (the engine does not require it: `Set$ Dummy=` makes variable `DUMMY`). All names are uppercase.

### 4.2 Reading
Two different read paths exist; do not mix them up:
1. **Whole-token substitution** (FUN_00413e9a): used for the `If` operands, `If Item/Section/Sequence`, `Instruction Name/Target/Contents`, `Sfx Name`,
   `Timer VARIABLE`, sprite fields etc. If the *entire token* equals a variable name, the variable's value is used; otherwise the token is used **literally**
   (an undefined `$FOO` stays the text `$FOO`). No substitution inside longer text, no recursion.
2. **Value expansion** (FUN_00414fd5): used for the value of `Set` and for the `File=` of `Sfx`. Only if the string **starts with `$`**:
   the text is scanned; a name starts at every `$`, ends at `\`; each completed name is replaced by its value (an **undefined variable becomes the empty string**,
   not the literal) and, after a `\` that follows a non-empty value, a `\` separator is appended; text after the last `\` is appended literally *only if no `$name` follows*.
   Examples (verified with the .SPR data, whose move names literally contain `KRING1\A`):
   `$X` -> value of X; `$INVLEFTOVER\$EXT` -> `KRING1\A`; `$A\foo` -> `<A>\foo`; `abc$X` -> literal `abc$X` (does not start with `$`, nothing is expanded).
   A trailing `\` is removed. (A value `..` after a `\` means "parent directory"; not used in PLAYER.SCR.)

### 4.3 Assignment (FUN_004142e5 exec, FUN_00414320 store)
`Set $NAME=<value>`: `v = expand(<value>)`, then (checked on `v`, i.e. *after* expansion):
| `v` starts with | and contains | effect |
|---|---|---|
| `+` `-` `*` `/` | no `,` | **arithmetic on the stored value**: `x = atoi(stored) <op> atoi(v[1:])`, stored as `%d` (division by 0 crashes the game) |
| `\|` | - | literal: stored = `v[1:]` (this is how negative numbers are assigned: `Set $VOLMUSICNEEDED=\|-1500`, 79 uses) |
| anything else | - | stored = `v` |

then the back-tick -> space conversion is applied to the stored and display copy; if the name is `$LANGUAGE` the language file is reloaded.
Pitfalls (all verified in code; `tools/set_sim.py` shows them):
- `Set $X=-1` is **decrement**, `Set $X=+1` increment (used as counters: `Set $VOLCOUNT=+1`, `Set $RATTAR_CNT=+1`, 38 uses).
- Because the initial value is the raw text, `Set $VOLMUSICNORMAL=-1500` (in `[INIT]`, first and only declaration) ends up as `-1500 - 1500 = -3000`;
  `$VOLMUSICDOWN` -> -6000, `$VOLMUSICDEC=-100` -> **-200**, `$VOLIDC=-1` -> -2. (`$VOLMUSICINC=100` stays 100.) `$VOLMUSICDEC/INC` are used by the music crossfade
  (s12.5); a faithful port must reproduce -200/+100. (UNCERTAIN only in the sense that it was never observed on a running game; the code path is unambiguous.)
- A `$var` whose *value* is negative and is assigned with `Set $A=$B` becomes a subtraction. Comma values (`-3,66`) are safe because of the `,` test.
- Values are never trimmed; numeric comparison uses `atoi` semantics (leading blanks, optional sign, digits, stops at the first non-digit; "" = 0).

### 4.4 Built-in variables (FUN_00413e9a, table at 0x46f768, formats FUN_004145ac / FUN_004147bd)
Read-only unless a user record of the same name exists (user records are searched first): `$TIME` (`H:M:S`), `$HOUR`, `$MINUTE`, `$SECOND`, `$DATE` (`W D J CY`),
`$WEEKDAY`, `$DAY`, `$MONTH`, `$MONTHNAME`, `$YEAR`, `$YEARC`, `$CENTURY`, `$PAGE` (print page number), `$LANGUAGE` (`TEKST031.TXT`), `$LANGUAGEDIR`,
`$WINDOWSDIR`, `$SYSTEMDIR`, `$CURRENTDIR`, `$PROGRAMMA` (EXE directory), `$EMPTEKSTVAR`. **None is referenced by PLAYER.SCR**; `$ROOTDIR/$EXTDIR/$NEWDIR/$MUSDIR`
are plain variables that are set but never read.

---------------------------------------------------------------------------------------------------

## 5. Statement reference

### 5.1 `Set` (FUN_00413d80 parse, FUN_004142e5 exec) - see s4. Type 0x16.
One record per `key=value` token. Executes synchronously, never blocks.

### 5.2 `If` (FUN_00439c90 parse, FUN_0043a33f / FUN_0043a371 exec). Type 0x15.
Record (0x90 bytes; table of 1000): `Name`(+0, ignored at runtime), `TYPE`(+0x18), left operand (+0x1c), right operand (+0x30), `COMPARE`(+0x44), `OPERATOR`(+0x48), `COUNT`(+0x4c), `EXTRA`(+0x50),
`ITEM`(+0x54), `SECTION`(+0x68), `SEQUENCE`(+0x7c).

Parameters (keys are matched after upper-casing):
| key | values | default | meaning |
|---|---|---|---|
| (any other key) `<L>=<R>` | text / `$VAR` | "" | comparison operands; if several, the **last** wins. In PLAYER.SCR always `$VAR=$VAR` or `$VAR=literal` |
| `ITEM` `SECTION` `SEQUENCE` | name or `$VAR` | "" | what to start when the condition holds (whole-token `$VAR` substitution at run time) |
| `NAME` | any | "" | label only (e.g. `IFMODEISSHOW` x914, `BULL` x42) - **not used by the runtime** |
| `TYPE` | `STATIC`, `KILL` | STATIC | `KILL` makes the statement inert (nothing executes); other values = STATIC |
| `COMPARE` | `EXACT` (0), `RTOL` (1), `LTOR` (2) | **RTOL** (unknown value also RTOL) | see below. PLAYER.SCR uses only `EXACT` (956/956) |
| `OPERATOR` | `EQUAL`(0) `GT`(1) `GTE`(2) `LT`(3) `LTE`(4) `NOT`(5) | EQUAL (unknown = EQUAL) | PLAYER.SCR: EQUAL 753, NOT 188, GT/LT/LTE 5 each, GTE 0 |
| `COUNT` | int | 0 | LTOR only |
| `EXTRA` | `GOSUB` | **RUN** | `GOSUB` = push a frame in the current thread; anything else/absent = start a **new thread** (PLAYER.SCR: GOSUB 946, RUN 10) |

Evaluation (L, R = whole-token-substituted operands, `ln = atoi`):
- `EXACT`: EQUAL `L==R` (string); NOT `L!=R` (string); GT `atoi(L) > atoi(R)`; GTE `>=`; LT `<`; LTE `<=` (numeric).
- `RTOL` (right-to-left): the longer string is cut to the length of the shorter by dropping its **leading** characters, then EQUAL/NOT as strings (other operators = false). `10` RTOL-equals `0`!
- `LTOR`: `strncmp(L, R, COUNT)`; EQUAL/NOT only (COUNT 0 -> always equal).
If true: item/section/sequence are substituted (whole-token) and started with `EXTRA`:
`GOSUB` -> FUN_00401a7b(current thread) (frame push, s6); otherwise FUN_004019f3(-1, ...) + `PostMessage(0x464, newThread)` (new thread). If false: nothing; the next instruction runs.

### 5.3 `Instruction` (FUN_0042061e parse, FUN_004213f5 exec). Type 0xD.
Record (0x30c bytes, table of 5000): `Name` (+0, 256), `Target` (+0x10c), `Contents` (+0x20b), type (+0x104), value (+0x108).
Parse: `Name=`, `Type=`, `Target=`, `Contents=`, `Value=` (anything else ignored). `Target=NOBACKBUF` additionally sets `DAT_01134afc` (no back buffer) at parse time.
Exec: `Name`, `Target`, `Contents` are first **whole-token substituted** (so `Name=$CURRENTSCREEN`, `Target=$SK1_RIJK` are indirections); then dispatch on type.
Return protocol of the step (s6.2): normal = continue; handler `return -1` = advance past this instruction and *stop stepping* (blocked, someone resumes the thread);
handler `return 0` = **retry this instruction** when the thread is resumed.

#### 5.3.0 Type= and Value= keyword tables (FUN_0042061e)
`Type`: `TEKST`=1 (also sets Value=3), `RUN`=2, `GOSUB`=3, `RUNRANDOM`=4, `SUBRANDOM`=5, `WAIT`=6, `ITEM`=7, `MOUSE`=8, `USES`=9, `EDITBOX`=0xA, `LISTBOX`=0xB, `VARIABLE`=0xC,
`PRINT`=0xD, `COMMAND`=0xE, `SPRITE`=0xF, `QUIZ`=0x10, `SCRIPT`=0x11, `SFX`=0x12, `BITMAP`=0x13, `WAVE`=0x14, `MOVIE`=0x15, `DX`=0x17, `OBJECT`=0x18; unknown = 0 (no-op).
`Value`: first `atoi(text)`, then keyword override: DISABLE 1, ENABLE 2, UPDATE 3, REWRITE 4, LOAD 5, SAVE 6, LOADVAR 7, SAVEVAR 8, SELECT 9, SETFOCUS 0xA, SHOW 0xB, HIDE 0xC, ANSWER 0xD,
WAIT 0xE, KILL 0xF, PLAY 0x10, VOLUME 0x11, SPEED 0x12, SIZE 0x13, FIRST 0x14, LAST 0x15, NEXT 0x16, PREV 0x17, INCREASE 0x18, DECREASE 0x19, CREATE 0x1A, DESTROY 0x1B, TEST 0x1C,
SAVEAS 0x1D, SWITCH 0x1E, MODVOLUME 0x1F, DELETE 0x20, COUNT 0x21, SELECTED 0x22, RANDOMIZE 0x23, DEBUG 0x24, COLOR 0x25, CHANGE 0x26.
Types used in PLAYER.SCR (count): GOSUB 2776, SFX 81, SPRITE 79, RUN 76, COMMAND 65, BITMAP 29, SUBRANDOM 20, OBJECT 15, DX 12, USES 2, SCRIPT 2, RUNRANDOM 2, TEKST 1, PRINT 1, WAIT 1.
Never used: ITEM, MOUSE, EDITBOX, LISTBOX, VARIABLE, QUIZ, WAVE, MOVIE (as Instruction), and `Instruction Type=...` with Value keywords other than those in `script-inventory.md` s5.

#### 5.3.1 GOSUB and RUN
- `GOSUB`: `FUN_00401a7b(thread, Name, Target, Contents)` - synchronous call in the *same thread*: a child frame is pushed on the thread's frame chain; the caller resumes after the callee's
  sequence has run to its end (s6.2). `Name`=item, `Target`=section, `Contents`=sequence ("" = first sequence). On lookup failure see s6.4 (quirk!).
- `RUN` (FUN_004019f3): starts a **new thread** (`Value`=0: always; `Value`!=0 -> `-2`: only if no thread currently runs the same item/section/sequence triple *as written*, FUN_00401939).
  On success: remember the triple as "last run" (FUN_0041341b: copies item/section/sequence to `DAT_006a7450/7400/7480` and the item to `DAT_006a7468`), `PostMessage(0x464, id)`.
  The new thread's message is posted **before** the caller's next step message, so the new thread executes its first instruction first, then both alternate (s6.5).
  On failure (target not found / empty sequence / no free thread): silently nothing - no side effects. PLAYER.SCR: `RUN Value=1` 2x (`DOSOMETHING Name=PARDOES`, `OT2EGEL`), `Value=0` 1x.
- `Target` may be `$VAR` (e.g. `Target=$SK1_RIJK`); undefined `$VAR` = literal text = lookup failure.

#### 5.3.3 RUNRANDOM / SUBRANDOM (FUN_004213f5 case 4/5, FUN_00420580)
`n = Value` (if `Value`=0: `n = atoi(Contents)` and Contents is cleared to ""); `last` = number stored last time for this `Target`
(Windows registry `HKCU\Software\ReHoProductions\Randomizer\<Target>`, FUN_0042218e/FUN_004222b3); then
```
if n < 2:            r = 1
elif n == 2:         r = (last == 1) ? 2 : 1   if last > 0   else rand(1..2)
else:                r = rand(1..n) until r != last
r = min(r, n); if r < 1: r = n
store r for Target; Target = Target + decimal(r)     // e.g. RANDOMEVENT + 7 -> section RANDOMEVENT7
```
then `RUNRANDOM` = RUN (new thread, + FUN_0041341b), `SUBRANDOM` = GOSUB. `rand(1..n)` = FUN_00420580 (MSVC LCG `x*0x343FD+0x269EC3`, `>>16 & 0x7FFF`, scaled; uniform 1..n; seeded with `time()` at first Instruction allocation).
The "never the same number twice in a row" memory persists between runs in the registry (a port may keep it in memory or localStorage). PLAYER.SCR: `[RANDOMEVENT] #TICK` runs
`RUNRANDOM Value=0 Contents=$RANDOMEVENTNR Target=RANDOMEVENT Name=$CURRENTSCREEN` every 10 s (s8) - section `RANDOMEVENT<r>` of the current screen item; a missing section is simply a no-op.
`SUBRANDOM Value=6 Target=...` (20 uses) calls sections `<Target>1..6` the same way.

#### 5.3.4 WAIT (FUN_004213f5 case 6)
- `Value` > 0: sleep `Value` ms **without blocking other threads**: creates a one-shot timer `MODIFIER<threadId>` (interval `Value`, multiplier 1) whose expiry posts a step message for the thread
  (if the timer already exists the call just returns -1 = blocked). Handler returns -1 (advance, block).
- `Value` < 0: **busy wait** `-Value` ms in the message loop (`timeGetTime` spin, FUN_0042216d); freezes everything.
- `Value` = 0: wait for **any mouse click or key press** (sets `DAT_01134b10`; FUN_004224a0 on WM_LBUTTONDOWN/WM_KEYDOWN clears it and posts `0x464` for thread **0**, UNCERTAIN whether a thread other than #0 can use this).
PLAYER.SCR: one `WAIT Value=1000` (line 15031).

#### 5.3.5 USES (FUN_004213f5 case 9)
`Target=`: `ACTIVEMOVIE` sets `DAT_011e357c`; `DIRECTSOUND` sets `DAT_011bf5e8` and calls FUN_00433ec0 (creates the DirectSound object, primary buffer 22050 Hz/16 bit/stereo; if `Contents` names a variable it receives `1` or `0`);
`VFW` sets `DAT_01224194`; `SINGLETHREAD` sets `DAT_0047a894` (mouse/keys ignored while any script thread exists); `NOBACKBUF` sets `DAT_01134afc`. PLAYER.SCR: `Uses DirectSound`, `Uses Vfw` (and a disabled `NOBACKBUF`).
For a port: nothing to do except "audio available".

#### 5.3.6 SCRIPT (FUN_00403803)
Authoring functions of the original "film maker" (SHOW 0xB, WAIT 0xE, KILL 0xF, NEXT/PREV 0x16/0x17, CREATE 0x1A, DESTROY 0x1B, TEST 0x1C, SAVEAS 0x1D, DELETE 0x20, DEBUG 0x24).
Runtime-relevant: `Value=WAIT` blocks the current thread until the thread running (`Name`,`Target`,`Contents`) ends (stores the waiting thread id in that thread's notify slot, FUN_004017ac field [2]);
`Value=KILL` kills that thread and wakes the waiter. PLAYER.SCR uses only `Value=DEBUG Name=SCRIPT|THREAD` (hidden F3/F4, s13) which dump to a stubbed log function (FUN_00404cfb = no-op).

#### 5.3.7 Types handled by the graphics side
`SPRITE`, `BITMAP`, `COMMAND`, `OBJECT`, `DX` (and `MOVIE`/`WAVE` instruction forms): not documented here. Interface: `Sprite Name=X Type=WAIT` and `Movie Type=WAIT` are **blocking statements** (s6.5).

#### 5.3.8 SFX / TEKST / PRINT
See s12.3, s9.2, s10. `MOUSE`: `Value`=0 disables all mouse input (`DAT_00473028`=0), non-zero re-enables and **flushes pending mouse messages** (FUN_004223c6); initial value -1; unused.
`ITEM` (0x7), `VARIABLE` (0xC): save/restore state in the registry (s11); unused. `EDITBOX`/`LISTBOX` instruction forms: operate on live boxes (`Value` SELECT/SETFOCUS/UPDATE/REWRITE/FIRST/LAST/NEXT/PREV...); unused.

### 5.4 `Exit` (type -1)
Exactly the line `EXIT`. Step handler posts `WM_CLOSE`; DefWindowProc -> WM_DESTROY (FUN_004056fd case 2) -> cleanup -> quit. In PLAYER.SCR: `[CMDEXITTITEL] #CLICK`: `WAVE TYPE=KILL Name=music` then `Exit`. There is no confirm dialog and no auto-save.

### 5.5 Statements recognised but unused in PLAYER.SCR
`Area` (hit area), `Flyover`, `Install`, `Quiz`, `PuzJapans`, `Execute` (keys NAME COMMAND FILE DIRECTORY PARAMETERS -> ShellExecute), `CdAudio` (NAME FROM TO VOL FADE TYPE PLAY/STOP/PAUSE/OPEN/CLOSE VOLUME ATEND),
`Midi` (NAME FILE TYPE PLAY/WAIT/KILL ATEND), `TimeLine` (s8.4), `ListBox` (many keys: BITMAP FILE ITEMTYPE TYPE ...; events `ENDOFLIST`, `CLICK`, `SELECTITEM`), `Message`. Not needed for the port.

---------------------------------------------------------------------------------------------------

## 6. Execution model

### 6.1 Cooperative script threads (FUN_00401834, FUN_004017ac, FUN_004018c1, FUN_00401f91)
A "thread" = one of 30 slots (`DAT_0046d030`, 0x2c bytes):
`[0]` id, `[1]` active flag, `[2]` notify-thread id (-1 = none; posted when the thread ends), `[3]` script (always script slot 0), `[4]` item, `[5]` section, `[6]` sequence (top-level triple),
`[7]` instruction pointer, `[8]` instruction **index** (1-based count of instructions started in this frame), `[9]` child frame, `[10]` parent frame.
A frame chain (linked list via [9]/[10]) is the call stack: a thread's *deepest* frame is the one executing. Slot allocation = lowest free index; ids are reused. No free slot = the RUN/If-RUN is silently dropped.

### 6.2 Stepping (FUN_00403773 = handler of message `WM_USER+100` = 0x464, wParam = thread id; FUN_00401fb3 = one step)
Each step executes **exactly one instruction** of the thread's deepest frame:
```
step(tid):
  t = thread[tid]; if !t or !t.active: return STOP
  f = deepest frame of t
  f.idx += 1
  if f.sequence.count < f.idx:                 // ran off the end of the sequence
       f = pop(f)                              // FUN_004018c1: free f; parent.idx += 1; repeat while the parent is also past ITS end
       if f == none:                           // top level finished
            t.active = false; if t.notify != -1: post(0x464, t.notify)
            return STOP
       // note: the returned parent frame executes its next instruction *in the same step*
  execute instruction at f.ptr  (handler by type)
  f.ptr += 1                                    // after the handler returned (CONTINUE or blocked)
  return CONTINUE                              // caller posts the next 0x464 for this thread
```
Handler return codes (case 0xD Instruction, and Movie 6, Wave 7, Timeline 0x18, Sprite 0xF, ...): `1`/void = CONTINUE; `0` = `f.idx -= 1`, STOP (the instruction is retried when the thread is next stepped);
Instruction `-1` = `f.ptr += 1`, STOP (done, but blocked until resumed). STOP means "no next step message is posted"; blocked threads are resumed by whoever stored their id (timers, sound/wave end, sprite end, input, SCRIPT WAIT).

`GOSUB` pushes a child frame (`FUN_00401a7b`): it is allocated at the end of the chain, copies the thread id, and `start()`s (s3.2). The calling frame's `ptr` is advanced after the handler returns, so when the child ends,
`pop` increments the parent's `idx` and execution continues with the next instruction: **GOSUB is synchronous within its thread**. Recursion depth is unlimited (heap frames).

### 6.3 The message queue is the scheduler
`PostMessage(hwnd, 0x464, tid)` is how every thread yields: one instruction per message. Posted messages are processed **before** input, WM_PAINT and WM_TIMER (Win32 queue priority;
UNCERTAIN only as to exact interleaving with hardware input), so a runnable script chain runs to quiescence (all threads blocked/finished) before the game processes the next click, timer tick or frame.
With >1 runnable threads they are served **round-robin, one instruction each, in FIFO order of their step messages**. A new RUN posts the new thread's first step before the caller's next step.
No instruction is re-entrant: handlers may start threads but never run a script inline except GOSUB frames.
Idle processing (message queue empty) = frame: FUN_00404e76 loop -> DirectDraw back-buffer composition/Flip (FUN_0045bf07: `Flip(NULL, DDFLIP_WAIT)`, i.e. vsync paced) and `FUN_0044c4a2(hwnd, "DX")` which ticks
the sprites whose clock is the special name `DX` once per frame (graphics agent).

### 6.4 Failure quirk: a failing GOSUB desynchronises the frame (FUN_00401a7b + FUN_004018c1) - reproduce it
If `GOSUB` (or `If ... Extra=GOSUB`) cannot start its target, the freshly allocated child is torn down with FUN_004018c1, which does `parent.idx += 1`.
The step then still does `parent.ptr += 1`. Net effect: `idx` is one ahead of `ptr`, so the frame ends **one instruction early - the last instruction of the calling sequence is never executed**
(two failing calls skip the last two, and if the failing GOSUB is itself the last instruction the parent frame is popped as well). A failing `RUN`/If-RUN has no side effects.
The idiom `Set $Dummy=` as last line of nearly every section absorbs the loss, and `LEEG`/`$LEEG` ("empty") is the conventional "nothing to do" call target: e.g. `[PARDOES] #UNDOSOMETHING` is `GOSUB Target=$PDESTROY Name=PARDOES` + `Set $Dummy=` and `$PDESTROY` defaults to `LEEG`, so the call fails on purpose and the `Set $Dummy=` is the instruction that gets skipped (`tools/engine_sim.py` reproduces 150+ such runtime failures in a 60-click walk). PLAYER.SCR has 8 statically dangling literal references (list in `script-inventory.md` s7; plus dynamic ones such as `Name=$CURRENTSCREEN` with no matching item).
Implement `idx` and `ptr` as two separate counters exactly like this (the simplest exact model).

### 6.5 Blocking statements and how threads are resumed
| statement | blocks? | resumed by |
|---|---|---|
| `Instruction WAIT Value>0` | yes (-1) | one-shot timer `MODIFIER<tid>` -> `0x464(tid)` |
| `Instruction WAIT Value=0` | yes (0) | next click/key (thread 0) |
| `Instruction SFX Value=WAIT Name=X` | yes (0) while the sound plays | polled: every **enabled timer tick** (any timer) posts `0x464` to the single global waiting thread `DAT_004735e8`; if no timer is enabled it re-posts itself immediately (busy loop). A looping sound blocks forever. Only **one** thread can be sound-waiting (the id is a single global; UNCERTAIN what happens with two) |
| `Wave Type=WAIT` | yes (0) | wave end posts `0x464` to the waiting thread (FUN_0042766d) |
| `Movie Type=WAIT` | yes | movie end / click / key (FUN_004248ac, FUN_004247af) - graphics agent |
| `Sprite Name=X Type=WAIT` | yes (0) | the sprite finishing its move posts `0x464` - graphics agent |
| `Instruction SCRIPT Value=WAIT` | yes | the awaited thread ends |
| `TimeLine Type=CHECK` | polls: re-posts itself until the time elapsed (s8.4) | itself |
| everything else | no | - |
While a **Movie WAIT / Wave WAIT / Wait=0** is active, a mouse click or key press only *skips* the wait (FUN_00422453 -> FUN_004247af/FUN_00427ecd/FUN_004224a0); the click is **not** delivered to Commands.
Port advice: model blocking as explicit wait states resumed by the events above instead of the original re-post spinning (the spin only exists because Win32 has no scheduler).

### 6.6 Thread end, notify, limits
A top-level thread ends when its frame chain is empty: `active=0` (slot free), and `0x464(notify)` is posted if some thread did `SCRIPT WAIT` on it. No exceptions/abort mechanism; `Exit` is the only global stop.

---------------------------------------------------------------------------------------------------

## 7. Events the engine raises, and input

### 7.1 Engine-raised sections (grep of all FUN_004019f3 call sites; everything not listed here is only reached by script calls)
| trigger | what is run (`RUN` = new thread, item/section/sequence) | source |
|---|---|---|
| first WM_PAINT | `[INIT] #"" @""` | FUN_004056fd 0xF |
| CD removed (WM_DEVICECHANGE 0x8004 -> msg 0x466) | `[EINDE] #CLICK`; if the thread id returned is 0 -> `WM_CLOSE` (no `[EINDE]` item exists, so nothing happens) | FUN_004056fd 0x466 |
| mouse released on the Command it was pressed on | `[<cmd>] #CLICK` (type GLOBAL/CATALOG); with Ctrl+Shift held `[<cmd>] #CLICKHAHA` first and `#CLICK` only if that does not exist (`CMDDR1RUILSTEEN` has one) | FUN_004129dd |
| mouse released elsewhere | `[<cmd>] #MOUSEUP` | FUN_004129dd |
| mouse pressed on a Command | `[<cmd>] #MOUSEDOWN` (GLOBAL); CATALOG: `[<cmd>] #MOUSEDOWN` too and the item becomes the "current item" | FUN_004123a5 |
| mouse enters / leaves a Command | `[<cmd>] #FLYOVER` / `[<prev cmd>] #ENDFLYOVER` (+ cursor change from the Command's `MOUSEOVER=n`) | FUN_00411b1e |
| Command of type ITEM/ACTION (2/4) clicked | `[<current item>] #<command name>` (current item = last RUN's item, FUN_0041341b) | FUN_004129dd |
| key press mapped by `Command ... KEY=<name>` | `[<cmd>] #CLICK` of the **first** created Command (instruction state 2) whose KEY matches the virtual key (FUN_00418baa). Command STATE (ENABLED/DISABLED) is **not** checked here (UNCERTAIN: graphics agent to confirm) | FUN_00418baa |
| Timer tick | the timer's own `Item/Section/Sequence` (s8) | FUN_0043952d |
| sprite collision (EXTRA=COLIDE), DX collision/win/start | `[<sprite>] #COLIDE`, `[<dxscreen>] #COLIDE` / `#WIN` / `#START`, `[<sprite>] #START` | FUN_0044dd..., FUN_0045... (graphics) |
| sprite with EXTRA=COMMAND clicked | `[<sprite>] #CLICK` (or the sprite's own custom section) ; `#ENTER` for directional sprites | graphics |
| puzzle bitmap | `[<bitmap>] #PIECEOK` / `#PIECENOK` / `#SOLVED` | FUN_0040... (graphics) |
| edit box text changed | `[<editbox>] #<COMMAND=>` (s9.3) | FUN_00432501 |
| list box | `[<listbox>] #ENDOFLIST/CLICK/SELECTITEM` (unused) | - |
Names such as CREATE, DESTROY, ENABLE, DISABLE, INCREASE, DECREASE, KILL, TICK, DROP, WRONGDROP are **not** engine events: they are section names the script calls itself.

### 7.2 Keyboard
FUN_004056fd WM_KEYDOWN (0x100): (screensaver mode -> quit); skip a playing Wave-wait / Movie-wait; `FUN_00418baa(vk)` (Command KEY); WM_CHAR (0x102) feeds the hidden-text buffer (s13).
`KEY=` names (Command parser, FUN_004169b0): `ENTER`(VK 0x0D) `ESCAPE`(0x1B) `F1..F12`(0x70..0x7B) `DELETE` `INSERT` `HOME` `END` `PAGEDOWN` `PAGEUP` `UP` `DOWN` `LEFT` `RIGHT` `ADD` `DIVIDE` `MULTIPLY` `SUBTRACT`; **anything else (letters, digits such as `KEY=5`) = no key** (VK 0 never matches). Keys used in PLAYER.SCR:
ENTER (name screen, intro end), ESCAPE (`CMDEXITTITEL`, exit screen only), LEFT/RIGHT/UP/DOWN (car and boat screens), `5` (`CMDBOOTC`, inert because unrecognised). There is **no global Escape-to-quit**: Escape only exists
as a Command while the exit/title screen is up. (`TEKST031.TXT` `#HELPESCAPE` = "Escape = Stop" is a leftover.)
Keys typed while the player-name edit box has focus go to the edit control; ENTER/ESC are forwarded to the main window so that `KEY=ENTER` still works (FUN_00432501).

### 7.3 Mouse gating (FUN_004056fd 0x200-0x205, FUN_004123a5 / FUN_004129dd / FUN_00411b1e)
Mouse/Command handling runs only if: window active (`DAT_0047a8b8`), not suspended (`DAT_0047a8bc`==0), mouse enabled (`DAT_00473028` != 0), `SINGLETHREAD` not forbidding it, and **no skippable wait is active** (otherwise the click skips the wait).
WM_LBUTTONDBLCLK is treated exactly like WM_LBUTTONDOWN. The **right button is ignored by Commands and sprites** (the handlers get `left=0` and return early; the right button only matters for the hidden easter egg, s13).
Hit testing, cursors (`MOUSEOVER=n`), sprite clicks: graphics agent.

### 7.4 Interface contract between the script core and the graphics/sound layers (suggested port API)
- script core -> engine: `readVar(name)`, `assign(name, text)` (sprites resolve `Start=$VAR`, `End=$VAR`, `AffectPos=$VAR`, `Move=$VAR`, ... through whole-token substitution, FUN_00413e9a, at the moment the statement executes);
- engine -> script core: `runNew(item, section, seq)` (every event of s7.1; returns false if the target does not exist), `resume(threadId)` (sprite/movie/wave finished, click on a skippable wait); core -> engine: the core owns the timer table and calls `graphics.tickClock(name)` for sprite clocks (`TIMERVFAST`..., and the per-frame clock `DX`);
- blocking statements implemented by the graphics side (`Sprite Type=WAIT`, `Movie Type=WAIT`) must return a "retry / blocked" result to the core and later call `resume(tid)`; the core re-executes the same statement (so the statement must report "done" when its condition is already satisfied);
- sound API used by the core and by sprites: `load(name,file,flags)`, `unload(name)`, `play(name, volume, loop)`, `stop(name)`, `isPlaying(name)`, `setVolume(name|file, v)`, `addVolume(name, dv)`, `setPan(name, p)` with the semantics of s12.

---------------------------------------------------------------------------------------------------

## 8. Timers

### 8.1 Statement `Timer` (FUN_00438d17 parse, FUN_0043934c exec). Type 0x14.
| key | meaning | default |
|---|---|---|
| `Type` | `STATIC` (1) create/start, `KILL` (2) destroy, `DISABLE` (3), `ENABLE` (4); unknown = STATIC | STATIC |
| `Name` | timer name (slot key); sprites/Items refer to it | "" |
| `Interval` | whole-token variable resolved **at parse time** (not at run time), `atoi` | 1000 |
| `Multiplier` | ms per interval unit | 1 |
| `Variable` | variable whose value (atoi) **replaces Interval when the timer is created** (`$TIMERTIJD` = 1 everywhere: a global speed knob) | "" |
| `Item` `Section` `Sequence` | script to start on every tick (raw names; **no variable substitution**) | "" |
Period = `Interval * Multiplier` ms (`SetTimer`, Windows timer id = slot+1).
Exec:
- `STATIC`: if **no active timer of that name exists**, allocate a slot (max 20 active; else a message box), apply `Variable`, `SetTimer`. **If it already exists the statement is a no-op** (FUN_00438c30 returns 0 for an existing timer): re-issuing `Static` does *not* change the period; use `KILL` first.
- `KILL`: `KillTimer`, slot freed (stored script triple lost). `DISABLE`/`ENABLE`: only toggles the slot's *enabled* flag; the Windows timer keeps running; a disabled timer's ticks are ignored completely (also for sprite clocks and the sound-wait poll).
Timers declared in PLAYER.SCR: TIMERTWINKEL 100 ms, TIMERPARDOES 80 ms, **TIMERVFAST 65 ms, TIMERFAST 125 ms, TIMERSLOW 200 ms, TIMERESLOW 500 ms, TIMERVSLOW 1000 ms** (sprite animation clocks, lines 732-736), plus item timers:
BUIDELTIMER 7 s (CMDINVENTORY#NEXTSOUND), TWINKELTIMER 1 s (PBELLETJE#TICK), SK1DEURTIMER 11 s (SK1_KAST#SLUITKAST), SK1KRING 2 s (SK1_KRINGVULLEN#TICK), EXITTIMER 4 s (CMDEXITTITEL#TICK),
RANDOMEVENTS 10 s (RANDOMEVENT#TICK), PY1_TIMERSTART 1.5 s, PY1_TIMERPUZZEL 5 s, PY1_TIMERPUZZEL2 0.3 s, PY1_TIMERPUZZEL3 3 s (PYTHON1), OT2_TIMER 0.3 s (OLDTIMER2#TICK), TIMERGAME 5 s, TIMERVOL 0.1 s (VOLUME#TICK, music crossfade).
`[TIMERS]` item (lines ~4650): `#ENABLE`/`#DISABLE` toggle the five sprite clocks with `Timer Type=ENABLE|DISABLE` (used while screens are built / in transitions).
Windows `SetTimer` granularity (15.6 ms NT, ~55 ms on the Windows 98 the game targeted) makes the real tick periods differ from nominal; **UNCERTAIN what the animators saw**: use the nominal values.

### 8.2 Tick handling (FUN_0043952d, WM_TIMER 0x113; skipped when message 0x3BD is pending)
```
slot = timer with id; if !slot.enabled: return
if soundWaitThread != -1: post(0x464, soundWaitThread)          // polling of Instruction SFX WAIT
if slot.item != "": run new thread (item, section, sequence)    // EVERY tick, even if the previous run is still going (30-thread limit applies)
elif slot.waitThread == -1: tick all sprites whose clock name == slot.name     // FUN_0044c4a2 (graphics)
else: kill the timer; post(0x464, slot.waitThread)               // WAIT one-shot
```
### 8.3 `[RANDOMEVENT]`
Not an engine feature. Item `RANDOMEVENT` + timer `RANDOMEVENTS` (10 s) + `RUNRANDOM` (s5.3.3): `#ENABLE/#DISABLE` start/kill the timer if `$RANDOMEVENTS=$TRUE`; each screen item defines `RANDOMEVENT1..n` (n = `$RANDOMEVENTNR`, set per screen).
### 8.4 `TimeLine` (FUN_004396fa / FUN_00439afb) - unused
Keys `Name`, `Type` (`START` 1, `CHECK` 2 default, `KILL` 3, `DISABLE` 4, `ENABLE` 5), `Time` (ms). START records `timeGetTime()` under the name (20 slots), CHECK blocks (re-posting itself) until `Time` ms have elapsed.

---------------------------------------------------------------------------------------------------

## 9. Text

### 9.1 `Style` (FUN_004153d3 parse -> global table of 40, FUN_00415915 CreateFont)
`Style Base=<ROMAN|SWISS|MODERN|DECORATIVE|SCRIPT> H=<n> W=<weight> Color=r,g,b Name=<id> FaceName=<face> [Italic] [Underline] [Strikethrough] [Printer] [Back=Transparant]`.
`H` is the font **cell height in pixels** (default 14) - or **points** when `Printer` is present (then `H = -MulDiv(H, printerDpiY, 72)`); `W` weight (default 400); `FaceName` `_` = space, words capitalised (`ARIAL` -> `Arial`);
without FaceName the family class decides (`SWISS`=Arial-like, `ROMAN`=Times-like, ...). Background mode is always transparent. A lookup of an unknown style name returns slot 0 (the first style).
PLAYER.SCR: `EDITBOX` = ROMAN H=20 W=600 Color 128,20,20 FaceName=ARIAL (the name entry field); `PRNDATADATA` = ROMAN H=60 W=800 Printer black (the diploma name, s10). PRINTER.RPT defines three more (`PRNKOP` SWISS 20pt W700, `PRNVOET` 12pt, `PRNDATAHEAD` 14pt) that no element uses.

### 9.2 `Tekst` (FUN_0041dc30 parse, FUN_0041e9ac exec, FUN_0041f08e/0041f1cc/0041f620 draw, FUN_0042028c update). Type 5.
Keys: `Name`, `Type` (`SINGLE` 1 default, `SINGLEBOUND` 2, `MULTIBOUND` 3 = word wrap, `TEMP` -1, `KILL` 4), `Rect`, `Relative` (bitmap name the rect is relative to), `Target` (name of a bitmap/command/area to fit into), `Margin`, `Contents`,
`Align` (default LEFTTOP; encoded H: 0x01 left 0x02 right 0x04 center, V: 0x10 top 0x20 bottom 0x40 center; **an unknown ALIGN value = LEFTBOTTOM**), `Color` (r,g,b; `0,0,0` is indistinguishable from "unset" -> style colour),
`Style` (Style record name), `Shadow` (colour, drawn at +2,+2), `ShadowPoint` (parsed, UNCERTAIN: not seen in the draw code), `Extra=RESTOREBG|CAPTION`, `CopyTarget`, `FX` + `FXTop` + `FXBot` (text warped along two polylines, used for printing), `Printer`.
Semantics:
- **`Rect` is (x1,y1,x2,y2) for Tekst** (left, top, right, bottom), *not* x,y,w,h as for EditBox (FUN_0041e9ac): with no `Relative`/`Target` the offsets are added; if right < left then `right = left + 20`; if **bottom < top then `bottom = top + 20`**. So `RECT=348,158,640,20` means (348,158)-(640,178).
- `Tekst` creates the object and draws it; it is an object of kind 6 in the layered screen-object list (FUN_00413266 redraws it with the rest of its region), until `TEKST Type=KILL Name=X` (FUN_0041e93d, FUN_004130ec(rec,6)) removes it and restores the background. EditBox is kind 9 in the same list.
- `Contents`: if it starts with `$` it is read **live from the variable at every draw**; the text then goes through the text-resource lookup (s9.4): if it equals a resource key the resource text is shown, else the text itself.
  (`Contents=` empty = nothing.)
- Drawing: GDI `TextOut` with a custom word-wrap (honours `\r\n`, `\t`), alignment as above, tab stops from FUN_0042024d.
- `Instruction Type=Tekst Name=<n> Target=<t> Contents=<c> Value=Update` (FUN_00420476 -> FUN_0042028c): **looks up the Tekst named by `Target` (not `Name`)**, sets its Contents to `c` and redraws.
  PLAYER.SCR line 8703 is `Instruction Type=Tekst Target=$SPELERNAAM Name=PRNNAAM Contents=$SPELERNAAM Value=Update`: `Target` resolves to the *player's name*, no Tekst has that name, so the call does nothing and the
  on-screen diploma text `PRNNAAM` (rect 348,158) stays empty. **UNCERTAIN (likely an original bug)**: checked FUN_00420476 param order and the instruction parser; the printed diploma (s10) does contain the name.
  A port may show the name there (probably the intent) - decide consciously.

### 9.3 `EditBox` (FUN_00431270 parse, FUN_004321fa exec, FUN_00432501 window proc). Type 0x11.
A real Win32 EDIT control (child window, `WS_EX_TRANSPARENT`, subclassed) drawn over the background bitmap. Keys: `Name`, `Rect` (**x,y,w,h** here), `Relative`, `Bitmap`, `Style`, `Color` (WM_CTLCOLOREDIT text colour, hollow background brush so the background bitmap shows),
`BColor`, `MaxLen` (EM_LIMITTEXT), `CopyTarget` (variable or list box receiving the text), `Contents`, `Command` (section of this item to run on every text change), `Prev`/`Next` (Tab targets), `Extra=MULTILINE|MODIFY`, `Operations` (list), `Type`:
`CREATE` 1 (create + focus + `SetFocus`), `KILL` 2 (destroy), `UPDATE` 3 default (write variable `Contents` to the control), `REWRITE` 4 (read the control into the variable named in `Contents`). Unknown keys -> message box.
Behaviour (FUN_00432501): **on every change (EN_CHANGE; unless `Extra=MODIFY` is given) the full text is assigned to the `CopyTarget` variable (only if that variable exists) through the normal assignment (s4.3)** - so a name beginning with `+ - * /` (without comma) is
treated as arithmetic and a leading `|` is dropped (original quirk; a port should simply assign the text literally); then `[<editbox>] #<Command>` runs if `Command` is set. ENTER/ESC are re-sent to the main window (Command `KEY=ENTER`), TAB moves focus to `Next`, mouse clicks are forwarded to the parent.
PLAYER.SCR: `EDITBOX Name=EDTNAAM RECT=170,340,400,28 Style=EDITBOX COLOR=128,20,20 Type=CREATE COPYTARGET=$SPELERNAAM maxlen=15` (line 916) over bitmap `INNAAM.BMP` plus a `TEKST Name=EDTNAAM ... Style=EDITBOX Color=10,10,10` (rect 180,340-400,360). Max 15 characters, Arial 20 px weight 600, colour (128,20,20).
Confirm: Command `CMDINTROEIND` (`KEY=ENTER` and mouse), `CMDINTROHAND`. `$SPELERNAAM` ("player name") is initialised to "".

### 9.4 Text resources (`TEKST031.TXT`, FUN_0041d9ff / FUN_0041d8ee / FUN_0041db79)
Format: a line starting with `#` starts an entry; key = rest of the line (upper-cased) with the line terminator removed; following lines (including their CRLF) are the text. `Tekst Contents=<KEY>` (or a `$VAR` whose value is a key) displays the text; unknown key = shows the string itself.
Table of 1000 entries, loaded lazily at the first lookup from `$LANGUAGEDIR\$LANGUAGE` (default `TEKST031.TXT` in the DAT). The only entry is `#HELPESCAPE` = `Escape = Stop`, and no script statement references it.

---------------------------------------------------------------------------------------------------

## 10. Printing (the diploma)

Trigger: `[CMDES2PRINT] #CLICK` (ending screen, button at 457,371 95x75): `Bitmap Type=POPUP Name=PRNBITMAP File=xprn_dip.bmp` / `Instruction Type=Print Contents=printer.rpt` / `Bitmap Type=KILL Name=PRNBITMAP`, then `GOSUB CLICK CMDES2KLAAR` (back to the title/exit screen).
Engine (FUN_004213f5 case 0xD -> FUN_0043bdb7 -> FUN_0043b1bf parse report, FUN_0043babb print): standard Windows **print dialog** (PrintDlg, `PD_RETURNDC`; FUN_0043bfae), document name "Diploma", progress dialog `PRTDLG` with abort proc, `$PAGE` set to the page number.
`PRINTER.RPT` (831 bytes, same line syntax as the script, case-insensitive): `[INIT]` `Bounds Rect=0,0,1900,2900` + three unused Style lines; `[PAGEHEADER]` `Bounds Rect=0,0,2100,2970 Type=FIXED`, `Bitmap Rect=100,100,2000,2870 Contents=PRNBITMAP`, `Tekst Rect1=100,250,1000,300 Contents=PRNSPELERNAAM`;
`[HEADER] [FOOTER] [PAGEFOOTER] [DATA]` contain only disabled (`/`) elements. Units: **0.1 mm** (converted `MulDiv(v, dpi*10, 2521)`; 2521 ~ 25.4 * 99.25, treat as 1/10 mm). `Contents=PRN...` names a **bitmap object** (the popup bitmap just created) or a **Tekst object defined in the script** (`[PRINTER]` item, line 932).
Result = **one A4 portrait page**:
1. the bitmap `xprn_dip.bmp` (866x1156, 24-bit; the certificate rotated 90 degrees so that it fills a portrait page; text reads top-to-bottom) drawn *in aspect* (FUN_0040740c): height-fitted to the rect (277 mm), width = 866/1156 * 277 mm ~ 207.5 mm, **right-aligned** to the rect's right edge (x = 200 mm) -> its left edge falls ~7.5 mm off the page and is clipped;
2. the player's name (`$SPELERNAAM`, style `PRNDATADATA`: Roman 60 pt bold black) drawn with the `FX` warp (FUN_0041f1cc): `FXTOP=1180,2000,1180,2000 FXBOT=1100,2000,1100,2000` with all Ys equal triggers the special case "grow vertically": with `n` = number of characters the top polyline runs from (118 mm, 200 mm - 4n mm) to (118 mm, 200 mm + 4n mm) and the bottom polyline from (110 mm, ...) to (110 mm, ...), i.e. the name is a vertical band **8 mm high (glyph tops toward x = 118 mm, bottoms toward x = 110 mm), centered at y = 200 mm, 8 mm per character, running downward** = rotated 90 degrees clockwise to match the rotated certificate; glyphs are stretched to fill the band. (A commented-out alternative used `500,500,1700,500` / `500,700,1700,700`.)
For the browser: render an A4 `@media print` page with the bitmap (rotated certificate) and the name as 90-degree-rotated text at those coordinates, then `window.print()`. The on-screen version of the same certificate is `xscr_dip.bmp` (640x480) with the (probably non-functional, s9.2) name `Tekst` at (348,158).

---------------------------------------------------------------------------------------------------

## 11. Saving / persistence

- **There is no savegame.** PLAYER.SCR contains no `Instruction Type=VARIABLE/ITEM Value=SAVE/LOAD...`, nothing writes progress. All game state lives in memory (variables, sprites) and is lost at exit.
  The only file the game can write: `log.txt` (debug, effectively disabled: FUN_00404cfb is a no-op; FUN_00404d56 is never called) and, in the authoring mode, the script itself (FUN_004032a0, `Value=SAVE/SAVEAS`).
- Registry use (all under `HKCU\Software\ReHoProductions\<name>`; `<name>` = EXE name `PARDOES` when empty): `Instruction Type=VARIABLE Value=LOAD|SAVE` (read/write a registry string value `Contents` under key `Name` into/from variable `Target`),
  `Instruction Type=ITEM Value=SAVE|LOAD` (store/restore the last-run item/section/sequence triple under key `Target`), and **the randomizer memory** (key `Randomizer`, value = the RUNRANDOM `Target`, s5.3.3). Only the randomizer is used by PLAYER.SCR.
- The player name `$SPELERNAAM` is only used for the printed/on-screen diploma; it is kept in memory only.
- Port: nothing to persist. Optionally keep the `Randomizer` memory in `localStorage` (cosmetic), or add a *new* save feature (out of scope here).

---------------------------------------------------------------------------------------------------

## 12. Sound

### 12.1 Engine facts
- Playback = **DirectSound** (`Uses DirectSound`; `use_dsound` WIN.INI `[Player]` default 1, FUN_00433fba). DirectSound object with cooperative level PRIORITY, primary buffer 22050 Hz / 16 bit / stereo (FUN_00433ec0).
  Secondary buffers (FUN_00436af3): `DSBCAPS_LOCSOFTWARE | CTRLFREQUENCY | CTRLPAN | CTRLVOLUME` (0xE8); the whole WAV is read from `PARDOES.DAT` (or a file if `EXTRA=EXTERNAL`) and parsed by FUN_004372a0 (RIFF/`fmt `/`data`) into one buffer. One-shot or looped whole-file buffers - **no streaming for Sfx**.
  If DirectSound is unavailable the code falls back to `PlaySound` with the file (no volume/pan/loop; one sound at a time).
- **100 sound slots** (`DAT_0119d368`, 0x130 bytes, matched by exact name); one buffer per name - playing a name that is already playing **restarts it** (SetCurrentPosition(0) then Play); there is no overlap of the same name and no polyphony counter beyond the 100 slots.
- Volume units: `IDirectSoundBuffer::SetVolume` **hundredths of a decibel**, 0 = full volume, -10000 = silence; out-of-range values make DirectSound reject the call (volume unchanged). amplitude = 10^(v/2000).
- Pan: `SetPan(p)`, p in -10000..10000 hundredths of dB attenuation of the *opposite* channel (p>0 attenuates the left channel, p<0 the right).

### 12.2 `Sfx` statement (FUN_00425303 parse, FUN_00425b50 exec). Type 8. Table of 1000 statement records.
Keys: `Name`, `File`, `Type`, `Sync`, `Extra`, `Volume`, `Frequency`, `AtEnd`.
| key | values | default |
|---|---|---|
| `Type` | `PLAY` 1, `KILL` 2 (= stop), `LOAD` 3, `UNLOAD` 4 | **KILL** (also for unknown/missing) |
| `Name` | slot name; whole-token `$VAR` substitution at run time (`Name=$SFXDECREASE`) | "" |
| `File` | wave name in the DAT, expanded with the `$VAR\` rules (s4.2). If the expansion starts with `?`: **random variant** `?NNxxxx` -> `xxxx` + 2-digit `rand(1..NN)` + `.wav` (e.g. `?04PPRA` -> `PPRA03.wav`; `$PPRAATFILE` holds such strings) | "" |
| `Volume` | `atoi` at **parse time** (a `$VAR` here is just 0), hundredths of dB | 0 |
| `AtEnd` | `REPEAT` -> loop; `CLOSE`/anything else -> once | once |
| `Extra` | `CANINTERRUPT` (flag 1), `PLAYONEATATIME` (flag 2), `EXTERNAL` (load from a real file) | none |
| `Sync` / `Frequency` | parsed (`Frequency` default 100); `Sync` only affects the PlaySound fallback, no effect of `Frequency` was found in the DirectSound path | - |
Exec:
- `LOAD` (FUN_00424ca2): find slot by name, else take a free one (none free = silently fail). **If the slot already holds the same name and same file it does nothing** (cheap re-load). Different file: old buffer freed, new one created. The flags of the `Extra` are stored in the slot.
- `PLAY` (FUN_004259e4): slot found -> `loop = (AtEnd==REPEAT)`, `stored volume := Volume`, Play from position 0 (restoring a lost buffer), then `SetVolume(Volume)`. A `Play` of a name that is not loaded is ignored (fallback: PlaySound of the file).
  The volume of the *Play* statement is used, not the one of the Load statement: PLAYER.SCR repeats `Volume=` on Play lines (`Sfx Type=Play Name=$SFXDECREASE Volume=-1500 AtEnd=Repeat`).
- `KILL`: `Stop()` (buffer stays loaded). `UNLOAD`: release the buffer and data. Kill/Unload of unknown names: no-op.
PLAYER.SCR counts: LOAD 194, UNLOAD 182, PLAY 130, KILL 28; volumes -3000..0 (most -500/-1000); `AtEnd=REPEAT` 15x; `Extra=CANINTERRUPT` 11x, `PLAYONEATATIME` 1x.
Names may contain `#` (`PLL#`, `PLR#` = left/right footsteps; the footstep wave files come from `$grndPLL`/`$grndPLR` variables per floor type, section `[GELUID] #LOAD`).

### 12.3 `Instruction Type=SFX Value=...` (FUN_00425f13). Type 0x12. `Name` = sound name (resolved), `Contents` = number.
| Value | effect |
|---|---|
| `PLAY` | play once at volume `atoi(Contents)` (e.g. `Name=$LF2_FILE1 Contents=-1000`): no loop, no file argument (so the sound must have been loaded before) |
| `KILL` | stop |
| `WAIT` | block until the sound stops (s6.5). Unloaded sound = not playing = continues immediately |
| `VOLUME` | `stored := atoi(Contents)`, `SetVolume(stored)`; the slot is found by name, **or by file name** if no slot has that name (FUN_00424fce); no-op if neither exists |
| `MODVOLUME` | `stored += atoi(Contents)`, `SetVolume(stored)` (relative; slot by name only; the **stored** value keeps accumulating even if DirectSound rejects an out-of-range value; PLAYER.SCR uses +-5000/+-500/+-100 pairs, e.g. `[SFXWIN]` ducks the music by -5000 and restores +5000) |
PLAYER.SCR: WAIT 38, MODVOLUME 30, PLAY 8, VOLUME 5.

### 12.4 `Wave` statement (FUN_00426dee parse, FUN_00427485 exec, FUN_00427779 open, FUN_00427a5f play, FUN_0042766d stop). Type 7.
Streamed audio file for long tracks (**not** a Sfx slot): `Wave Type=PLAY File=MEDIA\pardoes.wav Name=music AtEnd=Repeat` and `Wave Type=KILL Name=music` - the title/exit music (`[CMDEXITTITEL] #STARTWAVE`, 18 MB stereo, loose file relative to the EXE directory).
Types: `PLAY` 1, `WAIT` 2, `KILL` 3 (default), `PAUSE` 4, `OPEN` 5, record types 6-10; `AtEnd`: `REPEAT` 3, `STOP` 1, `CLOSE` 2 (default when absent; an unknown value = STOP); `Extra=AMOVIE`; `Volume` (default 0), `Frequency` (percent, 100), `Relative` (object that pans the sound).
Streamed through DirectSound streaming buffers (FUN_00434416 / FUN_00435394) when DirectSound is active, else MCI/ActiveMovie. WAIT blocks until the end (then `0x464` is posted to the waiting thread).

### 12.5 Music/ambience/volume design in the script (all script-level, no engine support)
- `[SFXMUSIC]` / `[SFXAMBIENCE]` implement a two-slot **crossfader** on top of Sfx slots named `sfxMusic` / `sfxMusicNew`. Variables: `$SFXMUSICTOLOAD` (wanted file, set by each screen's `#CREATE`: `Set $SFXMUSICTOLOAD=leeg.wav`), `$SFXMUSICLOADED`,
  `$SFXMUSICPLAYING`, `$SFXDECREASE` (slot fading out), `$SFXINCREASE` (slot fading in), `$VOLMUSICNEEDED` (target volume, set with `|-1500` etc. per screen), `$VOLAMBIENCENEEDED`. A new track is loaded into the idle slot, started at `Volume=-3000`
  (`Sfx Type=Play ... Volume=-3000 AtEnd=Repeat`), then `[VOLUME] #INDECREASE` starts timer `TIMERVOL` (100 ms): each tick (`#RUNINDECREASE`) runs `$VOLCOUNT += 1`; while `$VOLCOUNT != $VOLMAX` it does
  `MODVOLUME $SFXDECREASE += $VOLMUSICDEC` (**-200**, s4.3) and `MODVOLUME $SFXINCREASE += $VOLMUSICINC` (**+100**); the tick on which `$VOLCOUNT == $VOLMAX` (**16**; i.e. 15 fade steps, 1.6 s) runs `#STOP` instead: kills the timer and the old slot (`GOSUB KILL`) and sets the new slot to `$VOLMUSICNEEDED`.
  Ambience: `sfxAmbience`, looped at `Volume=-1400`, then `VOLUME` set to `$VOLAMBIENCENEEDED`.
- `[SFXTEMP]` runs fire-and-forget voice lines (`#RUN1/RUN2/RUNX1/RUNR`: Load -> Play -> `SFX WAIT` -> Kill -> Unload). `[SFXWIN]`, `[SFXKRING]` duck music/ambience by -5000 for a jingle (`TUNEok.wav`, `TUNEkrs.wav`) and restore.
- Variables named in the task (`$VOLMAX`, `$VOLMIN`...): `$VOLMIN=0`, `$VOLMAX`=16 (set twice: 18 then 16), `$VOLCOUNT` fade-step counter, `$VOLDIR/$VOLDEC/$VOLINC/$VOLIDC` direction selectors (only `INDECREASE` is used), `$VOLMUSICNORMAL` (-3000) and `$VOLMUSICDOWN` (-6000) are only referenced by disabled lines.
- There are **no `[GELUID]` volume sliders**: `[GELUID]` is the footstep loader. No user-adjustable volume exists in the game.

### 12.6 Sounds played by sprites (.SPR frames: `Sfx=NAME Volume=V`; FUN_00449620, FUN_0044e56c, FUN_0044e49d, FUN_00434a71, FUN_00434ac8)
When a sprite enters a frame/move that carries `Sfx=NAME Volume=V`:
```
if sound(NAME) is currently playing AND has PLAYONEATATIME: do nothing
else:
   if the sprite's current sound exists and has CANINTERRUPT: stop it
   if NAME != "KILL":  sprite.sound = NAME; sprite.vol = V;
                       play NAME (loop if the sprite is set to repeat sounds, extra SFXMUSTREPEAT) at volume V
                       volume  = V - (100 - scale%) * 20        // scale = sprite size/depth percentage (default 100); smaller = quieter
                       pan     = ((spriteX + spriteWidth/2) - 320) * (3000 / 320)   // = * 9 (integer division), +-2880
   (name "KILL": nothing new is played; the sprite's current sound is stopped only if it has CANINTERRUPT)
```
`Sfx` names in .SPR files are mixed-case (`SFXalgElf1`) while Sfx statements are upper-cased: UNCERTAIN whether the .SPR loader upper-cases (it must, because the slot match is exact; graphics agent to confirm).
Sprite sounds are also stopped when the sprite ends/is killed (FUN_0042599a) and re-panned/re-attenuated as the sprite moves.
Web Audio mapping: `GainNode.gain = 10^(vol/2000)`; pan: attenuate the far channel by `|pan|/100` dB (left gain = 10^(-max(pan,0)/2000), right gain = 10^(-max(-pan,0)/2000)) - or use `StereoPannerNode` with `pan ~ p/2880` clipped.

---------------------------------------------------------------------------------------------------

## 13. Debug keys, hidden keys, command line
- Hidden Commands `CMDDEBUGF2..F9` (lines 737-744, each `Command ... KEY=F2..F9`) are **disabled in the shipped script** (`/` prefix) but their sections exist (lines 1017-1060): F2 `GOSUB INCREASE RATTAR`, F3 `SCRIPT Value=DEBUG Name=SCRIPT` (dump items), F4 `... Name=THREAD`
  (dump threads), F5/F6 music volume -/+500, F7/F8 `DECREASE/INCREASE CMDSK1MACHINE`, F9 `OBJECT Value=DEBUG`. The dump routines write to a stubbed log. `CMDTEST` (F2) and `CMDTESTPUZZEL` (F3) are also disabled.
- Easter eggs (FUN_004049b9, FUN_00404884): WM_CHAR appends to a 252-char buffer; at **left-click on pixel (0,0)** with the right button held, if the buffer equals `reanderloeaot` the window shows "And you know it's true!", if `whomadeit` "Made by: R.J.Hoevenberg", drawn at (1,1) in colour (200,200,0); Ctrl+Shift at that click clears the buffer.
  **Ctrl+Shift+click** on a Command runs `#CLICKHAHA` if the item has it (FUN_004129dd) - a developer shortcut present in the shipped data once (`CMDDR1RUILSTEEN`).
- Command line (FUN_00404a1e): `-FOREGROUND` (close on deactivation), `-TEST` (draw rounded rectangles for Commands = hit-area debug), `-D:dir` / `-S:script` / `-T:language`, `/V` (overlay "Programma versie 1.01 NL" / "Copyright Reho Productions, Almelo 1998"), `/S` `/P` `/C` screensaver modes.
- Debug overlay of the playing sound name/volume (`SFX: %s  Vol: %ld`, FUN_00424ba2) exists but is only drawn in `-TEST` mode.
- `DAT_0047a8ec` click-swallowing counter is never set (dead).

---------------------------------------------------------------------------------------------------

## 14. Inventory summary (full tables in `script-inventory.md`, generated by `tools/scr_inventory.py`)
Lines 22,7k: 522 items, 2584 sections, 89 sequences (only items `OBJECTS` and `KRING`), 6800 Set, 3162 Instruction, 956 If, 2310 Bitmap, 1654 Sprite, 626 Command, 534 Sfx, 43 Timer, 15 Movie, 5 Tekst, 2 EditBox,
2 Style, 2 Wave, 1 DxScreen, 1 Exit; ignored: 2365 blank, 715 `/` lines, 315 letter-prefixed disabled lines (`a`, `q`, `t`, `rjh`). Never used statement keywords: Area, Flyover, Install, Quiz, PuzJapans, Execute, CdAudio, Midi, TimeLine, ListBox, Message.
| statement | lines | parameter keys seen in PLAYER.SCR | status |
|---|---:|---|---|
| INSTRUCTION | 3162 | TYPE, TARGET, NAME, VALUE, CONTENTS | documented |
| SET | 6800 | $VAR=value | documented |
| STYLE | 2 | BASE, H, W, COLOR, NAME, FACENAME, PRINTER | documented |
| TIMER | 43 | TYPE, INTERVAL, MULTIPLIER, NAME, VARIABLE, ITEM, SECTION | documented |
| BITMAP | 2310 | TYPE, RECT, FILE, NAME, MASKINDEX, MASKINDEXCOLOR, EXTRA, FX, LEVEL, COLORIZE, COLFX, PAD, DXREF, PUZZLE, SIZE, REF | graphics |
| SFX | 534 | TYPE, NAME, FILE, EXTRA, VOLUME, ATEND | documented |
| MOVIE | 15 | TYPE, NAME, FILE, EXTRA, ATEND, RECT, VOLUME | graphics |
| TEKST | 5 | NAME, RECT, STYLE, COLOR, TYPE, CONTENTS, ALIGN, FX, FXTOP, FXBOT | documented |
| EDITBOX | 2 | NAME, RECT, STYLE, COLOR, TYPE, COPYTARGET, MAXLEN | documented |
| COMMAND | 626 | TYPE, RECT, NAME, STATE, EXTRA, LEVEL, MOUSEOVER, KEY, UP, DOWN, AFFECT | graphics |
| IF | 956 | ITEM, SECTION, NAME, COMPARE, OPERATOR, EXTRA, SEQUENCE, <left>=<right> operands | documented |
| SPRITE | 1654 | NAME, TYPE, START, SFX, VOLUME, MOVE, FILE, LEVEL, EXTRA, ALIGN, MOUSEOVER, AFFECTPOS, REDUCTION, TIMER, END, ATEND, AFFECT, BACKGROUND | graphics |
| WAVE | 2 | TYPE, NAME, FILE, ATEND | documented |
| EXIT | 1 |  | documented |
| DXSCREEN | 1 | TYPE, NAME, VELOCITY, START, BMPSIZE, SCREENSIZE, MAPSIZE, GROUNDMAP, OVERLAYFMAP, OVERLAYBMAP, OBSTACLEMAP, COLIDERMAP, SPRITE, BORDERS, BMPTIME, BMPGAUGE, BMPPOS, BMPDIR | graphics |

**Every keyword and parameter key that occurs in PLAYER.SCR is classified `documented` (core, s5-s12) or `graphics` in the inventory; the tool prints `UNDOCUMENTED` if it finds one (currently none).**

---------------------------------------------------------------------------------------------------

## 15. The 10 most important pitfalls for the implementer
1. **Everything is upper-cased, tokenised on blanks, no quoting.** Classify lines by the exact `strncmp` prefix list (s2.3); disabled lines are lines that do not start with a keyword. Back-tick = space inside values.
2. **A variable's initial value is the raw text of its first `Set`**, and `Set` has operator semantics: a value starting with `+ - * /` (no comma) is **arithmetic on the stored value**, `|` is the literal escape. `Set $VOLMUSICDEC=-100` ends up -200. Use `tools/set_sim.py` as the oracle.
3. **Two substitution mechanisms**: whole-token (If/Instruction/Sfx names: undefined = literal) vs `$`-prefixed expansion with `\` path-join (Set values, Sfx File: undefined = empty). `$A\$B` -> `<A>\<B>` is relied upon by the .SPR move names (`KRING1\A`).
4. **GOSUB is synchronous inside a thread; RUN/If-RUN start new round-robin threads**, one instruction per scheduler turn; a runnable chain runs to quiescence before input, timers or frames are handled. Implement `idx` and `ptr` separately to reproduce the "failed GOSUB skips the last instruction" quirk.
5. **If defaults**: `Extra` absent = RUN (new thread), `Compare` absent = RTOL (suffix compare!); PLAYER.SCR always says `Compare=EXACT`; `Type=KILL` = inert; `NAME=` has no meaning. Names are <=19 chars, first duplicate wins, sequences do not fall through, empty sequences are not startable.
6. **Timers**: `Static` on an existing timer is a no-op; `Disable` only mutes ticks (sprite clocks, sound-wait polling too); item timers start a *new thread every tick* with raw names; WAIT = one-shot timer; `$TIMERTIJD` (=1) scales every timer created with `Variable=`.
7. **Sound**: 100 named slots, one buffer per name (replay restarts), volumes in 1/100 dB with `MODVOLUME` accumulating the stored value, Play uses the *Play* statement's `Volume`, `File=?NNxxxx` random variants, `Sfx WAIT` polls on timer ticks, sprites play their frame sounds with CANINTERRUPT/PLAYONEATATIME rules and distance/pan formulas (s12.6).
8. **Engine-raised sections are few** (INIT, CLICK, CLICKHAHA, MOUSEDOWN/UP, FLYOVER/ENDFLYOVER, COLIDE, START, WIN, ENTER, SOLVED, PIECEOK/NOK, timer targets); CREATE/DESTROY/ENABLE... are script conventions. `Escape` only quits on the exit screen.
9. **Text**: Tekst `Rect` is x1,y1,x2,y2 with the "bottom<top -> top+20" fix; EditBox `Rect` is x,y,w,h; the edit box writes to `$SPELERNAAM` through the *operator-aware* assignment; the on-screen `Instruction Tekst Update` of the diploma uses `Target` as the name and therefore does nothing (s9.2).
10. **No savegame, no volume sliders, no registry beyond the randomizer.** Printing = one A4 page: rotated certificate bitmap + vertically stretched name; replace with `@media print`.

---------------------------------------------------------------------------------------------------

## 16. Reference implementation sketch (TypeScript)

```ts
// ---- loading (s2) --------------------------------------------------------
type Stmt = { kw: string; kv: Map<string,string>; raw: string };      // kv: last value per key, order irrelevant except If operands
type Seq = { name: string; stmts: Stmt[] };
type Section = { name: string; seqs: Seq[] };
type Item = { name: string; sections: Section[] };

const PREFIXES: [string, number][] = [["[",1],["#",1],["@",1],["SET",3],["STYLE",5],["BITMAP",6],["COMMAND",7],["EXIT",7],["AREA",4],
  ["FLYOVER",7],["TEKST",5],["INSTRUCTION",11],["INSTALL",7],["QUIZ",4],["PUZJAPANS",9],["DXSCREEN",8],["EXECUTE",7],["MOVIE",5],["SFX",3],
  ["CDAUDIO",7],["WAVE",4],["MIDI",4],["SPRITE",6],["TIMER",5],["TIMELINE",8],["IF",2],["LISTBOX",7],["EDITBOX",7],["MESSAGE",7]];
const cStrncmp = (a: string, p: string, n: number) => (a + "\0".repeat(n)).slice(0, n) === (p + "\0".repeat(n)).slice(0, n);

function classify(line: string) { for (const [p, n] of PREFIXES) if (cStrncmp(line, p, n)) return p; return null; }

function parseLine(raw: string) {
  const line = raw.replace(/[\r\n].*$/s, "").toUpperCase();
  const tag = classify(line);
  if (!tag) return null;
  if (tag === "[") return { kind: "item", name: line.slice(1, -1).slice(0, 19) };
  if (tag === "#") return { kind: "section", name: line.slice(1).slice(0, 19) };
  if (tag === "@") return { kind: "seq", name: line.slice(1).slice(0, 19) };
  const toks = line.split(/[ \t]+/).filter(Boolean).slice(1);        // token 0 = keyword is skipped
  const kv = toks.map(t => { const m = /^([^= ]*)[= ]*(.*)$/.exec(t)!; return [m[1], m[2].split("=").pop()!] as const; });
  return { kind: "stmt", kw: tag, kv };
}
// Build items/sections/seqs; `[`->new item, current section="" ; first stmt after '#' creates the unnamed sequence ""
// Lookup: first match by name; seq "" = first sequence; empty sequence or any miss = fail.

// ---- variables (s4) -------------------------------------------------------
const vars = new Map<string,string>();               // first Set (file order) declares: vars.set(name, rawValue) if absent
const readVar = (s: string) => vars.get(s);          // whole-token substitution: readVar(tok) ?? tok
function expand(v: string): string { /* if v starts with '$': names end at '\\'; undefined -> ''; add '\\' after non-empty value; see s4.2 */ return v; }
function assign(name: string, rawVal: string) {
  const v = expand(rawVal);
  const cur = vars.get(name);
  if (cur === undefined) return;
  let out = v;
  if (/^[+\-*/]/.test(v) && !v.includes(",")) {
    const a = parseInt(cur, 10) || 0, b = parseInt(v.slice(1), 10) || 0;
    out = String(v[0]==="+" ? a+b : v[0]==="-" ? a-b : v[0]==="*" ? a*b : Math.trunc(a/b));
  } else if (v[0] === "|") out = v.slice(1);
  vars.set(name, out.replaceAll("`", " "));
}

// ---- threads (s6) ---------------------------------------------------------
interface Frame { seq: Seq; idx: number; ptr: number; }       // idx and ptr are separate counters!
interface Thread { id: number; frames: Frame[]; waiting: boolean; notify: number; }
const queue: number[] = [];                                    // FIFO of runnable thread ids (the WM_USER+100 messages)

function start(item: string, section: string, seq: string): Frame | null { /* lookups of s3.2, null if any miss or empty */ return null; }
function gosub(t: Thread, a: string, b: string, c: string) {
  const f = start(a, b, c);
  if (f) { t.frames.push(f); return; }
  // failure quirk: the caller's idx advances once more (s6.4)
  const top = t.frames[t.frames.length-1]; top.idx++; popWhileDone(t);
}
function runNew(a: string, b: string, c: string): number | -1 { /* allocate slot <30, push first frame, queue.push(id) */ return -1; }

function step(t: Thread) {                                      // one scheduler turn for thread t
  let f = t.frames[t.frames.length-1];
  f.idx++;
  if (f.seq.stmts.length < f.idx) {
    const p = popFrame(t);              // parent.idx++ ; repeat while parent past its end; null = thread finished (notify)
    if (!p) return;
    f = p;                              // the parent executes its next instruction in this same step
  }
  const r = exec(f.seq.stmts[f.ptr], t);                        // 'cont' | 'retry' | 'blockedDone'
  if (r === "retry") { f.idx--; t.waiting = true; return; }
  f.ptr++;
  if (r === "blockedDone") { t.waiting = true; return; }
  queue.push(t.id);                                             // yield: next instruction on the next turn
}
// main loop: while (queue.length) step(threads[queue.shift()!]);  then timers / input / frame.
```
Timers: `Map<name,{period,enabled,item?,section?,seq?,waitTid?}>`; tick = `setInterval` with the period; ticks of disabled timers are dropped.

---------------------------------------------------------------------------------------------------

## 17. UNCERTAIN list and open questions
1. Variable-quirk consequences (initial raw value + arithmetic prefix): derived from FUN_00413e10/FUN_00414320/FUN_00414fd5; supported by: `|` used for negative literals (79x), `$A\$B` confirmed by .SPR data. Not verified on a live game. Open: does any later logic rely on the doubled `$VOLMUSICDEC` (-200)? (music crossfade only).
2. Relative priority of posted messages vs. input/timer/paint (s6.3) is Win32 behaviour, not code.
3. `Command KEY=` ignoring STATE (s7.1) - graphics agent should confirm in FUN_00418baa's table (state field +4 == 2 means "created").
4. Thread 0 hard-wired in `Wait Value=0` resume and a single global thread id for `Sfx WAIT` (s6.5): behaviour with several concurrent waiters unknown; PLAYER.SCR does not use `Wait Value=0`.
5. `Tekst ShadowPoint` unused?; Tekst draw persistence/restore details (FUN_0041318f, FUN_0040d973 not decoded); the `FX` glyph warp itself (FUN_004338ca) was only decoded as far as its polyline set-up (s10).
6. Timer period granularity on the original OS (s8.1); animation speed is the graphics agent's question (sprites advance one frame per tick of their clock).
7. Whether the .SPR loader upper-cases `Sfx=` names (s12.6).
8. `CANINTERRUPT`/`PLAYONEATATIME` meaning is inferred from FUN_00449620 (the only reader of the slot flags that was found).
9. On-screen name Tekst on the diploma (s9.2) - bug or intended?
10. Printer margins/offset `Escape(0x100D)` call in FUN_0043babb not decoded; the print layout above is the nominal one.
11. DAT `Sfx File=` lookups: exact names (e.g. `PTWINK.WAV`) are upper-case in the archive; a port should upper-case before lookup.

---------------------------------------------------------------------------------------------------

## Appendix A - function index (address: role)
Loading/DAT: 004056fd WndProc; 00404e76 main loop + DAT open; 00405069 window + title + script load; 00404c08/00404a1e command line; 0046a5ea DAT open; 0046a81f DAT find; 0046aa55 DAT line read; 0046b710 bsearch; 0046a590 strcmpi compare;
00402522 script load; 00415f19 uppercase; 00415f71 classify; 00415cc0 CR/LF strip; 00415dcf/00415ee3/00415d25 tokenizer + key/value; 0040105d addItem; 0040126a addSection; 004014b9 addSequence; 00401e19 addInstruction.
Threads: 00401834 slot alloc; 004017ac start frame; 004018c1 pop; 004019f3 RUN; 00401a7b GOSUB; 00401939 duplicate-run check; 00401f91 deepest frame; 00401fb3 step; 00403773 0x464 handler; 00401b3a/00401bfc/00401d0e item info / next / previous sequence;
0041341b record last-run triple.
Variables: 00413d80/00413e10 Set parse; 004142e5 Set exec; 00414320 store; 00414fd5 expand; 00413e9a read; 0041423f lookup; 004145ac/004147bd time/date builtins; 004167f9 backtick->space; 0045f3d0 atoi.
If: 00439c90 parse; 0043a33f/0043a371 exec. Instruction: 0042061e parse; 004213f5 exec; 00420580 rand(1..n); 0042218e/004222b3 registry read/write; 004224a0 resume wait; 004223c6 flush mouse; 00403803 SCRIPT instruction.
Timers: 00438d17 parse; 0043934c exec; 00438c30 slot create; 00439437 SetTimer; 004392e8 kill; 0043952d WM_TIMER; 004396fa/00439afb TimeLine.
Text: 004153d3 Style; 00415915 CreateFont; 0041dc30 Tekst parse; 0041e9ac exec; 0041e93d kill; 0041f08e/0041f1cc/0041f620 draw; 0042028c update; 0041db79/0041d9ff/0041d8ee text resources; 00431270 EditBox parse; 004321fa exec; 00432501 subclass proc.
Print: 0043bdb7; 0043b1bf report parse; 0043babb print job; 0043b506 element; 0043b970 section; 0043bfae PrintDlg; 0043c01a StartDoc; 0040740c aspect draw.
Sound: 00425303 Sfx parse; 00425b50 Sfx exec; 00424ca2 load; 00424f0f unload; 004259e4 play; 0042599a stop; 00425914 is-playing; 00425d42/00425daf volume/modvolume; 00425e10 pan; 00425f13 Instruction SFX; 00433ec0/00433fba DirectSound init; 00436af3 buffer create;
00434148 Play; 004342b2 SetVolume; 00434a71 pan formula; 00434ac8 attenuation; 00449620 sprite sound; 0044e56c/0044e49d sprite volume/pan; 00426dee Wave parse; 00427485 Wave exec; 00427779 open; 00427a5f play; 0042766d stop.
Input: 00418baa key->command; 004129dd mouse up; 004123a5 mouse down; 00411b1e mouse move; 004049b9/00404884 hidden text; 00422453 skippable-wait test.
