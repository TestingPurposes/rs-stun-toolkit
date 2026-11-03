# Sea Slug (rev 289) — headless quest bot

Runs the whole Sea Slug quest with one command: Camelot teleport, Caroline in Witchaven, Holgart's boat to the fishing
platform, Kennith, Kent on the island, the damp sticks dried with the broken glass and rubbed into a lit torch, the panel
kick and the crane, and back to Caroline for the reward (fishing xp, 1 quest point, oyster pearls). Nothing fights.

Launcher: `server/webclient/headless/speedrun/legs/run-seaslug.ts` (quest code: `q-seaslug.ts`).

## Live prerequisites
- **Quests:** none.
- **Firemaking 30, CURRENT level:** the "rub together" step that lights the torch refuses below 30 (`quest_seaslug.rs2`). The launcher checks it.
- **Magic 45:** the leg always starts with a Camelot teleport. The launcher checks it.
- **Pack:** the supplies below + 3 free slots (broken glass, damp sticks, pearls). Start anywhere a teleport works.

## Supplies (`--supply` prints them)
- `swamppaste` x1 (Holgart takes it for the boat), `torch_unlit` x1, `lawrune` x1 + `airrune` x5 (one Camelot teleport).
- The damp sticks and broken glass are picked up on the platform by the script.

## Measured (offline lockstep sim, clean rs-sdk checkout at 2012ab67f + this zip)
- **383-406 ticks** (2 runs) from the teleport to the reward (fresh account: magic 45, firemaking 30).

## Limits
- The dialogs are driven as tick-tight blind bursts with adaptive fallbacks; a desynced boat or Kennith dialog is retried
  a few times, then the script stops with the reason. It cannot resume mid-quest: a rerun starts at the teleport and
  expects the quest not started.
- Fishermen NPCs on the platform can stand on the stand tiles; the script tries three stands around the crates.
