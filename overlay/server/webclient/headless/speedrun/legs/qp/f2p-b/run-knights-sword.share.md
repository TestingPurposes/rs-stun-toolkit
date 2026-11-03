# The Knight's Sword (rs-sdk bot script, protocol rev 289)

Plays **The Knight's Sword** (1 QP; smithing 12,725 xp, x25 on the demo) from the squire in Falador castle courtyard: Reldo,
Thurgo (redberry pie), blurite from the Asgarnian Ice Dungeon, Sir Vyvin's portrait, Thurgo makes the sword, squire.

Files: `q-knights-sword.ts` (quest code, cheat-free), `run-knights-sword.ts` (launcher), `fb-lib.ts` / `fb-launch.ts`, `fk-lib.ts`.

## Steps (verified in the 289 content, `quests/quest_squire/scripts/quest_squire.rs2` = QS)
1. Squire (606): "And how is life as a squire?" / "I can make a new sword if you like..." / "So would these dwarves make another
   one?" / "Ok, I'll give it a go." (QS:1-64).
2. Varrock Teleport; Reldo (647): "What do you know about the Imcando dwarves?" (QS:113-123). Required: Thurgo checks it (thurgo.rs2:2-5).
3. Glory -> Draynor, walk to Thurgo (604, 3001,3144): pie (QS:125-152), then talk again for the sword request (QS:154-161).
4. Ice dungeon ladder 1759 (3008,3150); mine blurite 2110 (mining 10). Falador Teleport straight out of the dungeon.
5. Squire: portrait hint (QS:72-77). Stairs 1738 (2954,3338 L0) and 1722 (2984,3337 L1) to Vyvin's room. Cupboard 2271/2272
   covers (2984-2985,3336) and is used from the SOUTH tiles (2985,3335)/(2984,3335); search with Sir Vyvin not within 1 tile of you
   (cupboards.rs2:20-33, QS:209-217); the script picks a south tile at least 2 from him and retries on "HEY!".
6. Glory -> Draynor straight from castle L2; Thurgo: portrait (QS:172-183), then blurite + 2 iron bars -> Faladian sword (QS:188-197).
7. Falador Teleport; squire takes the sword (QS:95-101). Completion via questpoint +1.

## Prerequisites
No quests. Mining 10 (blurite; 41 to use a rune pickaxe). Magic 37 (Falador Teleport; Varrock 25; without runes the script walks:
slower, not measured). No combat stats needed (see Measured).

## Supplies (`--supply`)
redberry_pie, 2 iron_bar, rune_pickaxe, amulet_of_glory_4 (2 Draynor charges used), 3 law + 9 air + 1 fire + 2 water
(Varrock + 2 Falador Teleports), 4 lobster (never eaten in the proofs). Start/end: the squire (2977,3343).

## Measured (lockstep sim, 400 ms tick; sim stats mining 41, magic 37, hp 40, def 40)
| run | engine | ticks |
|---|---|---|
| fk12 | normal | 487 |
| fk13 | chaos seed 301 | 500 |
| fk15 | chaos seed 302 | 506 |
| fk17 | chaos seed 303 | 499 |

| fk22 | chaos seed 303, hp 10 / def 1 | 504 |
| fk23 | chaos seed 304, hp 10 / def 1 | 492 |

Median **500 ticks** (~200 s). No combat stats are needed: hp 10 / def 1 passed twice (auto-retaliate off; no food eaten). The two Draynor -> Thurgo walks (199 tiles each, ~105 t incl. the dialog) are 40% of the quest.

## Limits
- The sim shows run energy 100 throughout; live run energy drains, so the long Port Sarim walks may be slower live.
