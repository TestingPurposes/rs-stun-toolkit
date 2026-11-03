# The Grand Tree (rs-sdk bot script, protocol rev 289)

A headless bot that plays **The Grand Tree** quest from start to finish. The Grand Tree is one of the two prerequisites of Monkey Madness; the other is Tree Gnome Village (`rs-sdk-treegnome`, whose end position is this script's start).

Launcher: `server/webclient/headless/speedrun/legs/run-grandtree.ts`. Quest code: `q-grandtree.ts`, which never uses a cheat. The quest varp isn't sent to the client, so every step checks its own evidence: items, position and dialog.

## What it does
1. Village spirit tree to the Gnome Stronghold. King Narnode starts the quest and gives you the bark sample.
2. Walks to Hazelmere's island for the scroll, then back through the village and the spirit tree.
3. Narnode's translation quiz, then Glough, Narnode again, and Charlie in the jail.
4. Takes the journal from Glough's cupboard. Glough has you arrested, and Narnode frees you.
5. Glider to Karamja. Passes the shipyard gate ("Ka Lu Min"), answers the foreman and gets the lumber order.
6. Varrock teleport, then the young tree back to the village and the spirit tree to the stronghold.
7. Charlie again, then Anita for Glough's key. Glough's chest gives the invasion plans.
8. Narnode gives the 4 twigs. Climbs Glough's tree (agility 25) and puts the twigs on the pillars (T U Z O).
9. Goes down the trapdoor and kills the Black Demon (lvl 172, 157 hp, def 152). It keeps Protect from Melee up, eats sharks at 45% hp and drinks a prayer restore below 10 prayer.
10. Narnode sends you to the roots. It searches them nearest-first until the Daconia rock turns up (1 of 15, random), then hands the rock to Narnode to complete the quest.

**Reward:** 5 quest points, plus Agility 7,900, Attack 18,400 and Magic 2,150 xp.

**Ends:** under the Grand Tree next to King Narnode (2466,9896), which is where Monkey Madness starts. The pack still holds 5 spent quest items: Glough's key, the scroll, the translation book, the journal and the lumber order. Drop them if you need the room.

## Live prerequisites
Print them with `--supply`. They also live in `GRANDTREE_REQUIREMENTS` in `q-grandtree.ts`.

- **Tree Gnome Village complete.** The script travels by the village spirit tree, which only works after that quest.
- **Agility 25 (required, checked).** Glough's tree refuses lower levels (`quest_grandtree.rs2`).
- **Magic 25 (required, checked).** The Varrock teleport back from Karamja.
- **Attack and Strength 70 or more (recommended).** The Black Demon has 152 defence. The sim runs att 92 and str 83.
- **Hitpoints 60 or more (recommended).** The sim runs hp 72 with 6 sharks and 3 prayer restores.
- **Prayer 43 (recommended).** Protect from Melee during the demon fight.
- **Gear:** wield a melee weapon (the sim wields a rune scimitar) and keep 6 free slots.
- **Start:** inside Tree Gnome Village next to the spirit tree (2542,3170). That is where `run-treegnome.ts` ends. From outside the village, the walk to the tree can fail, because the village is entered through a scripted railing.

## Supplies (GT0: carry all of it at the start)
- `shark` x6
- `4doseprayerrestore` x3
- `lawrune` x1, `airrune` x3 and `firerune` x1 (Varrock teleport)

The launcher stops before moving if anything is missing or fewer than 6 slots are free. If the pack is short of room when Narnode hands over the twigs, the leg drops surplus food beyond 6 sharks and 3 restores.

## Measured (offline lockstep sim, clean rs-sdk checkout + this bundle)
- **1,991 ticks** from the village spirit tree to quest complete.
- **Splits:** Hazelmere's scroll at 423, released from jail at 867, lumber order at 999, invasion plans at 1,292, pillars at 1,381, Black Demon dead at 1,593.
- **Roots:** the search took 308 ticks this run. It varies, because the rock's root is random.
- **Stats:** att 92, str 83, hp 72, prayer 99, agility 25, rune scimitar.
- **Supplies used:** the demon fight took about 30 prayer points. No sharks and no prayer restores were used.

## Limits
- **Content:** written for rev 289.
- **Random root:** the root search takes 1 to 15 roots, so the length of the last stage varies.
- **Cutscenes:** the arrest and the Black Demon intro are cutscenes. The leg waits them out, because clicking during them aborts the script on the server.
- **Resume (sim only):** `GT_START=<stage>` restarts a sim run mid-quest from a cheat checkpoint. Stages: start hazel relay glider return evidence twigs demon roots. On a live account `GT_START` only skips the earlier stages, so the account must already be in that stage's state.
- **Death:** if the demon kills you, the run fails.
