# Witch's Potion (rs-sdk bot script, protocol rev 289)

Plays **Witch's Potion** (1 QP) from Rimmington: talks to Hetty, kills a rat for its tail, hands in the four ingredients and
drinks from the cauldron. Magic reward 3,250 xp (x25 on the demo).

Files: `q-witchs-potion.ts` (quest code, cheat-free), `run-witchs-potion.ts` (launcher), `fb-lib.ts` / `fb-launch.ts` (lane helpers).

## Steps (verified in the 289 content)
1. Hetty (npc 307, 2968,3206): "I am in search of a quest." / "Yes help me become one with my darker side." (`areas/area_rimmington/scripts/hetty.rs2:2-8, :40-83`).
2. Kill any rat (npc 47, 2 hp) west of her house; the rat's tail drops only while the quest is started and none is held or banked (`drop tables/scripts/rat.rs2:9-12`). Untradeable, so the script always kills one.
3. Hetty takes onion + rat's tail + burnt meat + eye of newt (`hetty.rs2:13-26`).
4. Drink from the cauldron (loc 2024, 2967,3205): completion runs after the mesbox (`quests/quest_hetty/scripts/quest_hetty.rs2:1-13`).

## Prerequisites
None. No skill checks; a rat has 2 hp (proven on a fresh account: attack/strength 1, hp 10).

## Supplies (`--supply`)
eye_of_newt x1 (Betty, Port Sarim), onion x1, burnt_meat x1. Start: Rimmington (2964,3212). End: by the cauldron (2966,3206).

## Measured (lockstep sim, fresh accounts)
| run | engine | stats | ticks |
|---|---|---|---|
| fb14 | normal | fresh | 82 |
| fb15 | normal | fresh | 66 |
| fb16 | chaos seed 101 | fresh | 127 |
| fb17 | chaos seed 101 | fresh | 56 |
| fb21 | chaos seed 101 | fresh | 72 |
| fb18-20 | chaos seed 101 | attack/strength 40 | 83 / 88 / 57 |

Median 72 ticks (~29 s at 400 ms). Almost all variance is the rat: rats wander (wanderrange 15), and at attack 1 a 2-hp rat takes up to ~20 t;
attack 40 did not help measurably (the chase dominates).

## Limits
Hetty's door auto-closes 500 t after opening (`doors/scripts/doors.rs2`); the script handles either state (the open leaf is
added to the planner map, see `fb-lib.ts` leafWalls).
