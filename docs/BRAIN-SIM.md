# Brain simulator

The brain simulator runs real bot brains offline. A brain is the `LeanBot` subclass that decides what a bot does each
tick. In the sim it runs its real `run()` loop and real packet decoders, with no stubs and no edits, against a model
of the server written in TypeScript. There is no engine, no socket and no wall clock, so a test that would take
minutes of live play finishes in milliseconds to seconds, and it fails the same way every time.

Use it for logic bugs: a brain that sends the wrong packet, waits on the wrong signal, walks into a closed door,
wedges on a tile or misreads an interface. For sequencing and game-content bugs (dialogs, quest varps, real npc
behaviour) use the lockstep sim instead ([SIM.md](SIM.md)). [GUIDE.md](../GUIDE.md) has the rule of thumb for which
tool to reach for.

All of it lives in `server/webclient/headless/sim/`. The in-tree [README](../overlay/server/webclient/headless/sim/README.md)
is the API reference and [ARCHITECTURE.md](../overlay/server/webclient/headless/sim/ARCHITECTURE.md) lists what the
model can and cannot prove.

## Run the test suite

```sh
cd rs-sdk/server/webclient
bun headless/sim/run-tests.ts                    # every suite; prints "[gate] PASS — N pass / 0 fail"
bun headless/sim/run-tests.ts --filter=door      # only files whose name matches
```

A few navgrid tests read the game cache, so start the lockstep engine once before the first full run (see the
README quick start). The brain-sim tests themselves do not need the engine.

## The parts

| file | what it is |
|---|---|
| `world.ts` | `SimWorld`, the server model for one player: the engine's step order, the 25-waypoint cap, "MOVE cancels a pending loc/npc op", npc wander and patrol. Collision is pluggable: `openField()` for unit tests, `rsmodCanTravel()` for the real map collision |
| `protocol.ts` | encodes server packets bit-exactly for the real client decoders, and parses what the brain sends back into typed actions such as `{ type: 'opnpc', op: 3, index: 11 }` |
| `harness.ts` | `SimHarness`: one brain in a `SimWorld`, pumped one tick at a time. Each tick returns `{ actions, events, player }` |
| `coop.ts` | `CoopWorld` + `CoopHarness`: several real brains in one world (see below) |
| `skills.ts`, `combat.ts`, `shop-fidelity.ts` | skilling, combat maths and shop pricing on top of `CoopWorld` |
| `run-tests.ts` | the test runner with the pass/fail gate |

## One bot: `SimHarness`

```ts
const world = new SimWorld(2660, 3283, openField());
world.addNpc(11, 23, 2665, 3283);               // an npc 5 tiles east
const bot = new MyBrain();                      // your LeanBot subclass
bot.exitOnStuck = false;                        // never process.exit() the test runner
const h = new SimHarness(bot, world);
await h.start({ stats: [{ stat: 17, xp: 13_034_431, level: 99 }] });
const ticks = await h.run(6);
expect(ticks.flatMap(t => t.actions).filter(a => a.type === 'opnpc')).toHaveLength(2);
```

Inputs the world cannot produce itself are queued for the next tick: `h.queueMessage(...)`, `h.queueInv(...)`,
`h.queueStat(...)`, `h.queueOpenMain(...)`. Assert on what the brain decided (its actions), not on its internals.

## Several bots: `CoopWorld` and `CoopHarness`

`coop.ts` puts N real brains into one world. Each bot sees the others in its own PLAYER_INFO with their names, so
`findPlayerIndexByName` works the same as live. On top of the movement model it carries:

- **trade**, ported from the game's trade script: request, the reciprocal player op, offers, the two-stage accept,
  the free-slot rule, and decline when a window closes;
- **the bank**: booths and banker npcs, deposits, withdrawals, noted withdrawals;
- doors that open and close with the real zone packets, shops, ground items, a toll gate, death with keep-3,
  aggressive npcs, the 250-player view cap, and `removePlayer` to inject a disconnect.

```ts
const world = new CoopWorld(openField());
const h = new CoopHarness(world);
h.add({ bot: walker,  name: 'walker',  index: 10, x: 3200, z: 3200 });
h.add({ bot: watcher, name: 'watcher', index: 11, x: 3205, z: 3200 });
await h.start();
for (let i = 0; i < 20; i++) await h.tick();
expect(watcher.findPlayerIndexByName('walker')).toBeGreaterThanOrEqual(0);
expect(world.events.some(e => e.kind === 'door-opened')).toBe(true);
```

`crowd.test.ts`, `door-cross.test.ts` and `castle-door-wedge.test.ts` are complete multi-bot test files to copy from.

## Example

[`examples/brain-sim-door.ts`](../examples/brain-sim-door.ts) is a runnable script, not a test: two real `LeanBot`
brains in one `CoopWorld`. One walks through the closed Lumbridge castle door (it sends the open op, the world opens
the door and sends the zone packet, the bot's door tracker reads it, and the bot walks through), and the other one
watches it by name. It needs no engine:

```sh
cd rs-sdk/server/webclient
bun ../../../rs-sdk-stun-toolkit/examples/brain-sim-door.ts   # the toolkit folder sits next to rs-sdk/
```

It prints the tick the door opened and the tick the walker arrived, then `PASS`, and exits 0.

## Limits

The model is a port of the parts of the server our bots touch, not the whole engine. There is no script engine, so
no real dialogs, quest varps or npc combat AI. Most worlds use static collision, and real-map collision has only been
checked against the engine in the Lumbridge to Ardougne corridor (x 2600-3260, z 3200-3520, ground level). A green brain-sim run means the brain's
logic is right. It does not mean a quest works: prove that in the lockstep sim.
