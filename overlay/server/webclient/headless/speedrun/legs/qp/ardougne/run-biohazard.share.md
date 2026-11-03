# Biohazard (run-biohazard.ts)

**What it does.** Distillator from the West Ardougne mourner HQ (pigeons, rope ladder, rotten-apple stew, doctor's gown, a sick mourner's key), Elena's vials, the Rimmington chemist's touch paper, the errand boys, Guidor in Varrock, King Lathas.

**Prerequisites.** Plague City complete with its scroll read (Ardougne Teleport); magic 51; a cl 13 mourner to kill (proven at att/str/def/hp 40 + rune scimitar).

**Supplies (SUPPLY in q-biohazard.ts).** priest_gown, priest_robe, 2 law, 2 water, 60 coins; keep 5 free slots for Elena's vials

**Start.** outside Elena's door, East Ardougne (2591,3340). `--sim` sets everything up on a local engine; `--live <account>` refuses every staff cheat.

**Measured (lockstep sim, 400 ms ticks).** 1176 t median (1165/1176/1187, chaos 3301/3302/3303).

**Limits.** No teleport while carrying the plague sample (it disintegrates): Ardougne -> Brimhaven -> Musa Point -> Port Sarim by ship, then on foot to Varrock. Quest varps are not transmitted: every step gates on items,
position, dialog text or xp. Lane notes: `STATUS.md`.

```
bun headless/speedrun/legs/qp/ardougne/run-biohazard.ts --supply
LC_HOST=localhost:<port> SIM_LOCKSTEP=1 bun headless/speedrun/legs/qp/ardougne/run-biohazard.ts --sim <name>
```
