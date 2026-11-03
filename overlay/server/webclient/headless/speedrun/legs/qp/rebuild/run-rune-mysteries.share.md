# Rune Mysteries (lane rebuild, rev 289, cheat-free)

Replaces the old LeanBot rm-driver (`quests-share/run-rune-mysteries.ts`, 2,930 t) with a lane-style speedrun leg.

## What it does
Duke Horacio (Lumbridge castle L1, air talisman) -> glory to Draynor Village -> Wizards' Tower cellar, Sedridor (talisman
for the research package) -> Varrock Teleport -> Aubury (use the package on him, talk again for the notes) -> glory to
Draynor Village -> cellar, use the notes on Sedridor -> quest complete (+1 QP, air talisman back).
Content: `duke_horacio.rs2:1-39`, `sedridor.rs2:1-180`, `aubury.rs2:1-61`, `quest_runemysteries.rs2:1-4`.

## Prerequisites
- Quests: none. QP: none.
- Magic 25 (Varrock Teleport). The route has magic ~45 here.
- Start: the Lumbridge Teleport landing (3221,3218) L0. End: Sedridor in the Wizards' Tower cellar (~3103,9571),
  underground (the route teleports out).

## Supplies (`--supply`)
`lawrune 1, firerune 1, staff_of_air 1 (wielded by the quest), amulet_of_glory_4 1` (uses 2 glory charges).

## Run
```
bun legs/qp/rebuild/run-rune-mysteries.ts --live <account>
LC_HOST=localhost:<port> bun legs/qp/rebuild/run-rune-mysteries.ts --sim [name]
bun legs/qp/rebuild/run-rune-mysteries.ts --supply
```
Default variant = the fastest measured (glory out, glory back). A/B switches: `RB_RM_OUT=walk`, `RB_RM_BACK=lumb|walk`,
`RB_RM_DUKE=walk`, `RB_RM_CELLAR=op`.

## Measured (lockstep sim, engine 4, fresh accounts)
- 216 t (rb71, plain world), 210 t (rb75, chaos seed 4441), final code. Median 213 t. (Earlier builds 202/211.)

## Limits
- Needs the amulet of glory with 2+ charges (the second rub is the way back to the tower).
- Every walk assumes infinite run energy (sim `NODE_INFINITE_RUN`).
