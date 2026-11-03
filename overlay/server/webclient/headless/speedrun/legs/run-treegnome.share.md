# Tree Gnome Village (rs-sdk bot script, protocol rev 289)

A headless bot that plays the **Tree Gnome Village** quest from start to finish. Tree Gnome Village is one of the two prerequisites of Monkey Madness; the other is The Grand Tree (`rs-sdk-grandtree`).

Launcher: `server/webclient/headless/speedrun/legs/run-treegnome.ts`. Quest code: `q-treegnome.ts`, which never uses a cheat.

## What it does
1. Camelot teleport, then walks to the maze and squeezes through the loose railing.
2. King Bolren starts the quest, and Elkoy jumps you out.
3. Talks to Commander Montai three times and hands over the 6 logs.
4. Fires the ballista. The coordinates are fixed in the content (height 4, x 3, y 5), so the tracker gnomes are skipped.
5. Climbs the rubble wall and kills the Khazard commander if he attacks. Then it goes up the ladder and takes the orb from the chest.
6. Back to Bolren, via Elkoy and the railing.
7. Kills the Khazard warlord (lvl 112, 170 hp, def 80, crush). It eats sharks at 50% hp, keeps Protect from Melee up and drinks a prayer restore below 20 prayer.
8. Takes the orbs back to Bolren to complete the quest.

**Reward:** 2 quest points and 11,450 Attack xp.

**Ends:** inside the village next to King Bolren and the spirit tree. That is the start position of `run-grandtree.ts`.

## Live prerequisites
Print them with `--supply`. They also live in `TREEGNOME_REQUIREMENTS` in `q-treegnome.ts`.

- **Quests:** none.
- **Magic 45 (required, checked).** The leg starts with a Camelot teleport. The Ardougne teleport would be closer, but it needs Plague City.
- **Attack and Strength 60 or more (recommended).** The warlord has 170 hp and 80 defence. The sim runs att/str 83.
- **Hitpoints 60 or more (recommended).** The sim runs hp 72 with 10 sharks.
- **Prayer 43 (recommended).** Protect from Melee during the warlord fight. Without it, expect to need more sharks.
- **Gear:** wield a melee weapon (the sim wields a rune scimitar). Fighting the warlord barehanded takes very long.
- **Start:** anywhere a Camelot teleport works.

## Supplies (TG0: carry all of it at the start)
- `logs` x6 (for Montai)
- `lawrune` x1 and `airrune` x5 (Camelot teleport)
- `shark` x10
- `4doseprayerrestore` x2

The launcher stops before moving if anything is missing. The quest adds the orb (1 slot) and the orbs (1 slot). The logs are used up.

## Measured (offline lockstep sim, clean rs-sdk checkout + this bundle)
- **976 ticks** from the Camelot teleport to quest complete.
- **Splits:** maze railing at 303, ballista at 410, orb at 483, warlord dead at 833.
- **Stats:** att/str 83, hp 72, prayer 99, rune scimitar.
- **Supplies used:** no sharks and no prayer restores. The supply list is sized for lower stats.

## Limits
- **Content:** written for rev 289. The ballista coordinates come from `quest_tree.rs2` and are not read in game.
- **Late replies:** under a live-like reply delay, Montai's "gather some wood" choice can arrive after the first talk looked finished. The logs talk answers that choice too.
- **No resume:** the leg always starts with the maze and Bolren's start dialog, so a rerun after a partial run (death, disconnect) is not supported. If the warlord kills you, the run fails.
