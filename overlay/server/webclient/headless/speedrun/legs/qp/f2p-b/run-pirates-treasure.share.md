# Pirate's Treasure (rs-sdk bot script, protocol rev 289)

Plays **Pirate's Treasure** (2 QP) from Port Sarim: smuggles Karamja rum off the island in Luthas' banana crate, trades it
to Redbeard Frank for a chest key, opens Hector's chest in the Blue Moon Inn (Varrock) and digs up the treasure in Falador park.

Files: `q-pirates-treasure.ts` (quest code, cheat-free), `run-pirates-treasure.ts` (launcher), `fb-lib.ts` / `fb-launch.ts`
(lane helpers), `fk-lib.ts` (climb, customs ship, energy log).

## Steps (verified in the 289 content, `quests/quest_hunt/scripts` = H)
1. Redbeard Frank (375, 3053,3250) "I'm in search of treasure." (H/redbeard_frank.rs2:59-67).
2. Glory -> Karamja. Zambo (568) sells the rum. Luthas (379) "Could you offer me employment on your plantation?"
3. Banana crate 2072 (2943,3151): the rum, then 10 bananas; each is a mesbox, so the script resumes it and sends the next
   use in the same tick (H/banana_crate.rs2). Luthas pays 30 gp, ships the crate (%crate_rum = 2), then after p_delay(3) opens a
   multi4 that must be answered (H/luthas.rs2:13-30).
4. Customs officer's ship to Port Sarim (30 gp; she searches you: hold no rum, customs_officer.rs2:45-90). Gangplank 2084.
5. Wydin (557): "Can I get a job here?" (white apron in the pack). The job only gates his back door 2069 (apron WORN, Wydin
   within 10 tiles, H/food_store.rs2:1-16). Grocery crate 2071 -> the rum; leave by the same door.
6. Frank: rum -> chest key. Varrock Teleport; Blue Moon stairs 1725 (3227,3393); key on chest 2079 (3218,3396 L1) -> message; read it.
7. Falador Teleport; kill the gardener (lvl 3, 7 hp) because he stops any dig within 10 tiles (H/dig.rs2:7-8); dig at (2999,3383).
   Completion: 450 gp, gold ring, emerald, 2 QP.

Rum spills on ANY teleport (teleport.rs2:87-93): no teleport between step 5 and Frank.

## Prerequisites
No quests. Magic 37 (Falador Teleport; Varrock 25). If the runes or levels are missing, the script walks instead (slower, not
measured). Combat for the gardener: attack/strength/hp 15 is enough (fk19); a fresh account (hp 10, att 1) died (fk8).

## Supplies (`--supply`)
white_apron, 10 banana, spade, 60 coins (rum 30 + ship 30; Luthas pays 30), amulet_of_glory_1 (one charge: Karamja),
2 law + 6 air + 1 fire + 1 water (Varrock + Falador Teleport). Start: by Frank (3050,3250). End: Falador park (2999,3383).

## Measured (lockstep sim, 400 ms tick, sim stats magic 37, att/str 30, hp 20)
| run | engine | ticks |
|---|---|---|
| fk11 | normal | 269 |
| fk14 | chaos seed 301 | 268 |
| fk16 | chaos seed 302 | 282 |
| fk18 | chaos seed 303 | 268 |
| fk21 | chaos 303, glory(1) supply | 256 |

Median **268 ticks** (~107 s).

## Limits
- Zambo's rum price is assumed 30 gp (measured: 60 -> 30); a different shop stock price would need more coins.
- The sim shows run energy 100 throughout; live run energy drains, so live walks may be slower.
