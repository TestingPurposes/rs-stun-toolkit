# Alfred Grimhand's Barcrawl (miniquest, 0 QP) — `run-barcrawl.ts`

Collects the Barcrawl card at the Barbarian Outpost gate, drinks at all ten bars, and hands the card back in at the gate.
It opens the outpost gate, which Horror from the Deep needs (the basalt rocks and Gunnjorn are behind it).

## Run
```
bun headless/speedrun/legs/qp/troll/run-barcrawl.ts --supply
bun headless/speedrun/legs/qp/troll/run-barcrawl.ts --sim [name]      # local engine only (staff cheats for setup)
bun headless/speedrun/legs/qp/troll/run-barcrawl.ts --live <account>  # no cheats; reads bots/<account>/bot.env
```
Variants (env): `BARCRAWL_ROUTE=rb|ra` (default rb), `BARCRAWL_FH=ardy|walk`, `BARCRAWL_KARAMJA=glory|boat`.

## Prerequisites
- Quests: Tree Gnome Village and The Grand Tree (the spirit trees), Plague City (Ardougne Teleport, route rb).
- Magic 58: Ardougne Teleport (51) after the Jolly Boar drink drains magic by 5 + 5%. Route `ra` needs 53 (Camelot 45).
- Start outside (east of) the Barbarian Outpost gate (2546,3569).

## Supplies
300 coins (drinks 208), 5 law, 11 air, 3 water, 1 fire rune (Falador, Varrock, Camelot, Ardougne teleports), an amulet of glory
(any charge; Karamja). Route ra + boat: 300 coins, 3 law, 11 air, 1 water, 1 fire.

## Measured (lockstep sim, fresh accounts)
- Final code: 1030 (normal engine), 1024 (chaos seed 6107), 1056 (chaos 6108). Median 1030 ticks.
- A/B: ra+boat 1122/1126, ra+glory 1107, rb+Ardougne+boat 1090/1087, rb+Ardougne+glory 1074 (before later fixes), rb+walk 1159.

## Limits
- The drinks drain stats and take up to 25% of the current hitpoints (Flying Horse); nothing kills.
- Run energy never dropped in the sim; live runs may be slower over the ~1,600 walked tiles.
