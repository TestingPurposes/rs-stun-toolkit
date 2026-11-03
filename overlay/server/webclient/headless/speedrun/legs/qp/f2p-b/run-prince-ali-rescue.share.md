# Prince Ali Rescue (rs-sdk bot script, protocol rev 289)

Plays **Prince Ali Rescue** (3 QP, 700 coins). Travel is five amulet-of-glory teleports (Al Kharid / Draynor Village), so the
Al Kharid toll gate is never used.

Files: `q-prince-ali-rescue.ts` (quest code, cheat-free), `run-prince-ali-rescue.ts` (launcher), `fb-lib.ts` / `fb-launch.ts`.

## Steps (verified in the 289 content)
1. Al Kharid: Hassan (start), Osman (the "second thing" branch: shortest) -> spoken to Osman.
2. Draynor: Ned makes a wig (3 wool), yellow dye on it -> blond wig; Aggie makes skin paste (redberries, flour, water, ashes);
   Lady Keli shows her key -> soft clay imprint.
3. Al Kharid: Osman takes the imprint + bronze bar (the key goes to Leela).
4. Draynor: Leela gives the key (and, with wig + skirt + paste, the go-ahead); 3 beers make Joe drunk; rope on Lady Keli;
   the key on the cell door; Prince Ali takes the disguise.
5. Al Kharid: Hassan pays -> quest complete.

## The jail guards (the hard part)
The four Draynor jail guards (cl26) attack ANY player in sight (huntmode `aggressive_melee`, `check_nottoostrong=off`), every
5 ticks, and **every npc melee swing closes your dialog** (`npc_combat_melee.rs2:35 if_close`). The Keli conversation is 23 pages
(5 ticks of bursts). The script: turns auto-retaliate off for the run (restored at the end), steps inside the jail and SHUTS its
door behind it (the guards spawn outside; npcs do not open doors), kills a guard that followed it in, and retries a cut
conversation.

## Prerequisites
- Proven at attack/strength 80 (and 40), defence/hitpoints 50 (see Measured). Fresh 10-hp accounts and defence/hp 30-40 died or lost
  every Keli conversation to guard swings.
- Supplies (`--supply`): amulet of glory (4) + amulet of glory (1), soft clay, bronze bar, 3 balls of wool, yellow dye, pink
  skirt, redberries, pot of flour, bucket of water, ashes, 3 beers, rope, 4 lobsters.

## Measured (lockstep sim, fresh accounts, chaos engines = random door states)
| stats | runs (seed: ticks) | median |
|---|---|---|
| att/str 80, def/hp 50 | 111: 224, 222: 289, 333: 190, 444: 171, 555: 225 | **224** |
| att/str 40, def/hp 50 | 444: 276, 555: 244 | 260 |

Typical split: glory legs 5 t each, Hassan+Osman ~30, Ned+Aggie ~30, jail door ~20, Keli 6-19, Osman 14, Leela 10, Joe 5,
Keli tied 3, cell 3, prince 3, Hassan 6; plus 0-90 t killing a guard that followed us into the jail.
