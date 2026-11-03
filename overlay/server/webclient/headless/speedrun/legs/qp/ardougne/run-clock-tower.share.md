# Clock Tower (run-clock-tower.ts)

**What it does.** Four cogs for Brother Kojo: blue via the north-east ladder and secret wall, black (cooled with a bucket of water), red, white through the rat cage (lever, rat poison in the trough).

**Prerequisites.** no gates, but aggressive spiders in the cellars (a level-3 died): proven at att/str/def/hp 40 + 4 lobsters.

**Supplies (SUPPLY in q-clock-tower.ts).** bucket_water (+ food)

**Start.** next to Brother Kojo (2569,3251). `--sim` sets everything up on a local engine; `--live <account>` refuses every staff cheat.

**Measured (lockstep sim, 400 ms ticks).** 416 t median (413/416/427, chaos 3303).

**Limits.** None known beyond the above. Quest varps are not transmitted: every step gates on items,
position, dialog text or xp. Lane notes: `STATUS.md`.

```
bun headless/speedrun/legs/qp/ardougne/run-clock-tower.ts --supply
LC_HOST=localhost:<port> SIM_LOCKSTEP=1 bun headless/speedrun/legs/qp/ardougne/run-clock-tower.ts --sim <name>
```
