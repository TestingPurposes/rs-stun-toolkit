# Fight Arena (run-fight-arena.ts)

**What it does.** Lady Servil, the Khazard armour, the drunk guard and his Khali brew, Jeremy, then the Ogre, the Scorpion and Bouncer; out without fighting the General.

**Prerequisites.** no gates; three fights (Ogre 63, Scorpion 44, Bouncer 137/116 hp): proven at att/str/def/hp 70 + prayer 43 (Protect from Melee against Bouncer) + rune scimitar + 12 sharks (6-8 eaten; without prayer 2 of 9 runs died with 8 sharks).

**Supplies (SUPPLY in q-fight-arena.ts).** 5 coins, 12 shark, a weapon

**Start.** next to Lady Servil (2567,3197). `--sim` sets everything up on a local engine; `--live <account>` refuses every staff cheat.

**Measured (lockstep sim, 400 ms ticks).** 651 t median (651/685/583, chaos 3601-3603); 568 t at 99 combat (earlier code).

**Limits.** None known beyond the above. Quest varps are not transmitted: every step gates on items,
position, dialog text or xp. Lane notes: `STATUS.md`.

```
bun headless/speedrun/legs/qp/ardougne/run-fight-arena.ts --supply
LC_HOST=localhost:<port> SIM_LOCKSTEP=1 bun headless/speedrun/legs/qp/ardougne/run-fight-arena.ts --sim <name>
```
