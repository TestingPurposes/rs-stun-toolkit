# Offline brain simulator (`headless/sim/`)

Runs the **real** LeanBot-based brains — their actual `run()` decode loop, no
stubs, no edits to the bots — against a faithful offline port of the server, so
brain regressions get caught in a `bun test` run instead of in production.

> 📐 **[ARCHITECTURE.md](./ARCHITECTURE.md)** is the capabilities-&-limits reference — what the sim
> **can** and **cannot** prove, the layer/module map, the fidelity boundary, and the test index. This
> README is the hands-on API (how to write a test).

```powershell
cd server/webclient
bun headless/sim/run-tests.ts              # every suite
```

| Suite | What it locks down | Cost |
|---|---|---|
| `protocol.test.ts` | the wire layer, validated against the REAL decoders/encoders | ~30ms |
| `world.test.ts` | engine movement semantics (takeStep, wedge rule, 25-cap, MOVE-cancels-OP, npc wander/patrol) + real-collision Ardougne routes | ~7s (WASM) |
| `combat.test.ts` | combat-math anchors: formula max hits reproduce live observations; route ordering | ~30ms |
| `quest.test.ts` | QuestRunnerBot drives the Rune Mysteries fixture end to end; the Dragon Slayer dialog spine | fast |

The full per-file index is in [ARCHITECTURE.md](./ARCHITECTURE.md#test-suite-index).

Also: **`combat.ts` is a CLI** — `bun headless/sim/combat.ts` prints the level-1→melee-99 route
comparison (cows/goblins/giants × styles) from the engine's own formulas. `skills.ts` (SkillWorld)
adds mining/fishing/runecrafting/fletching to CoopWorld; `coop.ts` carries death/keep-3, aggro,
shops, the bank, removePlayer (disconnect injection) and the harness livelock instrumentation
(`h.violations`, `h.instrumentPlanner`).

## Layers

- **`world.ts`** — the server. `SimWorld` ports `PathingEntity.takeStep()` verbatim
  (diagonal → E/W → N/S → `[0,0]`), `validateAndAdvanceStep`, walk-1/run-2 stepping,
  the reversed 25-waypoint queue, `MoveClickHandler`'s `clearPendingAction()`
  (MOVE cancels a pending OPLOC/OPNPC), loc-ops-only-on-a-zero-step-tick,
  "I can't reach that!", npc `wanderMode`/`patrolMode`, and the World.cycle order
  (client input → all NPCs → player). Collision is pluggable:
  `openField()` for fast unit tests, `rsmodCanTravel()` for the real WASM collision.
- **`protocol.ts`** — `ServerPacketStream` encodes PLAYER_INFO / NPC_INFO /
  UPDATE_INV / UPDATE_STAT / IF_* / MESSAGE_GAME / REBUILD_NORMAL bit-exactly for the
  real client decoders; `ClientActionParser` turns the brain's flushed bytes back
  into typed actions (`{type:'opnpc', op:3, index:11}`) for assertions. Both mirror
  the live ISAAC streams.
- **`harness.ts`** — `SimHarness` bypasses login the sound way (set
  `stream`/`inIsaac`/`outIsaac` directly; `run()` re-derives nothing from login) and
  pumps one tick at a time, returning `{actions, events, player}` per tick.

## Writing a brain test

```ts
const world = new SimWorld(2660, 3283, openField());
world.addNpc(11, 23, 2665, 3283);              // an npc 5 tiles east
const bot = new MyBrain();   // your LeanBot subclass
bot.exitOnStuck = false;                        // never process.exit() the test runner
bot.phase = 'work';
const h = new SimHarness(bot, world);
await h.start({ stats: [{stat: 17, xp: 13_034_431, level: 99}] });

const ticks = await h.run(6);
// assert on decisions, not on internals
expect(ticks.flatMap(t => t.actions).filter(a => a.type === 'opnpc')).toHaveLength(2);
expect(ticks.flatMap(t => t.actions).filter(a => a.type === 'move')).toHaveLength(0);
```

Test inputs the world can't produce itself are queued for the next tick:
`h.queueMessage('You have been stunned!')`, `h.queueInv([{id: 995, count: 2000}])`,
`h.queueStat(17, xp, 99)`, `h.queueOpenMain(5292)`.

## Route oracles (no bot needed)

```ts
simulateRoute(canTravel, route)       // the way brains send it: <=24-waypoint chunks, resent
simulateWaypoints(canTravel, start, path)  // ONE MOVE packet (engine caps at 25 waypoints)
```
`simulateRoute` is the one to use for validating a navgrid plan end to end;
`simulateWaypoints` is the single-packet oracle that caught the toVias corner-cutting
bug offline with zero live runs (see `world.test.ts`).

## Engine facts the suite pins down (all verified, several surprising)

1. **`path[0]` of every MOVE packet is the player's own tile**, so the first tick
   after any move click is burned consuming that self-start waypoint (zero steps).
   This is why the brains carry a "+1 cursor" and why a resend replays a leg.
2. **A blocked step returns `[0,0]` and does NOT advance the waypoint index** →
   permanent wedge. Nothing recovers it; only the client re-planning does.
3. **25-waypoint cap.** `MoveClickDecoder` reads at most 25 and `queueWaypoints`
   keeps only the **last 25** of a longer list — send a 50-tile route in one packet
   and the player beelines at a far tile. Chunk it (the brains send ≤24).
4. **MOVE cancels a pending OPLOC/OPNPC** (`clearPendingAction`) — the door/gate bug.
   Hence `suppressMoveUntil = tick + 6` after every OPLOC.
5. **Loc ops only fire on a tick where the player took zero steps**; NPC ops can fire
   pre-movement, and the engine re-paths to a pathing-entity target every tick — which
   is why an npc op (talk, attack, op3) is sent with **no** MOVE inside follow range.
6. **The engine walks you to a tile *adjacent* to the NPC** (`naiveDestination`), never
   onto it — an op needs cardinal adjacency, never "under".

## Multi-bot worlds: players, trades + banking

`CoopWorld`/`CoopHarness` generalise the sim to **N real bots in one world**: peers render into each
bot's PLAYER_INFO with APPEARANCE names (so `findPlayerIndexByName` resolves), TRADE is ported line-by-line from `trade.rs2` (request/reciprocal-OPPLAYER4/
offer/2-stage accept/capacity rule/decline-on-close), and the BANK models the proven noted-bulk
withdraw loops — bugs that used to cost a live run at minutes per iteration.

