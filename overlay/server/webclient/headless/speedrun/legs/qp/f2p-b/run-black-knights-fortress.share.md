# Black Knights' Fortress (rs-sdk bot script, protocol rev 289)

Plays **Black Knights' Fortress** (3 QP) from Falador square: climbs the White Knights' castle to Sir Amik Varze, teleports
back to Falador and walks to the fortress in the guard disguise, crosses the fortress to the witch's grill, goes round to the
hole room, drops a cabbage into the cauldron, then teleports back to Sir Amik. Reward: 2,500 coins.

Files: `q-black-knights-fortress.ts` (quest code, cheat-free), `run-black-knights-fortress.ts` (launcher), `fg-lib.ts`
(helpers for this leg), `fb-lib.ts` / `fb-launch.ts` (lane helpers, unchanged), `probe-fg-bfs.ts` (offline route solver).

## Steps (verified in the 289 content)
1. Sir Amik Varze (npc 608, Falador castle L2 2960,3336), reached by the west stairs (2954,3338 L0 -> L1, 2960,3338 L1 -> L2;
   `ladders+stairs/scripts/stairs.rs2:198-199`): "I seek a quest!" / "I laugh in the face of danger!" (`areas/area_falador/scripts/sir_amik_varze.rs2:1-57`).
   Needs 12 quest points (`:15`).
2. Falador Teleport, walk to the fortress door (3016,3514), 176 steps, no wilderness. The door opens from outside only with a
   bronze med helm and an iron chainbody WORN (`quests/quest_blackknight/scripts/quest_blackknight.rs2:12-21`).
3. Inside: door / secret wall / 9 ladders / 2 plain doors to the grill room (route below); listen at the grill
   (loc 2342, 3025,3507 L0; `:121-136`).
4. Round to the banquet hall door (guard: "I don't care. I'm going in anyway." `:57-74`), ladder up (3022,3518), secret wall
   (3030,3510 L1) into the hole room; use the cabbage on the hole (loc 2336, 3031,3507 L1; `:89-107`). Any normal cabbage;
   the Draynor Manor magic cabbage is the wrong one.
5. Falador Teleport, castle stairs x2, Sir Amik completes the quest (`sir_amik_varze.rs2:59-75`, `quest_blackknight.rs2:152-158`).

Fortress route (offline Dijkstra over the rsmod collision, `probe-fg-bfs.ts`; ladders land on your own tile +-1 level,
`ladders.rs2:42-82`, so each climb is made from an exact stand tile): see `TO_GRILL` / `GRILL_TO_HOLE` in the quest file.

## Prerequisites
- 12 quest points (Sir Amik).
- Magic 37 (two Falador Teleports).
- Defence 40 / hitpoints 40 proven safe (no food eaten). Black knights (cl33) hunt players up to combat 66 (huntmode cowardly);
  the hall's knights attack anyway after the banquet-hall door answer, and door 2339 / the (3022,3518) ladder set more on you.
  The script never fights (auto-retaliate off).

## Supplies (`--supply`)
bronze_med_helm, iron_chainbody, cabbage, lawrune x2, airrune x6, waterrune x2, lobster x4 (safety; none eaten so far).
Start: Falador square (2965,3379, the Falador Teleport landing). End: Sir Amik, castle L2 (2960,3337).

## Measured (lockstep sim, fresh accounts, att/str/def/hp 40, magic 37)
| run | engine | ticks |
|---|---|---|
| fgb5 | normal | 288 |
| fgb6 | normal (door1 op rides the walk) | 290 |
| fgc606 | chaos seed 606 (fresh restart) | 284 |
| fgc707 | chaos seed 707 (fresh restart) | 286 |
| fgc808 | chaos seed 808 (fresh restart) | 287 |

Median **286 ticks** (~114 s at 400 ms), no food eaten. Splits (fgc707): castle climb 29, Sir Amik 8, teleport 4, walk to the
fortress 94, to the grill 37, grill 7, to the hole room 56, cabbage 15, teleport + castle + Sir Amik ~36.

Stats do not change the time: fresh account (att/str/def 1, hp 10) 284 t (ate 1 lobster), all 20s 286 t (ate 1), all 70s
286 t (combat 67+: the knights stop hunting you). Proven safe default: def/hp 40.

Variant `FG_BKF_TRAVEL=wild` (amulet of glory to Edgeville, then through wilderness levels 1-4; the warning modal is
closed by a watcher): 294 / 274 t. Not a clear gain and it walks a PvP zone, so it is off by default.

## Limits
- Sir Amik's talk must have closed fully before the teleport (a closed suspended script swallows the next teleport click).
- The cabbage takes 4 timed messages (8 t) before the stage is set; the script waits for the closing line before teleporting.
