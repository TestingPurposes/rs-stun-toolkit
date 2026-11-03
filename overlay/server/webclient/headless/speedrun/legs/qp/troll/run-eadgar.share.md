# Eadgar's Ruse (1 QP) — `run-eadgar.ts`

Catches a drunk parrot at the Ardougne zoo, starts the quest with Sanfew, frees Eadgar from the troll prison if Troll
Stronghold left him there, and runs the whole parrot / scarecrow / troll-truth-potion plan between Eadgar's cave on
Trollheim and the Troll Stronghold, then fetches the goutweed from the trolls' storeroom for Sanfew.

## Run
```
bun headless/speedrun/legs/qp/troll/run-eadgar.ts --supply
bun headless/speedrun/legs/qp/troll/run-eadgar.ts --sim [name]      # local engine only
bun headless/speedrun/legs/qp/troll/run-eadgar.ts --live <account>
```
`EADGAR_START=<stage>` / `EADGAR_STOP=<stage>` (zoo sanfew prison cook1 thistle eadgar1 rack1 eadgar2 robe eadgar3 rack2 eadgar4
cook2 finish).

## Prerequisites
- Quests: Druidic Ritual, Death Plateau, Troll Stronghold (secret prison door), Plague City (Ardougne Teleport).
- Herblore 31 BASE (Sanfew's start check), thieving 30 (Eadgar's cell key, only if he is still jailed), agility 15 (rocks),
  magic 51, prayer 43 (Protect from Melee on the Death Plateau shelf, the Trollheim paths and the stronghold's L2 hall).
- Climbing boots (worn) for the Death Plateau rocks. Start in Burthorpe (2919,3572).

## Supplies
Pineapple chunks, vodka, 2 logs, 5 raw chickens, 10 grain, ranarr potion (unf), pestle and mortar, tinderbox, games necklace,
climbing boots, 5 law + 5 water + 9 air runes (Ardougne + 3x Falador Teleport), 2 sharks (the pack is full).

## Measured
Lockstep sim, fresh accounts, chaos engines: 1602 (seed 6421), 1641 (6422), 1624 (6423) ticks -> median 1624 (650 s at
400 ms). Sim stats: herblore 31, thieving 70, agility 75, magic 58, prayer 43, hitpoints 80, defence 70, firemaking 31.
Per-stage ticks and the A/Bs (route via the arena, the mountain shortcut, the storeroom crate planner, the bank stop): STATUS.md.

## Limits
- Trolls on the Death Plateau shelf and Trollheim paths attack on every leg; the run eats and prays.
- The storeroom patrol is dodged by a space-time plan over the guards' fixed patrol loops (about 30 ticks door -> goutweed,
  1 knock-out in 8 trials); the sleeping guard's knock-out after the goutweed is part of the quest.
- Six legs between the stronghold and Eadgar's cave dominate the time (stronghold door -> cave 174 tiles; the run climbs the
  Trollheim mountain shortcut rocks 3803 (2885,3683) inbound: 115 + 12 tiles, -18 ticks per leg).
- The Falador bank stop on the robe trip (BANK_SUPPLY sharks) only happens when hp + food held < 90 (~20 ticks).
