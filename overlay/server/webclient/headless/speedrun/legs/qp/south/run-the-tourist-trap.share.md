# The Tourist Trap (rs-sdk bot script, protocol rev 289)

A headless bot script that plays **The Tourist Trap** in the Kharidian desert (2 quest points, plus two skill rewards of
4,650 base xp each).

What it does, in order:
1. Goes through the **Shantay Pass** doorway (one pass) and talks to **Irena**, who stands just inside the desert.
2. Talks the **Mercenary Captain** into a fight ("It's a funny captain who can't fight his own battles!") and kills him for
   the metal key (rune scimitar, unwielded again before the camp: weapons and armour get you arrested there).
3. Enters the mining camp, frees a **mining slave** (lock pick, a thieving roll) and trades its worn desert clothes for his
   slave clothes.
4. In the mine, asks the **cave guard** to work elsewhere (he wants a pineapple).
5. Leaves the camp (slave clothes off), gets the Bedobin key from **Al Shabim**, comes back, distracts **Captain Siad**
   (bookcase, then "sailing" talk) and takes the plans from his chest.
6. Al Shabim's deal: forges the prototype dart tip on the **experimental anvil** (bronze bar, hammer), fletches it (10
   feathers), hands the dart over for the Tenti pineapple.
7. Back in the mine: the pineapple gets it past the cave guard; empty barrel; mine cart to Ana's room; **Ana** into the
   barrel; the barrel rides the cart back; the **winch guard** helps put her on the lift.
8. On the surface: winch, barrel, the escape cart and its driver ("Prison riot in ten minutes..."), out of the camp on the
   cart with Ana, and hands her in at the Shantay doorway. Picks two rewards (default Agility + Thieving, `TT_PICKS`).

If a guard catches the lock pick (a third failed pick next to a mercenary), the script escapes the surface jail (window bar,
escarpment rocks) and carries on; if the guards took the metal key it fights the captain again.

## Live prerequisites
| Requirement | Why |
|---|---|
| **Smithing 20, Fletching 10** | The anvil and the dart check these; higher is faster (each attempt is a roll that wastes the bar / 10 feathers). |
| **Combat level 87+** (recommended) | The Rowdy Guard in the camp attacks anyone not above twice his level 43. A combat-62 run died to him. |
| **Thieving** (51+ recommended) | The slave lock roll; three fails in a row next to a guard = jail (handled, but slow). |
| **Start** | Al Kharid side of the Shantay Pass doorway (3303,3119). |

## Supplies (`--supply`)
Shantay pass, desert shirt, desert robe, desert boots (worn: they become the slave clothes), rune scimitar, 3 bronze bars,
30 feathers, hammer, 2 waterskins (4), 3 sharks.

## Measured (offline lockstep sim)
Chaos engines: **1242, 1336 and 1339 ticks** (median 1336 ≈ 8.9 min at 400 ms); two of the three were jailed after
three failed picks and escaped (about 100-120 ticks each). Stats: smithing 80, fletching 70, thieving 51, agility 60, attack/strength 83, defence 60, hitpoints 80,
prayer 43.

## Known limits
- A jail in the MINE (only after the pineapple) needs 15 mined rocks to get out; the script never provokes it and does not
  handle it.
