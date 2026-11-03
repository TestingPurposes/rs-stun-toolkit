# Shades of Mort'ton (rs-sdk bot script, protocol rev 289)

A headless bot script that plays **Shades of Mort'ton** (3 QP) in Mort'ton, Morytania.

Steps: take Herbi Flax's diary from the shelf in his house and read it to the last page -> brew serum 207 (ashes on a
tarromin potion) -> clear Razmire with a serum dose and agree to kill five shades -> kill five Loar shades and collect
five remains -> Razmire takes two -> Ulsquire (serum) takes one and talks about the temple -> one temple repair action, then back to Ulsquire: "What should I do
when the temple is built?" gives a 3-dose olive oil (once) -> repair the Flamtaer temple:
15 walls to level 10 (about 156 repair actions; the script tracks the build total from the crafting xp and picks the
next wall that can level) -> light the sacred altar, sanctify the olive oil -> sacred oil on logs = pyre logs -> pyre
logs, a Loar remains and fire on a funeral pyre -> Ulsquire: quest complete.

Protect from Melee stays on from the shades onwards: every Loar shade hit is then 0, and dozens of shades walk to the
temple while it is being built.

## Live prerequisites
| Requirement | Why |
|---|---|
| Priest in Peril | Morytania access. |
| Herblore 15 | Serum 207. |
| Crafting 20 | Temple repair. |
| Firemaking 5 | Pyre logs from normal logs (the altar and pyre are firemaking rolls: more is faster). |
| Prayer 43+ (sim: 70) and combat (sim: 70) | Protect from Melee; five shade kills. |

## Supplies (`--supply`)
- 2 tarromin potions (unf) + 2 ashes, hammer, tinderbox, logs, 4 planks + 4 limestone bricks + 20 swamp
  paste (4 temple sets), 3 prayer potions (4). Worn: a weapon. Keep 5 free slots for the remains.
- No olive oil needed: the pyre logs take 2 doses of sacred oil and Ulsquire's flask has 3. If you carry olive oil (2+ doses)
  the script uses it and skips the Ulsquire detour.

## Measured (offline lockstep sim, 400 ms ticks)
- In-quest olive oil: **959, 971, 944 ticks** on chaos seeds 2621-2623 (median 959, ~6.4 min); the Ulsquire
  detour is ~42 ticks. With carried oil: 930, 886, 875 (median 886) on chaos engines, 954 on a fresh normal engine (and
  1091 on seed 2624, slow shade phase). The temple is ~570 of it.

## Limits
- The temple build total is a world-wide variable: on a world where someone already built, shades keep converging on
  the temple. The altar stays lightable only 99 ticks after a repair at 100%; the script re-arms it with one more repair.
