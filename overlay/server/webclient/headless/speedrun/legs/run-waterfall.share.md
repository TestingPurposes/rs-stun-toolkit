# Waterfall Quest (rev 289) — headless quest bot

Runs the whole Waterfall Quest: Camelot teleport, Almera and the raft, Hudon, the swim to Hadley's house and the book,
the run to the Tree Gnome Village dungeon for Golrie's pebble, a second Camelot teleport to Glarial's tomb (amulet + urn),
the raft again, rope on the rock and the tree, the ledge into the waterfall dungeon, Baxtorian's key, the two doors, one
air/earth/water rune on each of the six pillars, the amulet on the statue and the urn on the chalice. Reward: attack and
strength xp, 1 quest point, 2 diamonds, 2 gold bars, 40 mithril seeds.

Launcher: `server/webclient/headless/speedrun/legs/run-waterfall.ts` (quest code: `q-waterfall.ts`).

## Live prerequisites
- **Quests:** none.
- **Magic 45:** two Camelot teleports (start, and after Golrie). The launcher checks it.
- **Prayer 43 recommended:** the leg turns on Protect from Melee in Golrie's dungeon (hobgoblins), Glarial's tomb (moss
  giants, skeletons) and the waterfall dungeon (fire giants, spiders) whenever prayer is 43+. Below that it walks through
  unprotected: the sim account (hp 30, defence 30, prayer 43) still went 30 -> 13 hp, mostly in the waterfall dungeon.
  Bring more hitpoints or food if you have no prayer. It eats a shark at 5 hp.
- **Wear nothing but jewellery and carry no weapon or armour:** Glarial's tomb refuses them (`quest_waterfall.rs2`
  `waterfall_can_enter_glarials_tomb`). It also refuses **any rune**, so the pack holds exactly two Camelot teleports,
  spent before the tomb; the leg stops if a rune is left.
- **Free slots:** >= 7 at the chalice (the reward needs 5).

## Supplies (`--supply` prints them)
- **Phase 1 (at the start):** `rope` x1, `airrune` x10, `lawrune` x2, `shark` x3.
- **Phase 2 (after the tomb, for the pillars):** `airrune` x6, `earthrune` x6, `waterrune` x6. They cannot be carried
  into the tomb. In `--sim` they are handed over by cheat at the tomb exit. In `--live` the script checks the pack at
  that point (a helper bot can trade them there); if they are missing it stops with the list: fetch the runes, keep the
  amulet, urn and rope, and rerun with `WATERFALL_START=part2` from near Almera's house (2522,3498).

## Measured (offline lockstep sim, clean rs-sdk checkout at 2012ab67f + this zip)
- **980-982 ticks** (2 runs) for the whole quest (fresh account: magic 45, prayer 43, hp 30, defence 30; the rune hand-over at the
  tomb exit costs ~8 ticks of it).
- **220 ticks** for `WATERFALL_START=part2` (tomb exit -> chalice).

## Limits
- Only two entry points: the start, and `part2` (after the tomb, with amulet + urn + rope). Other mid-quest states are
  not resumable.
- The quest varp is not sent to the client; the leg gates on items, position and dialog text.
