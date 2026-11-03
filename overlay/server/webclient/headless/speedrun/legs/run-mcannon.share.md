# Dwarf Cannon (rs-sdk bot script, protocol rev 289)

A headless bot script that plays the **Dwarf Cannon** quest from start to finish. The reward is 1 quest point and 750 crafting xp, and the quest unlocks buying a cannon from Nulodion. By default it walks everywhere; `--tele` swaps the long walks for teleports.

What it does, in order:
1. Walks to Captain Lawgof at the dwarf camp north of Ardougne (2571,3463) and starts the quest.
2. Replaces the 6 broken railings. Each attempt rolls crafting; a failure cuts you for 1-3 hp, and the script eats and retries.
3. Climbs the guard tower for the dwarf remains and brings them back to Lawgof.
4. Goes into the goblin cave (entrance 2622,3392), frees Lollk from the crate and leaves through the mud pile.
5. Gets the toolkit from Lawgof, enters the shed and fixes the broken cannon (pipe, barrel, axle, shaft).
6. Walks (or uses Falador teleport) to Nulodion's room in the Ice Mountain dwarf camp (3011,3453) for the ammo mould and his notes.
7. Walks (or uses Camelot teleport) back to Lawgof. **Quest complete.** The script checks that your quest points went up.

## Live prerequisites
| Requirement | Why |
|---|---|
| **Quests** | None. |
| **Skills** | None are required. Crafting rolls each railing (`stat_random(crafting, 60, 150)`, about 59% per try at 99 and about 23% at 1), and smithing rolls the cannon repair. Low levels only mean more tries, and more railing cuts. The sim ran at crafting 40, smithing 40 and 30 hp. |
| **Food** | Sharks, eaten at hp ≤ 15 (change it with `--eat N`). Railing cuts are the only damage the quest deals; goblins in the cave and on the road may also attack a low-level account. |
| **Free slots** | 8: 6 railings, the remains, the toolkit, the mould and the notes. Railings and remains are used up along the way. |
| **`--tele` only** | Magic 45, plus runes for Camelot x2 and Falador x1 (law 3, air 13, water 1). |
| **Start** | Anywhere on the mainland the walker can reach Lawgof from. The sim starts at Varrock west bank. |

## Supplies (`--supply` prints them)
- **Walking (default):** shark x10.
- **`--tele`:** lawrune x3, airrune x13, waterrune x1, shark x10.

## Measured (offline lockstep sim, clean rs-sdk checkout)
This was run on a fresh account with crafting 40, smithing 40 and 30 hp, walking (the default) from Varrock west bank with 10 sharks. Result: **quest complete in 1,938 ticks** (about 19 minutes at 600 ms per tick). Quest points went from 0 to 1.

| Step | Tick |
|---|---|
| Arrived at Lawgof (walk from Varrock) | 425 |
| 6 railings (23 attempts, about 3 hp per cut) | 722 |
| Remains | 762 |
| Goblin cave and child | 881 |
| Toolkit | 985 |
| Cannon repaired | 1,060 |
| Walk to Nulodion | 1,444 |
| Mould and notes | 1,453 |
| Walk back | 1,930 |
| Complete | 1,938 |

- 4 of the 10 sharks were eaten.
- `--tele` mode (the route the leg was originally tuned for) was not part of this clean-checkout proof.

## Known limits
- Only one dwarf child can be out of the crate at a time. If another player's child is out, the script waits and retries, up to 12 times.
- On a busy server, Lawgof's first conversation sometimes does not start. The script retries it in place 3 times.
- The script ends next to Lawgof. It does not buy the cannon.
