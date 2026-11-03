# Troll Romance (2 QP) — `run-romance.ts`

Starts with Ug in the Troll Stronghold, learns about Trollweiss from Aga and Tenzing, has Dunstan build a sled, waxes it, rides
down Trollweiss Mountain for the flower, gives it to Ug, kills Arrg in the arena and reports back to Ug.

## Run
```
bun headless/speedrun/legs/qp/troll/run-romance.ts --supply
bun headless/speedrun/legs/qp/troll/run-romance.ts --sim [name]      # local engine only
bun headless/speedrun/legs/qp/troll/run-romance.ts --live <account>
```
`ROMANCE_START=<stage>` / `ROMANCE_STOP=<stage>` (ug1 aga burthorpe flower ug2 arrg ug3).

## Prerequisites
- Quests: Death Plateau, Troll Stronghold (Ug only talks after it; the secret prison door), Eadgar's Ruse (Trollheim Teleport).
- Agility 28 (the sled), magic 61 (Trollheim Teleport), prayer 43 (Protect from Melee on the Death Plateau shelf, in the L2
  hall and against Arrg). Combat good enough for Arrg (140 hp, defence 40, hits up to ~38): proven at 80 attack/strength/
  defence/hitpoints with a rune scimitar.
- Climbing boots worn. Start in Burthorpe (2899,3564).

## Supplies
Maple (or yew) logs, iron bar, rope, bucket of wax, swamp tar, cake tin, climbing boots, 2 fire + 2 law runes, 12 sharks,
2 prayer potions, a melee weapon.

## Measured (lockstep sim, chaos engines, fresh accounts)
1438 (seed 6321), 1418 (6322), 1424 (6323): median 1424 ticks.
Segments (6322): Ug 198, Aga 29, Burthorpe (Tenzing, Dunstan x2, wax) 290, flower 358, Trollheim TP + Ug 132, Arrg 253, Ug 158.

## Limits
- Trolls on the Death Plateau shelf and ice trolls in the Trollweiss cave hit; the run eats (50%, 65% vs Arrg) and prays.
