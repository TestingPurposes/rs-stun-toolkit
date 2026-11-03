# Holy Grail (rs-sdk bot script, rev 289)

A headless bot that completes **Holy Grail** (2 QP; reward 11,000 prayer and 15,300 defence xp, i.e. 275,000 /
382,500 at the demo's x25). Every step
is checked against the rev-289 content scripts (file:line in `q-holy-grail.ts`).

Route:
1. Camelot: King Arthur starts the quest; Merlin in his workshop upstairs.
2. Amulet of glory to Draynor: bank every weapon and armour piece (Entrana forbids them), take the Port Sarim monks' boat
   to Entrana, talk to the high priest (the crone appears).
3. Camelot Teleport, take the weapons back out at the Seers bank, Brother Galahad gives the holy table napkin.
4. Glory to Draynor, Draynor Manor top floor: the whistle door drops two magic whistles.
5. Karamja (glory, or Ardougne Teleport + Captain Barnaby's ship when the account has it), blow a whistle at the
   point of realm crossing: the Fisher King's realm.
6. Kill the Black Knight Titan (the strongest weapon, then Excalibur for the last blow: it must die with Excalibur worn;
   Protect from Melee makes it harmless). Its death carries you over the river. The fisherman gives the bell; ring it by
   a maiden, climb to the Fisher King.
7. Whistle back, Falador Teleport, free Sir Percival from the Goblin Village sack and give him the second whistle.
8. Karamja again, whistle into the restored realm, take the Holy Grail, whistle back, Camelot Teleport, King Arthur.

Launcher: `run-holy-grail.ts`; quest code `q-holy-grail.ts` (no cheats); helpers `ka-lib.ts`.

## Modes
- `--live <account>`: reads `bots/<account>/bot.env`. Every staff command is blocked.
- `--sim [name]`: local engine only. Sets Merlin's Crystal and Lost City complete, Attack/Strength 83, Defence 1,
  Hitpoints 72, Prayer 47, Magic 45, gives Excalibur and the supplies, teleports to the Camelot teleport landing.
  `GRAIL_ARD=1` adds Plague City (scroll read), Magic 51 and the Ardougne runes. `SIM99=1`: 99 melee/hp/prayer.
- `--supply`: prints the supply list and exits.

## Live prerequisites
- **Merlin's Crystal** complete and **Excalibur** in the pack or worn (500 gp from the Lady of the Lake if lost).
- **Attack 20** (Excalibur); the fight weapon's own requirement (dragon longsword: attack 60 + Lost City).
- **Prayer 43** (Protect from Melee for the Titan); proven at 47.
- **Magic 45** (Camelot Teleport). Optional faster Karamja legs: Magic 51 + Plague City finished *and its scroll read*
  (`%elenaquest` 30, teleport.rs2:22,35) + 60 coins.
- Free pack slots for the napkin, 2 whistles, bell and grail. Any other pack items that are weapons or armour, and
  everything not on the keep list, are left in the Draynor bank (worn gear and the fight weapon are taken back out).

## Supplies
| item | n | why |
|---|---|---|
| dragon longsword | 1 | Titan (any of dragon longsword, dragon battleaxe, dragon mace, rune scimitar works) |
| amulet of glory (4) | 1 | Draynor x2 + Karamja x2 (only Draynor x2 on the Ardougne route) |
| law / air / water rune | 3 / 13 / 1 | Camelot x2 + Falador |
| (law / water rune) | (4 / 4) | Ardougne Teleport x2, optional route |
| coins | 60 | Captain Barnaby x2, optional route |
| shark | 4 | food (none eaten under Protect from Melee) |

## Measured (lockstep sim, rev 289, chaos engines with random door states)
- **Glory route: 1005 / 1060 / 947 ticks** (seeds 3301-3303), median **1005** (~6.7 min at 400 ms/tick).
- **Ardougne route: 911 / 1021 / 848 ticks** (seeds 3311-3313), median **911**.
- 99 melee/hp/prayer, Ardougne route: 840 ticks (seed 3321): the Titan dies ~20 ticks sooner; not material.

| tick (seed 3313, Ardougne) | step |
|---|---|
| 27 / 50 | Arthur / Merlin |
| 64 | Draynor bank |
| 157 | crone (Entrana) |
| 183 / 252 | Seers bank / napkin |
| 331 | whistles |
| 419 | Fisher realm |
| 533 | Titan dead (crossed) |
| 580 / 602 | inside the castle / Fisher King |
| 682 | Percival |
| 769 / 819 | restored realm / Grail |
| 848 | quest complete |

## Limits
- The Titan's hp is read from its hitsplats; Excalibur goes on at 22 hp (a dragon longsword hits up to ~20 at
  strength 83). A stronger weapon needs a higher swap threshold.
- Completion is detected by the quest points varp.
