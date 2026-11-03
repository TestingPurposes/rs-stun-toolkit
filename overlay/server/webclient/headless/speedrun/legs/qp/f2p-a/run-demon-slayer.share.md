# Demon Slayer (rs-sdk bot script, rev 289)

Completes **Demon Slayer**: Gypsy Aris -> Sir Prysin -> the palace drain and the sewer key -> Lumbridge Teleport -> 25 bones
(Draynor bank, or a helper on Traiborn's floor) -> Wizard Traiborn's key -> Varrock Teleport -> Captain Rovin's key ->
Sir Prysin (Silverlight) -> Delrith in the stone circle with the incantation. Reward: 3 quest points.

Launcher: `run-demon-slayer.ts`; quest code `q-demon-slayer.ts` (no cheats); helpers `fa-lib.ts`.

## Modes
- `--live <account>`: reads `bots/<account>/bot.env`; every staff command throws. Bank 25 bones at Draynor first (or have a
  helper trade them on the Wizards' Tower first floor: `run(bot, { helper: '<name>' })`).
- `--sim [name]`: local engine only. Stages 25 bones in the Draynor bank, sets the sim stats (magic 31, att/str 45,
  def 20, hp 30, prayer 1 = combat 41), gives the supplies (staff of air wielded), teleports to Varrock square.
  `FA_BONES=helper` runs a second local account as the helper instead of the bank stage; `FA_TRAIBORNFIRST=1` /
  `FA_NOTELE=1` are A/B switches.
- `--supply`: prints the supply list.

## Prerequisites
- Quests: none. Magic 31 (Lumbridge Teleport; Varrock Teleport 25).
- **Combat level 41 or more** (checked at the start): the eight dark wizards in the stone circle hunt players of combat 40
  or less (`Npc.ts:1011`: not when combat > 2 x their level 20), and while one is on you Delrith cannot be attacked
  ("I'm already under attack!"). At combat 30 the sim never landed a hit on Delrith.
- Pack: 25 bones must fit unnoted at Traiborn (`traiborn.rs2:13,23`), so the bot carries only the supplies below.

## Supplies
| item | n | why |
|---|---|---|
| coins | 1 | Aris' fortune |
| bucket of water | 1 | the palace drain (key 3) |
| law rune | 2 | Lumbridge + Varrock Teleport |
| earth rune | 1 | Lumbridge Teleport |
| fire rune | 1 | Varrock Teleport |
| staff of air (wielded) | 1 | the air runes for both teleports (saves the slot the bones need) |
| bones | 25 | Traiborn: staged in the Draynor bank, or traded by a helper at the tower |

## Measured (lockstep sim; 400 ms demo tick)
Helper: 496 / 474 / 475 t (chaos 4242/202/303, median 475). Bank stage: 526 / 516 / 517 t (chaos 4242/505/606, median 517). Details in STATUS.md.

## Limits
- Key 3 is a 300-tick obj_add in the sewer; the bot picks it up straight away.
- Silverlight stays wielded at the end (it replaces the staff).
