# Regicide (3 QP) — speedrun bot

`run-regicide.ts` drives a SpeedBot through Regicide, cheat-free: the King's messenger, King Lathas, back through the
Underground Pass to the Well of Voyage (twice), Isafdar (Idris, Lord Iorwerth, the tracker and his pendant, the old-camp
tracks, the Tyras guard, the camp crossing, the Big Book o' Bangs), the chemistry outside (Falador furnace quicklime,
Rimmington fractionalizing still naphtha, the barrel bomb and its cloth fuse), the lazy guard's rabbit, the catapult,
Iorwerth's message, Arianwyn at the Ardougne castle bridge, and King Lathas again.

## Modes
- `--live <account> [--relog]`: every staff command throws. Use `--relog` once right after Underground Pass if the account has
  not logged in since: the King's messenger timer is armed only at login.
- `--sim [name]`: local engine only; sets Biohazard, Plague City (scroll read) and Underground Pass complete with every
  %ibanmulti bit the pass leaves, saves the account's grid digits, hands over the supplies, teleports beside King Lathas and
  relogs. Mid-quest hand-off (7 coal at Falador) is a cheat give in the sim; live it comes from the Falador bank or a helper.
- `--supply` prints the supply lists.

## Requirements (live)
- Underground Pass complete **and a relog after it** (login.rs2:74; regicide_kings_messenger.rs2:1-4). The messenger comes
  400-1200 ticks after login and repeats with the same interval until his dialogue runs.
- Agility 56 (forest crossings; logs 45), Crafting 10 (loom), Magic 75 (Fire Wave on the Tyras guard, 110 hp) and 51/37
  (Ardougne / Falador teleports), Plague City scroll read. Everything the Underground Pass needs (two more passes).
- The account's grid digits are read from `logs/west/upass-grid.json` (written by the Underground Pass bot); missing digits
  are re-probed in the grid (15 hp per fall).

## Supplies
See `--supply`: bow + arrows + tinderbox + 2 ropes + spade (the pass, twice), food, pestle and mortar, pot, 4 balls of wool,
limestone, 1 logs (the rabbit fire), leather gloves (worn), Fire Wave runes, 5 law + 5 water (+ the Fire Wave air) for the teleports;
7 coal at Falador.
- The lazy guard's **cooked rabbit is made in the quest**: on the first Isafdar visit it kills one of the rabbits
  by pit B's south end (or NW of the tracks), lights the logs with the tinderbox and cooks it (~50 ticks). Raw is refused.
  Cooking 34+ never burns (below that a burn costs another rabbit; the fire is reused while it burns). A carried cooked
  rabbit is used instead.

## Measured
See STATUS.md (west lane).
