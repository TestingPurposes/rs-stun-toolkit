# Legends' Quest bot (rs-sdk, protocol rev 289)

A headless bot that does the whole of Legends' Quest, from the Legends' Guild gate to quest complete. The quest code
(`seg-a.ts` … `seg-d.ts`) never uses a staff cheat. It gates on what the client can see (items, position, dialog text, game
messages), because the quest varps are not sent to the client.

**Status: proven in the offline lockstep sim only. It has NOT been run on a live server.**

## Run it
From `server/webclient`:
```
bun headless/speedrun/legs/legends/run-legends.ts --supply                 # every kit, per segment, then exit
bun headless/speedrun/legs/legends/run-legends.ts --live <account>         # your account, no cheats (every staff command throws)
LC_HOST=localhost:<port> SIM_LOCKSTEP=1 TELEMETRY=false \
  bun headless/speedrun/legs/legends/run-legends.ts --sim [name]           # local engine only: cheats in the prerequisites + kits
```
- `--from A|B|C|D|E` and `--to A|B|C|D|E` run a slice of the segments.
- In `--sim`, `--from X` cheats in the state before segment X.
- In `--live`, `--from X` resumes at segment X with whatever the account holds.

## The segments (quest stages)
| Seg | Stages | What happens | Sim ticks |
|---|---|---|---|
| A | 0→5 | Guild guard, Radimus, machete, Brimhaven ship, Shilo cart, chop into the Kharazi jungle, map it, forester → bullroarer, Gujuo → Ungadulu rescue | ~375–475 |
| B | 5→12 | Cave rocks, Ungadulu, golden bowl, blessing, pure water, Shaman-cave trials, rune wall, 7 gems → Book of Binding, Nezikchened (fire) | ~1,120–1,500 |
| C | 12→20 | Yommi seeds, dried pool, bravery potion, winch, ledges, the three heroes (one crystal piece each), crystal heart, boulder, Echned → dark dagger | ~1,050–1,250 |
| D | 20→45 | Stab Viyeldi, Nezikchened (water), sacred water, out through the caves, plant + water + chop → totem, the three heroes, final Nezikchened, gilded totem | ~1,090–1,250 |
| E | 45→done | Camelot teleport (fallback: hack out, ship to Ardougne), Radimus, the trainings, quest complete | ~130–165 |

A full A→E chain took **3,883–4,305 ticks** in the lockstep sim: 6 of 6 passes on the development tree, about 20 minutes of game
time at 300 ms per tick.

The shared bundle was then run on a clean upstream checkout (rs-sdk `2012ab67f` plus only this zip) against a lockstep engine,
with `--sim`: **A→E quest complete in 4,084 ticks**. Per segment: A 395, B 1,197, C 1,115, D 1,202, E 150.

## Live prerequisites
`REQUIREMENTS` in `common.ts`. `--live` checks the skill levels before it starts. It can't check quests from the client, so
those are up to you.
- **Quests and points:** 107 quest points, and Family Crest, Heroes' Quest, Shilo Village (with Jungle Potion), Underground Pass
  and Waterfall Quest complete.
- **Skill levels:**
  - Agility 50, Crafting 50, Herblore 45, Mining 52, Smithing 50, Strength 50, Thieving 50, Woodcutting 50.
  - Prayer 43: the blessing, plus Protect from Melee in every fight.
  - Magic 56: charging a water orb, and the Camelot teleport.
- **Combat (recommended):** about 80 attack and strength, and 70 defence and hitpoints, for Nezikchened (×3), Viyeldi and the
  three heroes.
- **Higher levels make it smoother.** The sim ran with 99s. At the minimum levels, the agility, mining, thieving, map and
  planting rolls fail much more often. The script retries those steps, so expect more ticks.
- **Start position:** outside the Legends' Guild gate (2728, 3346).

## Supplies (`--supply` prints the same lists)
| When | Items |
|---|---|
| Before A (guild gate) | 60 coins, 5 papyrus, 2 charcoal, rune axe, rune scimitar, 5 sharks |
| Before B | rune scimitar (worn counts), 1 prayer potion (4), 4 sharks |
| B, after the junk drop | 2 gold bars, hammer, lockpick, rune pickaxe, soul, mind and earth rune, 2 law runes, one each of opal, jade, red topaz, sapphire, diamond, ruby, emerald |
| C, after the junk drop (in the Shaman caves) | rope, unpowered orb, 30 water runes, 3 cosmic runes, vial of water, 2 prayer potions, sharks up to 6 |
| D hand-off 1 (lower dungeon) | 2 prayer potions, super attack, super strength, 6 sharks |
| D hand-off 2 (Kharazi jungle, before the final summon) | 2 prayer potions, 8 sharks (trimmed to the free slots) |
| E (Kharazi jungle) | 1 law rune, 5 air runes, 40 coins |

## Known limits (read before a live run)
- **Live hand-offs are pack checks, not deliveries.** In the sim each kit is cheated in at its hand-off point. In `--live`,
  every hand-off checks the pack. If anything is short, the run stops, prints the missing list and the pack, and tells you to
  rerun with `--from <segment>`.
- **Helper mode (the max-QP route runner uses it):** no hand-off inside the jungle or caves. The main carries A's kit, B's
  fight kit and E's runes in; a helper bot meets it twice at (2816,2947), just north of the jungle belt, where B (anvil trip)
  and C (herb trip) leave the jungle anyway. `--supply` prints those lists too (`kits.ts`). This launcher still uses the
  hand-offs below.
- **Several hand-off points are deep in the Kharazi jungle or the Shaman caves (B, C, D, E).** You can't easily walk a helper
  there. For a live run, plan a bank trip at those stops, or carry the next segment's kit in from the start of that segment.
  The pack is tight: B's quest kit alone is 16 slots, and each segment drops what it won't use before its hand-off.
- **Resuming mid-segment isn't supported.** `--from X` restarts segment X from its beginning. The segments gate on what they
  can see, but restarting a half-done segment live hasn't been tested.
- **Gujuo's blessing roll favours low prayer.** At prayer 99 it fails about 98% of tries. Each try costs 5 prayer, so carry
  the prayer potion.
- **Bullroarer swings can anger savages, wolves and oomlie birds.** The script fights back and eats at 50% hp.
- **Death fails the run at once.**
- **Never chop in the jungle after filling the golden bowl.** It evaporates the pure water. The script already avoids this.
- **Stabbing Viyeldi is deliberate.** It's the fast route: it makes the final fight summon the three heroes, which do no
  damage under Protect from Melee.
