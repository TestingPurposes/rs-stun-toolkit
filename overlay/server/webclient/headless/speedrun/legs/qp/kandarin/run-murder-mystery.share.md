# Murder Mystery (rs-sdk bot script, rev 289)

A headless bot that completes **Murder Mystery** (3 QP; the family's reward includes 2,000 coins). The murderer is chosen at
random when the guard accepts your help (one of the six Sinclairs) and is never sent to the client, so the bot deduces
it from what it sees. Every step is checked against the rev-289 content scripts (file:line in `q-murder-mystery.ts`).

Route:
1. The guard at the Sinclair Mansion: "Sure, I'll help."
2. The study window: the thread's colour leaves two suspects (green Anna/David, red Bob/Carol, blue Elizabeth/Frank).
3. The murder weapon, dusted with flour (the mansion's flour barrel) and lifted with flypaper (sacks), gives the
   murderer's prints. One suspect's item (from their barrel) gets the same treatment and is compared; if it does not
   match, the other suspect's item. A match identifies the murderer.
4. The poison salesman in Seers' Village: "Who did you sell Poison to at the house?"
5. The murderer: "Why'd you buy poison the other day?", then search the spot they named (it shows no poison was used).
6. The guard: "I know who did it!" - conclusive proof, quest complete.

Launcher: `run-murder-mystery.ts`; quest code `q-murder-mystery.ts` (no cheats); helpers `ka-lib.ts`.

## Modes
- `--live <account>`: reads `bots/<account>/bot.env`. Every staff command is blocked.
- `--sim [name]`: local engine only. Clears the pack, gives an empty pot, teleports outside the mansion's front door.
  Each new account gets a new random murderer.
- `--supply`: prints the supply list and exits.

## Live prerequisites
- None (no skill checks). 6 free pack slots.

## Supplies
| item | n | why |
|---|---|---|
| empty pot | 3 | flour for the fingerprints, all filled in one visit to the mansion's flour barrel |

## Measured (lockstep sim, rev 289)
**264 / 272 / 290 ticks** on chaos engines (seeds 8801-8803; murderers Bob, Carol, David), median **272**. Six fresh
accounts on a normal engine: 289, 826 (two walk recoveries), 265, 272, 278, 244. The time depends on the murderer (one
or two suspect items dusted; some suspects and spots are upstairs).

## Limits
- The mansion's doors and wandering servants sometimes wedge a walk; the bot steps back to the hall and retries.
- Completion is detected by the quest points varp.
