# Jungle Potion + Shilo Village (rs-sdk bot script, protocol rev 289)

A headless bot script that plays **Jungle Potion** and then **Shilo Village** on Karamja and walks into Shilo Village. Inside the village are the gem rocks, the only rev-289 source of uncut red topaz, plus opal and jade.

The phases, in order. Each phase checks something it can observe (an item, a stat or a position) before acting, so a rerun skips work that is already done:
1. **m-boat** (only if you are not on Karamja yet): sails from Port Sarim to Musa Point for 30 gp.
2. **k-shop**: buys a spade, chisel, rope, tinderbox, hammer, bronze bar(s) and a candle from Jiminua's store.
3. **k-smith**: makes bronze wire at the Tai Bwo Wannai anvil. Below Smithing 4 it first smiths a dagger.
4. **k-jungle**: plays Jungle Potion (Trufitus). It picks the 5 herbs (Snake Weed, Ardrigal, Sito Foil, Volencia Moss, and Rogue's Purse in the Rogues' cave), identifies each one, hands it in, and collects the reward.
5. **k-belt / k-start**: gets the Wampum belt from Mosol Rei and gives it to Trufitus. Shilo Village has now started.
6. **k-mound / k-azr**: digs into the Ah Za Rhoon mound and goes inside. It finds the stone plaque, the crumpled and tattered scrolls, and Zadimus' corpse, then leaves by the waterfall.
7. **k-bury**: buries Zadimus' corpse on the sacred ground and gets the bone shard.
8. **Bervirius, part 1**: climbs to Bervirius' isle off the south-west coast and enters his tomb for the sword pommel.
9. **k-beads**: chisels the pommel into beads, threads them on the wire and wears the Beads of the Dead.
10. **k-tomb**: makes the bone key and opens Rashiliyia's tomb. It uses 3 bones on the door, fights Nazastarool's three forms and takes Rashiliyia's corpse.
11. **Bervirius, part 2**: lays the corpse on Bervirius' dolmen. **Shilo Village is complete.**
12. **k-enter**: Mosol Rei lets you through the gate. Standing in the village is the script's proof that the quest is complete, because the gate refuses you until it is.

Progress is saved to `logs/shilo/<account>.json`. Rerunning with the same account skips the phases already finished, and `SHILO_START=<phase>` starts at a given phase.

## Live prerequisites
| Requirement | Why |
|---|---|
| **Druidic Ritual** complete | Jungle Potion requires it. Its Herblore reward also covers the next row. |
| **Herblore 3** | Needed to identify the 5 herbs (`identify.rs2`). |
| **Agility 32** | The Ah Za Rhoon fissure and the crawl-way into Bervirius' tomb check `stat(agility) < 32` (`quest_zombiequeen.rs2:390`, `:619`). The stepping stones and climbing rocks roll agility too; a slip costs some hp and the script simply retries. |
| **Crafting 20** | Needed for the bone key (`quest_zombiequeen.rs2:1285`; the beads check is 16). |
| **Smithing 4** | Needed for the bronze wire. The script only smiths one bronze dagger first (12.5 xp), so arrive at 4 or within one dagger of it. |
| **High Prayer** (43 minimum; 99 was proven) | Protect from Melee is turned on in Ah Za Rhoon and in Rashiliyia's tomb, which are full of undead. Below 43 it does not activate at all. The script has no way to restore prayer: with 70 prayer the points ran out before Nazastarool and the sim account died. |
| **Combat** | Nazastarool has three forms (combat levels 91, 68 and 93, `quest_zombiequeen.npc`), and the undead in both dungeons attack on sight. **Proven at 99 attack/strength/defence/hp** with a wielded adamant longsword. At 80 (prayer 70) the sim account died in the tomb, and at 70 (prayer 43) it ran out of sharks with 1 hp left. Treat anything below about 90 combat and prayer as untested. |
| **Start** | On Karamja, or anywhere the walker can reach Port Sarim from. |

## Supplies (`--supply` prints them)
- coins x2,000: Jiminua's tools cost a few hundred, plus 30 for the boat.
- bones x3: for the tomb door.
- shark x15: undead, slips and Nazastarool. The proven run ate 10. The script eats at 55-60% hp and drops sharks down to 6 when it needs room for herbs.
- A wielded weapon.
- Free slots: the tools and quest items take up to about 10 slots.

## Measured (offline lockstep sim, clean rs-sdk checkout)
This was run on a fresh account with 99 melee, hitpoints and prayer, agility 32, crafting 20, smithing 4 and herblore 3. Druidic Ritual was set complete, the account wielded an adamant longsword and carried 2,000 coins, 3 bones and 15 sharks, and it started at Jiminua's store. Result: **both quests complete in 3,644 ticks** (about 36 minutes at 600 ms per tick). Quest points went from 0 to 7: 4 from the Druidic Ritual setup, then 1 for Jungle Potion and 2 for Shilo Village.

| Phase | Ticks |
|---|---|
| k-shop + k-smith | 33 |
| Jungle Potion | 581 |
| Belt + start | 631 |
| Ah Za Rhoon (mound, inside, out) | 601 |
| Bury | 209 |
| Bervirius 1 + beads | 519 |
| Rashiliyia's tomb | 708 |
| Bervirius 2 | 295 |
| Enter the village | 67 |

10 of the 15 sharks were eaten.

**Failed runs, kept for honesty:**
- **70 melee/hp, prayer 43:** out of food with 1 hp left after the tomb.
- **80 melee/hp, prayer 70:** died in the tomb.
- **The first run** also exposed a timing bug when leaving Bervirius' tomb: a successful climb lands a few ticks after the success message. That is fixed in `q-shilo.ts`.

## Known limits
- Live, this chain ran start to finish on one of our accounts, starting from the mainland. That run also used the mainland prep phases, which are not part of this launcher.
- The phases named `k-ACCOUNT1` / `k-ACCOUNT2` in the code are the two Bervirius visits. Our share filter renames one word everywhere, consistently, so the code still works.
- Stepping stones, climbing rocks, the log bridge and the waterfall can all fail an agility roll. The script retries, but each failure costs hp, so carry food.
- If you die, the script stops (the next step fails). Rerun with the same account and it resumes from the saved progress.
- Mosol Rei wanders, and zombies crowd the gate. The script searches a few tiles for him and clears undead near him first.
