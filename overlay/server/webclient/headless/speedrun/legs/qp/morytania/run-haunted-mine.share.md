# Haunted Mine (rs-sdk bot script, protocol rev 289)

A headless bot script that plays **Haunted Mine** (2 QP) under Mort Ridge, south of Mort'ton.

Steps: the Saradominist zealot (start, then pickpocket his lift key) -> over the mine cart, through the cart tunnels and
ladders to the fungus pool -> pick a glowing fungus -> solve the points puzzle (the 8 levers start random; each test run
of the empty cart shows where it sinks, the script narrows the possible states and pulls the right levers, usually 2-3
tests) -> send the fungus in the cart -> round to the far cart and take the fungus out (it crumbles in daylight, so it
can't be carried over the surface) -> unlock the lift valve with the key, ride the lift -> down the dark stairs with the
fungus as light -> take the key: Treus Dayth appears; kill him -> take the key -> round to the reward doors -> cut a
crystal with the chisel: quest complete.

The track carts block single-file corridors and shove you back: the script hops between the corridor's side alcoves
timed on the cart's position.

## Live prerequisites
| Requirement | Why |
|---|---|
| Priest in Peril | Morytania access. |
| Combat (proven at attack/strength/defence/hitpoints 85 with 15 sharks, ~7 eaten) | Treus Dayth: defence 100, 100 hp, hops to another spot after about half the hits; the room's carts, cranes and pickaxes hit up to 10-15. |
| Prayer 43 | Protect from Missiles during the fight (caps the pickaxe hits at 10). |

## Supplies (`--supply`)
- Chisel, 2 prayer potions (4), 15 sharks. Worn: a weapon. Do not bring a lit light or a tinderbox (the lift soaks them).

## Measured (offline lockstep sim, 400 ms ticks)
- Combat 85: 1166, 1324, 1061 ticks on three chaos engines (random door states) -> median 1166 (~7.8 min). The boss
  fight is ~450-600 of it; at combat 99 the boss phase took ~390-405.
