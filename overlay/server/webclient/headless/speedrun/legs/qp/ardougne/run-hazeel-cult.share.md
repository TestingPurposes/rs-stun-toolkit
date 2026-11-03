# Hazeel Cult (Carnillean side) (run-hazeel-cult.ts)

**What it does.** Ceril, the five sewer valves (R,R,L,R,R), Clivet (refuse him), the raft, kill Alomone for the armour, Ceril upstairs, the cupboard evidence.

**Prerequisites.** no gates; Alomone (cl 13) must be killed: proven at att/str/def/hp 40 + rune scimitar.

**Supplies (SUPPLY in q-hazeel-cult.ts).** none

**Start.** next to Sir Ceril, mansion ground floor (2566,3269). `--sim` sets everything up on a local engine; `--live <account>` refuses every staff cheat.

**Measured (lockstep sim, 400 ms ticks).** 244 t median (229/244/248, chaos 3303).

**Limits.** The Hazeel side is not built: 3 cave trips instead of 1. Quest varps are not transmitted: every step gates on items,
position, dialog text or xp. Lane notes: `STATUS.md`.

```
bun headless/speedrun/legs/qp/ardougne/run-hazeel-cult.ts --supply
LC_HOST=localhost:<port> SIM_LOCKSTEP=1 bun headless/speedrun/legs/qp/ardougne/run-hazeel-cult.ts --sim <name>
```
