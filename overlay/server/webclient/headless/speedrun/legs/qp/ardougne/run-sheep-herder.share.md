# Sheep Herder (run-sheep-herder.ts)

**What it does.** Halgrive, Dr Orbon's plague suit, the cattle prod, herd the four diseased sheep one tile per prod into the pen, poison them, burn the bones.

**Prerequisites.** no gates, no combat.

**Supplies (SUPPLY in q-sheep-herder.ts).** 100 coins

**Start.** next to Councillor Halgrive (2616,3301). `--sim` sets everything up on a local engine; `--live <account>` refuses every staff cheat.

**Measured (lockstep sim, 400 ms ticks).** 958 t median (907/958/1010/918/984, chaos 3403-3601).

**Limits.** The sheep are GLOBAL npcs: other players can push or kill them. Quest varps are not transmitted: every step gates on items,
position, dialog text or xp. Lane notes: `STATUS.md`.

```
bun headless/speedrun/legs/qp/ardougne/run-sheep-herder.ts --supply
LC_HOST=localhost:<port> SIM_LOCKSTEP=1 bun headless/speedrun/legs/qp/ardougne/run-sheep-herder.ts --sim <name>
```
