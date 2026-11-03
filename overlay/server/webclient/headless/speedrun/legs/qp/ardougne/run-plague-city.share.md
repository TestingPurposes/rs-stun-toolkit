# Plague City (run-plague-city.ts)

**What it does.** Rescue Elena from the West Ardougne plague house: gas mask from Alrena, soften and dig the mud patch, pull the sewer grill with Edmond, the Rehnisons and Milli, the mourner, the clerk and Bravek (hangover cure -> warrant), the barrel key, Elena; back by the manhole and sewer; reads the magic scroll (Ardougne Teleport).

**Prerequisites.** none (no skill checks). Must be done BEFORE Biohazard starts (mud_patch.rs2:15).

**Supplies (SUPPLY in q-plague-city.ts).** dwellberries, rope, spade, 4 bucket_water, chocolaty_milk (milk + chocolate dust), snape_grass

**Start.** outside Edmond's door, East Ardougne (2569,3333). `--sim` sets everything up on a local engine; `--live <account>` refuses every staff cheat.

**Measured (lockstep sim, 400 ms ticks).** 320 t median (319-330; chaos 3101 and 3303).

**Limits.** The clerk only calls Bravek in when he is within 7 tiles of you; the script holds that page until he wanders close (0-40 t). Quest varps are not transmitted: every step gates on items,
position, dialog text or xp. Lane notes: `STATUS.md`.

```
bun headless/speedrun/legs/qp/ardougne/run-plague-city.ts --supply
LC_HOST=localhost:<port> SIM_LOCKSTEP=1 bun headless/speedrun/legs/qp/ardougne/run-plague-city.ts --sim <name>
```
