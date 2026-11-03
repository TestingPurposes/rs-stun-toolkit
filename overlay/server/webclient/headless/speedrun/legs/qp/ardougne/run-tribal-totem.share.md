# Tribal Totem (run-tribal-totem.ts)

**What it does.** Kangai Mau's totem: RPDT label swap, Cromperty's teleport into Handelmort Mansion, combination lock KURT, the stair trap, the chest, back to Brimhaven by ship.

**Prerequisites.** thieving 21 (stair trap). Magic 51 + Plague City recommended (Ardougne Teleport; else +30 coins and the Brimhaven ship, ~45 t slower).

**Supplies (SUPPLY in q-tribal-totem.ts).** 2 law, 2 water, 30 coins

**Start.** next to Kangai Mau, Brimhaven (2790,3184). `--sim` sets everything up on a local engine; `--live <account>` refuses every staff cheat.

**Measured (lockstep sim, 400 ms ticks).** 234 t median (227/241, chaos 3303).

**Limits.** None known beyond the above. Quest varps are not transmitted: every step gates on items,
position, dialog text or xp. Lane notes: `STATUS.md`.

```
bun headless/speedrun/legs/qp/ardougne/run-tribal-totem.ts --supply
LC_HOST=localhost:<port> SIM_LOCKSTEP=1 bun headless/speedrun/legs/qp/ardougne/run-tribal-totem.ts --sim <name>
```