```ts
const world = new CoopWorld(openField());
const h = new CoopHarness(world);
h.add({ bot: seer,   name: 'seer1',   index: 10, x: 3200, z: 3200 });
h.add({ bot: target, name: 'target1', index: 11, x: 3208, z: 3200, inv: [{ id: 373, count: 1 }] });
await h.start();
for (let i = 0; i < 10; i++) await h.tick();
expect(seer.findPlayerIndexByName('target1')).toBeGreaterThanOrEqual(0);   // peers render with their names
// a brain that trades sends OPPLAYER4 + the trade interface buttons; assert on world events such as
// 'trade-opened' and 'trade-completed' (see crowd.test.ts for a full test file)
```

Coop fidelity limits (vs live): the 250-player cap is modelled (level-scoped, see `crowd.test.ts`) but
the viewDistance shrink/grow schedule is not, `busy` = any-modal-open (engine also counts queued
scripts), no combat/skilling/loc-respawn, displaynames = toScreenName. Only the single-bot `SimHarness`
cannot render peers; use `CoopHarness` for anything peer-to-peer.

## Limits

- Static geometry only: no dynamic NPC/player collision layers (players don't block
  players anyway), no loc respawn, no combat, no real thieving RNG (a successful
  OPNPC3 is reported as an `op-fired` event; feed coins/xp with `queueInv`/`queueStat`).
- `rsmodCanTravel()` needs `initPathfinding()` + `applyBlockedEdges(blockDoor)` first,
  and doors are masked OPEN in the WASM — `SimWorld.addDoor()` re-closes the ones a
  test cares about.
- Real-collision fidelity is only diffed against the engine inside the
  Lumbridge↔Ardougne corridor (x2600-3260 / z3200-3520, level 0) — see
  `blocked-tiles.ts`.
