# Horror from the Deep (2 QP) — `run-horror.ts`

Starts at Larrissa (basalt rocks from the Barbarian Outpost), gets the lighthouse key from Gunnjorn (obstacle pipe into the
agility course), repairs the broken bridge, repairs the lighthouse light, opens the strange wall, kills the Dagannoth and the
Dagannoth mother (only the style matching her colour hurts her).

## Run
```
bun headless/speedrun/legs/qp/troll/run-horror.ts --supply
bun headless/speedrun/legs/qp/troll/run-horror.ts --sim [name]      # local engine only
bun headless/speedrun/legs/qp/troll/run-horror.ts --live <account>
```
`HORROR_START=<stage>` resumes (stages: gate basaltN start basaltS key basaltN2 bridge door light cave fight);
`HORROR_JR=magic|melee`, `HORROR_SPELLS=wave|blast`.

## Prerequisites
- Alfred Grimhand's Barcrawl (the outpost gate).
- Agility 35 (the course pipe to Gunnjorn); higher agility means fewer basalt slips (each slip costs ~20 ticks).
- Prayer 40 (Protect from Missiles), Magic 75 (Fire Wave; wind/water/earth waves 62/65/70).
- A melee weapon wielded (the mother's melee form); sim proof used a rune scimitar at attack/strength 80.
- Start outside the outpost gate (2546,3569), where the Barcrawl ends.

## Supplies
2 planks, 8 nails, hammer, swamp tar, molten glass, tinderbox, bronze dagger, bronze arrow (the strange wall), 44 blood,
221 air, 50 water, 50 earth, 162 fire runes (waves: 16 Fire Waves for the Dagannoth, up to 7 casts per element for the
mother), 8 sharks, 1 prayer potion.

## Measured (lockstep sim, fresh accounts, chaos engines)
- 650 (seed 6201), 681 (6202), 624 (6203): median 650 ticks. With all stats 99: 614 (seed 6204).
- Segments (seed 6203): basalt north 60, Larrissa 19, basalt south 56, Gunnjorn 65, basalt north 59, bridge 77, door 50,
  light 12, cave 32, Dagannoth 86, mother 103.

## Limits
- The mother's form order is fixed (air, water, melee, earth, fire, ranged, 30 ticks each); the ranged form is skipped (no
  bow), the melee form does little at attack 80 (stab/slash/crush defence 150).
