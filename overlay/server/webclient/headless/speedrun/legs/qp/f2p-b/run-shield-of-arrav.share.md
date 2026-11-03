# Shield of Arrav — a pair of accounts (rs-sdk bot script, protocol rev 289)

Plays **Shield of Arrav** (1 QP each) with TWO accounts at once: one joins the Phoenix Gang, the other the Black Arm Gang.
The quest cannot be finished alone (each gang holds one half of the shield; the gang choice is permanent). Both accounts get
the quest point and 600 coins.

Files: `q-shield-of-arrav.ts` (quest code, cheat-free: `runPhoenix`, `runBlackArm`), `run-shield-of-arrav.ts` (launcher),
`fb-lib.ts` (lane helpers).

## Run
```
LC_HOST=localhost:<port> SIM_LOCKSTEP=1 bun headless/speedrun/legs/qp/f2p-b/run-shield-of-arrav.ts --sim fbs1            # both sides, one process
LC_HOST=localhost:<port> SIM_LOCKSTEP=1 bun headless/speedrun/legs/qp/f2p-b/run-shield-of-arrav.ts --sim fbs2 --xbows-supplied
bun .../run-shield-of-arrav.ts --live <phoenixAccount> <blackarmAccount>
bun .../run-shield-of-arrav.ts --live-one phoenix <account> <partnerName>   # one side per process (the other side in a 2nd process)
bun .../run-shield-of-arrav.ts --supply
```

## What each side does (verified in the 289 content)
- **Phoenix:** Reldo -> palace bookcase (book) -> read it -> Reldo -> Baraek (20 gp) -> kill Jonny the Beard in the Blue Moon
  Inn (his intelligence report always drops) -> Straven (cellar ladder 3244,3383) twice -> HQ chest (shield half 1) ->
  weapon store with Straven's key -> kill the Weaponsmaster (he stops crossbow pickups within 10 tiles) -> 2 phoenix crossbows.
- **Black Arm:** the tramp -> Katrine -> (crossbows) -> Katrine again (joined) -> cupboard upstairs (shield half 2).
- **Handshakes** (trades; each side walks to a meet tile and the giver walks to wherever the partner really stands):
  H1 in Katrine's room: Phoenix gives 2 crossbows + half 1. Black Arm joins, takes half 2, the Curator writes 2 certificates.
  H2 in King Roald's room: Black Arm gives 1 certificate; both hand theirs to the King.
- **Variant `--xbows-supplied`:** a helper gives the Black Arm account 2 phoenix crossbows (tradeable) before the start. The
  Phoenix side skips the weapon store; Black Arm brings half 2 to the museum, Phoenix does the Curator and gives a certificate
  back at the King.

## Prerequisites
- Phoenix: kills Jonny (8 hp) and the Weaponsmaster (cl23, 20 hp). Works at attack/strength/defence/hp 30; proven at attack and
  strength 60, defence/hp 30 (the Weaponsmaster fight drops from 72-107 t to 24-45 t).
- Black Arm: no skills (proven on a fresh 10-hp account).
- Supplies: Phoenix 20 coins (+ 3 lobsters, never eaten in the runs). Black Arm nothing (variant: 2 phoenix crossbows).

## Measured (lockstep sim, fresh accounts, chaos engines = random door states)
| variant | seed 606 | seed 707 | seed 808 | median |
|---|---|---|---|---|
| default | 452 | 453 | 438 | **452** |
| --xbows-supplied | 299 | 315 | 315 | **315** |

Both accounts finish on the same tick. The Black Arm account waits ~270-290 t (default) / ~200 t (variant) for H1.

## Completion varps (for setting up later quests in a sim)
Phoenix: `%phoenixgang` (varp 146) = 10. Black Arm: `%blackarmgang` (varp 145) = 4. (`setvar phoenixgang 10` / `setvar blackarmgang 4`.)

## Limits
- Shared world: the Weaponsmaster respawns 700 t after a kill; the chest/cupboard stay open 300 t after use (handled).
- A door that some other player shuts in your face can slow a handshake (the giver tries the next free tile next to the partner).
