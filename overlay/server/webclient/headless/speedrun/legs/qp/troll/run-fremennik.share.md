# The Fremennik Trials (3 QP) — `run-fremennik.ts`

Seven council votes in Rellekka, then Brundt: Swensen's maze, Manni's drinking contest (firecracker in the longhall pipe + a
low-alcohol keg from the Seers poison salesman), Sigli's Draugen (talisman hunt + kill), Sigmund's 13-npc trade chain
(Askeladden's promise costs 5000 gp), Olaf's lyre (musical tree branch, golden fleece from Lalli's stone soup spun at Seers,
Fossegrimen's altar), Thorvald's arena (Koschei, unarmed, 4 forms; form 4 is survived by the "honour death"), and Peer's house
(riddle combination lock + the bucket/jug/vase/mural puzzle). Route M (default): every trial start is merged into Sigmund's
forward chain, so Rellekka is looped once.

## Run
```
bun headless/speedrun/legs/qp/troll/run-fremennik.ts --supply
bun headless/speedrun/legs/qp/troll/run-fremennik.ts --sim [name]      # local engine only
bun headless/speedrun/legs/qp/troll/run-fremennik.ts --live <account>
```
`FREM_ROUTE=m|a`, `FREM_START=<stage>` / `FREM_STOP=<stage>` (route m: firecracker startsM east1 rock east2 seers altar votes peer
brundt), `FREM_STATS=99` (sim all-99 comparison), `FREM_DEBUG=1` (Draugen hunt trace).

## Prerequisites
- Quests: none. Skills: woodcutting 40 (branch), crafting 40 (lyre), fletching 25 (string it), magic 45 (Camelot Teleport).
- A wielded melee weapon for the Draugen (60 hp, +100 melee defence; sim: rune scimitar). It is dropped at Thorvald's ladder
  with every other weapon/armour/rune/axe the ladder refuses (thorvald:435-481).
- Prayer helps Koschei (Ultimate Strength + Incredible Reflexes at 31/34; sim prayer 43). Combat proven at att/str/def/hp 80.
- Start at the Camelot Teleport landing (2757,3478). End next to Brundt (2659,3669).
- **Peer banks everything worn and held** (peer:163-233): after the quest the pack is empty and the leftovers (coins, food,
  tinderbox, knife, strung lyre, potions) are in the bank.

## Supplies
5300 coins, beer, tinderbox, axe (WC 40; rune axe), knife, raw shark (sea turtle / manta ray also work), cabbage, potato, onion,
1 law + 5 air (Camelot Teleport), 6 sharks, 1 super attack(4), 1 super strength(4).

## Measured
Lockstep sim, fresh accounts, chaos engines (final code): 2200 (seed 6401), 2358 (6403), 2017 (6404) -> median 2200 ticks
(880 s at 400 ms). Earlier code: 2076 (6402). All-99 stats: 2104 (Koschei's form 4 lasts ~2 t per hp, so more hp is slower).

## Limits
- RNG: the Draugen hunt (the target butterfly wanders 40 tiles and re-spawns on a random 1-1000 t timer) 75-560 t; Koschei
  spawns 20-70 t after the climb and the unarmed fight is accuracy-bound (~360-450 t total in the arena).
- The two poison salesmen (2695,3495 / 2737,3491): the west one failed once (chaos 6401), the code falls back to the east one.
