# Observatory Quest (run-observatory.ts)

**What it does.** Dungeon first (keep key, keep gate, lens mould; the lens is cast from a second molten glass), then all six professor talks in one visit, then the dome telescope.

**Prerequisites.** no gates; the keep's goblin guard (cl 42) aggroes: proven at att/str/def/hp 40 + 4 lobsters. 3 free slots.

**Supplies (SUPPLY in q-observatory.ts).** 3 woodplank, bronze_bar, 2 molten_glass (+ food)

**Start.** observatory reception (2441,3190). `--sim` sets everything up on a local engine; `--live <account>` refuses every staff cheat.

**Measured (lockstep sim, 400 ms ticks).** 375 t median (371/378, chaos 3303).

**Limits.** The reward constellation extra is random (completion is not). Quest varps are not transmitted: every step gates on items,
position, dialog text or xp. Lane notes: `STATUS.md`.

```
bun headless/speedrun/legs/qp/ardougne/run-observatory.ts --supply
LC_HOST=localhost:<port> SIM_LOCKSTEP=1 bun headless/speedrun/legs/qp/ardougne/run-observatory.ts --sim <name>
```
