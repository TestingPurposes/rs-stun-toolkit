# Throne of Miscellania (1 QP) — `run-throne.ts`

Sails from Rellekka to Miscellania, asks King Vargas for the throne, courts Princess Astrid (three stages: nine answers picked
by text from shuffled menus, flowers, the Dance emote, a bow, the Blow Kiss emote, a ring), shuttles between Vargas, Queen
Sigrid (Etceteria), Prince Brand and Advisor Ghrim for the peace treaty (awful anthem -> corrected anthem -> treaty), has Derrik
forge a giant nib from an iron bar, makes the giant pen, weeds the herb patches until the people's approval is 96/127, and has
Vargas sign and crown you.

## Run
```
bun headless/speedrun/legs/qp/troll/run-throne.ts --supply
bun headless/speedrun/legs/qp/troll/run-throne.ts --sim [name]      # local engine only
bun headless/speedrun/legs/qp/troll/run-throne.ts --live <account>
```
`THRONE_START=<stage>` / `THRONE_STOP=<stage>` (sail vargas1 court sigrid1 vargas2 sigrid2 brand ghrim sigrid3 vargas3 derrik
approval finish), `THRONE_HERB=<level>` (sim herblore, default 35), `THRONE_DEBUG=1`.

## Prerequisites
- Quests: The Fremennik Trials (the Rellekka sailor, viking_sailor.rs2:14) and Hero's Quest (the throne-room guard,
  misc_door_guard.rs2:10-17).
- Herblore 35 (weeding, weed_herbs.rs2:16-19). A MALE character (a female one courts Prince Brand: not built).
- Start on the Rellekka pier next to the sailor (2629,3691). End in Vargas' throne room (2501,3861, level 1).

## Supplies
Iron sickle (worn for the weeding), flowers (any "flowers" category obj; sim: flowers_waterfall_quest_mixed), a shortbow (any
normal/oak/willow/maple/yew/magic short or long bow), a gold ring (or sapphire/emerald/ruby/diamond/ring of life), an iron bar,
logs (or oak/willow/maple/yew/magic/achey).

## Measured
Lockstep sim, fresh accounts, chaos engines, herblore 35: 1907 (seed 6414), 1929 (6415), 1878 (6416) -> median 1907 ticks
(763 s at 400 ms). Herblore 99 (normal engine): 1517. The approval weeding is ~790 t at herblore 35 and ~520 t at 99; the six
Miscellania <-> Etceteria crossings are ~90-125 t each.

## Limits
- Male only. Approval does not decay within the quest (the daily update is date-based, managing_miscellania.rs2:146-181).
- Chaos engines put some door leaves where a normal open never does (loc_1515 at 2511,3860 blocks the castle entrance): the
  walker closes such a stray leaf and re-opens the door.
