# Witch's House (rev 289) — headless quest bot

Runs the whole Witch's House quest: Falador teleport, the boy in Taverley, the door key under the potted plant, the
cellar (gloves on for the electrified gate) for the magnet, cheese for the mouse and the magnet on it (back door
unlocked), the shed key from the fountain and the shed itself while dodging the witch's patrol (a hedge-aware tick
controller; a catch is detected and the undone steps are repeated), the four shapeshifter forms, the ball, and back to
the boy. Reward: hitpoints xp, 4 quest points.

Launcher: `server/webclient/headless/speedrun/legs/run-witchhouse.ts` (quest code: `q-witchhouse.ts`).

## Live prerequisites
- **Quests:** none.
- **Magic 37** for the Falador teleport. Or set `WH_TELEPORT=0`, start in Taverley next to the boy (2928,3456) and skip
  the teleport runes.
- **Combat:** the shed fight is four forms in a row (combat 19, 30, 42, 53). The leg attacks with whatever you wield
  (or punches), eats a shark at half hitpoints and keeps Protect from Melee up when prayer is 43+, sipping the prayer
  potion when it runs low. The sim account (attack/strength 60, defence/hitpoints 40, prayer 43, unarmed) took 230-280 ticks
  for the fight, used 2 potion doses and ate nothing. Lower stats = a longer fight; bring more food.
- **Leather gloves** in the pack: the cellar gate shocks bare hands (`quest_ball.rs2`). The leg wears them.

## Supplies (`--supply` prints them)
- `cheese` x2 (a witch catch resets the mouse step), `leather_gloves` x1, `4doseprayerrestore` x1 (prayer potion),
  `shark` x6, and for the teleport `lawrune` x1, `airrune` x3, `waterrune` x1. The launcher checks the pack and stops with
  the missing list.

## Measured (offline lockstep sim, clean rs-sdk checkout at 2012ab67f + this zip)
- **654-674 ticks** (2 runs) for the whole quest, no witch catch (fresh account with the stats above).

## Limits
- No mid-quest resume: the leg re-checks items and messages every pass, but it assumes the quest is not started.
- If the witch catches you after the shapeshifter is dead, the quest stays past the mouse step; the leg handles this,
  but repeated catches cost time. The run stops after 2500 ticks.
