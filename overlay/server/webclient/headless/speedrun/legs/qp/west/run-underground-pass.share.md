# Underground Pass (5 QP) — speedrun bot

`run-underground-pass.ts` drives a SpeedBot through the whole quest, cheat-free: King Lathas, Koftik, the bridge (fire arrow
at the guide rope), the rope swing, the per-player grid trap (probed, digits remembered per account), the four orbs and the
furnace, the well, the slave cage, the mud tunnel, the ledge, the two thieving cages, the pipe, the railing on the boulder,
the unicorn horn, the three paladins (badges into the blood well), Iban's lair (Nilhoof, Kardia's cat and doll, the three
demons and the shadow chest, the tomb's ashes, Kalrag's blood, the dove's cage), the temple (robes only) and the pit, then an
Ardougne Teleport back to King Lathas.

## Modes
- `--live <account> [--relog]` reads `bots/<account>/bot.env`; every staff command throws.
- `--sim [name]` (local engine only) sets Biohazard + Plague City (scroll read) complete, the sim stats, the supplies, and
  teleports to the start. Debug: `--from <segment>` (cheat-set mid-quest state), `--env UPASS_GRID=345`, `--env UPASS_TO=<seg>`.
- `--supply` prints the supply list.

## Requirements (live)
- Quests: Biohazard (King Lathas checks `%biohazard`), Plague City with its scroll read (Ardougne Teleport for the way back).
- Ranged 25 **base** (king_lathas.rs2:95), Thieving 50 (cage lock, quest_upass.rs2:248), Agility ~70+ (rockslides, bridges,
  ledge are rolls; certain at 75), Magic 75 (Fire Wave for the 7 kills; paladins and demons have magic defence -10) and 51
  (Ardougne Teleport). Proven at att/str 83, def 60, hp 70, ranged 56, magic 80, agility 75, thieving 70.
- Start at the foot of the East Ardougne castle stairs (2573,3296); ends beside King Lathas (2577,3293, upstairs).

## Supplies
shortbow, 5 bronze arrows, tinderbox, rope, spade, bucket, 15 sharks, Zamorak robe top + bottom (worn from the start),
2 law + 2 water runes, Fire Wave runes (70 blood, 490 fire, 350 air).

## Measured (lockstep sim, 400 ms tick = wall time x0.4 s)
3 complete runs on 3 chaos seeds (random door states): 2146, 2239, 2096 ticks (median 2146 ~ 14.3 min). The grid costs
0-7 falls (15 hp each, ~12 t each).

## Limits
- The grid digits are random per player; the bot probes them (expected ~3.6 falls) and writes them to
  `logs/west/upass-grid.json` so a later Regicide pass walks straight across.
- A ledge slip drops into the rat pit; the bot walks back round and retries.
