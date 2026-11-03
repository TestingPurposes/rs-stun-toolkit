# Goblin Diplomacy (rs-sdk bot script, protocol rev 289)

Plays **Goblin Diplomacy** (5 QP) from the Rusty Anchor in Port Sarim: starts the quest with the bartender, dyes two of the
three supplied goblin mail, teleports to Falador and walks to the goblin village, and settles the generals' argument in four
short talks. Reward: crafting 2,000 xp (x25 on the demo) and a gold bar.

Files: `q-goblin-diplomacy.ts` (quest code, cheat-free), `run-goblin-diplomacy.ts` (launcher), `fg-lib.ts` (helpers for this
leg), `fb-lib.ts` / `fb-launch.ts` (lane helpers, unchanged).

## Steps (verified in the 289 content)
1. Rusty Anchor bartender (npc 734, 3045,3257): "Not very busy in here today, is it?" starts the quest
   (`areas/area_port_sarim/scripts/bartender.rs2:6-21`, `quests/quest_gobdip/scripts/quest_gobdip.rs2:13-19`).
2. Use the orange dye and the blue dye on goblin mail (`quest_gobdip/scripts/goblin_mail.rs2:1-12`). Orange and blue goblin
   mail are `tradeable=no` (`quest_gobdip.obj`), so the plain mail and the dyes are supplied and the script dyes them.
3. Falador Teleport (if magic >= 37 and the runes are carried), walk to the generals (Bentnoze 296 / Wartface 297, 2957-2958,3511).
4. Four talks, each three greeting pages then the stage reply (`quest_gobdip.rs2:85-128`): pick a colour; hand in orange; hand
   in blue; hand in plain (brown) mail -> completion queue (`:66-73`). In talks 2 and 3 the mail is taken and the stage advances
   right after the first player line, so the script re-clicks the general as soon as the mail leaves the pack (skips the
   flavour pages). Bentnoze's Dragon Slayer map choice (`general_bentnoze.rs2:21-32`) is answered by text if it shows.

## Prerequisites
None (no quest or skill checks). Magic 37 is optional: it enables Falador Teleport (walking from Port Sarim costs ~77 t more).

## Supplies (`--supply`)
goblin_armour x3, orangedye x1, bluedye x1 (all tradeable); lawrune x1, airrune x3, waterrune x1 (Falador Teleport, optional).
No coins or food. Start: Rusty Anchor, next to the bartender (3045,3255). End: goblin village, by the generals (2957,3510).

## Measured (lockstep sim, fresh accounts, magic 37)
| run | engine | ticks |
|---|---|---|
| fg33303 | chaos seed 3303 (2nd run on the world) | 88 |
| fg43303 | chaos seed 3303 (fresh restart) | 88 |
| fg42202 | chaos seed 2202 (fresh restart) | 90 |

Median **88 ticks** (~35 s at 400 ms). Splits: bartender 3, dyes 2, teleport 4, walk + first talk ~71 (the walk is ~66 t of
2-tile steps from the random Falador landing tile), then 3 + 2 + 3 for talks 2-4.
Without the teleport (magic below 37): 165 t (fg14).

## Limits
- The generals' hut has a large double door (1516/1519 at 2957-2958,3509). When it is open its LEFT leaf walls the west edge
  of (2957,3510); the shared leaf helper puts it on the wrong edge, so `fg-lib.ts fixDoubleLeaves` corrects it (without it the
  first talk stalled 16-40 t on "I can't reach that!" on some worlds).
