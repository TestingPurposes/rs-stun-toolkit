# Monkey Madness bot script (rs-sdk, protocol revision 289)

A headless bot that plays the whole **Monkey Madness** quest: from King Narnode under the Grand Tree to Daero's combat training reward. No browser is involved: the bot speaks the game protocol directly.

## Run it on a real server (no cheats)

1. Create `bots/<account>/bot.env` in the repository root:
   ```
   BOT_USERNAME=<account>
   PASSWORD=<password>
   SERVER=rs-sdk-demo.fly.dev
   ```
2. Prerequisites for the account (each one was hit while testing in the offline sim):
   - **Quests:** The Grand Tree and Tree Gnome Village complete.
   - **Start position:** next to King Narnode under the Grand Tree (2464, 9896).
   - **Magic 75+:** the Jungle Demon is fought with Fire Wave. The Varrock teleport out of the atoll needs Magic 25.
   - **Agility 68+:** the crate drop into the Ape Atoll warehouse cellar. Below that you can fall and take damage.
   - **Prayer 43+:** the atoll needs Protect from Melee and Protect from Missiles (40) for about 3,000 ticks. Higher is better. The sim uses Prayer 99 and 4 prayer potions, and finishes phase 2 with 0 to 2 potions left.
   - **Defence about 70 and Hitpoints about 70.** At Defence 1, the gorillas, archers and temple guards eat all the sharks before the greegree is made, and in the sim that account died at the temple. Even at Defence 70, a run with extra knockouts (village guards send you to jail) used up 10 sharks before the second Zooknock visit, so MM0 carries 12.
   - **Weapon:** optional. The sim wields a rune scimitar. The greegree goes in the weapon slot, so the weapon moves to the pack.
   - **Pack:** carry only the supplies. MM0 is 25 items plus the seal, and the quest adds up to 4 more. Narnode's reward needs 3 free slots.
   - **No teleports while the backpack monkey is in your pack** (from the zoo to Awowogei). Every teleport deletes it, and that includes spells, tablets and spirit trees. That's why the script walks from Ardougne zoo to the Grand Tree.
3. Supplies: print the lists with `bun headless/speedrun/legs/run-monkey-madness.ts --supply`.
   - **MM0** must be in the pack before phase 2: gold bar, ball of wool, 5 bananas, monkey bones, 12 sharks, 4 prayer potions (4-dose), 1 antipoison.
   - **MMD** must be in the pack before phase 3: staff of fire, 160 blood runes, 800 air runes, 1 law rune, 8 sharks.
   - The script checks the pack before each phase. If anything is missing, it logs out and prints exactly what's short.
4. Run:
   ```
   LC_HOST=rs-sdk-demo.fly.dev bun headless/speedrun/legs/run-monkey-madness.ts --live <account>
   ```
   Live mode blocks every staff command, so the run is cheat-free.
5. To resume mid-quest, set `MM_START=<stage>`. The stage names are listed in the launcher (`ORDER`). Quest items you've already used up are not asked for again.

## Try it offline first (local engine)

Start a local rs-sdk engine with staff cheats enabled (`LOCAL_STAFF_LEVEL=4`). Sim mode creates a fresh account and uses cheats only to set things up. It drops the tutorial kit (runes included), marks the two prerequisite quests complete, and sets stats: Attack/Strength 75, Defence 70, Hitpoints 72, Magic 80, Prayer 99, Agility 75. It also wields a rune scimitar, teleports to Narnode and hands over each phase's supplies.

```
LC_HOST=localhost:8888 bun headless/speedrun/legs/run-monkey-madness.ts --sim mytest1
```

- Use a new name for each run, because accounts persist on the server.
- `MM_START=<stage>` with `--sim` starts from a mid-quest checkpoint. Cheats set the quest variables, the items you'd hold at that point, and your position.
- A full run takes about 4,600-4,950 game ticks: phase 1 ~40, phase 2 ~3,600-3,900, phase 3 ~900-1,100.

`--sim` refuses any host that isn't local.

## Notes

- All quest progress is checked from what the client can see: items, position, dialog text and game messages. The server's quest variables aren't sent to clients, so the script never relies on them.
- One account per bot. Logging the same account in twice kicks the first session.
- A typecheck shows a few type warnings. They don't affect running: Bun runs TypeScript without typechecking.


## Measured
Phase 1 42 t, phase 2 3,622-3,760 t, phase 3 1,025-1,104 t; complete in 4,717-4,934 t. Random knockouts / guard boxing can still fail a run; no success rate measured yet.
