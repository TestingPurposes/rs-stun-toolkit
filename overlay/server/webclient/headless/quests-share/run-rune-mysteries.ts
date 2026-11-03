// =====================================================================================================
// quests-share/run-rune-mysteries.ts — standalone launcher for the Rune Mysteries driver.
// =====================================================================================================
// The quest logic is cheat-free: QuestRunnerBot's step list QUESTS.rune_mysteries
// (quest-runner.ts: Duke Horacio -> Sedridor -> Aubury -> Aubury -> Sedridor), run by RmRecoverBot (rc-rm-recover.ts:
// re-fetches a lost/banked package or notes) under driveRuneMysteries (rm-driver.ts: leaves instanced interiors, avoids
// the Al Kharid toll gate, threads the wizard-tower door + trapdoor, climbs out of the basement directly).
//
//   LIVE  (any server, NO cheats — every staff command throws):
//     bun headless/quests-share/run-rune-mysteries.ts --live <account>
//       reads bots/<account>/bot.env (BOT_USERNAME, PASSWORD, SERVER). Requirements: none (no quests, no levels, no items).
//       Needs 2 free pack slots (talisman/package/notes pass through one at a time). Start anywhere on the mainland.
//   SIM   (a LOCAL engine with staff cheats, e.g. the rs-sdk lockstep sim):
//     LC_HOST=localhost:<port> SIM_LOCKSTEP=1 bun headless/quests-share/run-rune-mysteries.ts --sim [name]
//       fresh account: LeanBot skips the tutorial, the launcher drops the tutorial kit, then the quest runs from Lumbridge.
//       Nothing else is cheated (the quest has no prerequisites). Refuses a non-local host. Use a new name per run.
//   --supply   prints the (empty) supply list and exits.
//   RM_START=<step 0-4> resumes from a step (only needed when the journal is yellow and an early item is already used up).
import { parseMode, initWorld, loginAndRun, simSetup, finish, show, waitTicks, type Item } from './share-lib.js';

const TAG = 'rm';
const SUPPLY: Item[] = [];
export const REQUIREMENTS = { quests: [], skills: {}, freeSlots: 2, start: 'anywhere on the mainland (Lumbridge after the tutorial)' } as const;

const mode = parseMode(TAG, 'run-rune-mysteries.ts --live <account> | --sim [name] | --supply');
if (mode.kind === 'supply') { console.log(`Rune Mysteries supplies: ${show(SUPPLY)} (2 free pack slots)`); process.exit(0); }
// lockstep sim: the driver paces itself with 600 ms sleeps (live tick length); hold each sim tick ~150 ms so a sleep
// spans a handful of ticks instead of a hundred (keeps the tick count comparable to live). Override with SR_SETTLE_MS.
if (mode.kind === 'sim' && process.env.SIM_LOCKSTEP === '1') process.env.SR_SETTLE_MS ??= '150';

const W = await initWorld();
const { QUESTS } = await import('../quest-runner.js');
const { RmRecoverBot } = await import('../rc-rm-recover.js');
const { driveRuneMysteries, surfaceFromBasement } = await import('../rm-driver.js');
const { levelForDisplayedXp } = await import('../leanbot.js');

/** A quest this run STARTED has no package/notes/talisman in the bank, so RmRecoverBot's bank check (built for
 *  accounts resuming with items already in the bank) is skipped: on a fresh account it walked to Varrock East bank before
 *  the Duke, and from the Duke's room (castle first floor) it could not walk there at all and held 600 ticks. The latch is
 *  the journal at login: NOT_STARTED (or not yet transmitted in the first ticks) = fresh. */
class ShareRmBot extends RmRecoverBot {
    private fresh: boolean | undefined;
    override missingItem(): number {
        if (this.fresh === undefined) {
            const s = this.questState('runemysteries').status;
            if (s === 'NOT_STARTED') this.fresh = true;
            else if (s === 'IN_PROGRESS' || s === 'COMPLETE' || this.tickCount >= 20) this.fresh = false;
            else return -1;   // the journal colour has not arrived yet
        }
        return this.fresh ? -1 : super.missingItem();
    }
}
const bot: any = W.wire(new ShareRmBot());
bot.setSteps(QUESTS['rune_mysteries']!);
if (process.env.RM_START) bot.stepIdx = Number(process.env.RM_START);
await loginAndRun(bot, mode, TAG);
if (mode.kind === 'sim') await simSetup(bot, mode, {}, levelForDisplayedXp);

const t0 = bot.tickCount;
const journal = () => bot.questState?.('runemysteries')?.status ?? 'NOT_OBSERVABLE';
console.log(`[${TAG}] journal 'runemysteries': ${journal()}`);
if (journal() === 'COMPLETE') { console.log(`[${TAG}] Rune Mysteries is already complete`); await finish(bot, TAG, await surfaceFromBasement(bot), t0, 'Rune Mysteries'); }
if (journal() === 'IN_PROGRESS' && !process.env.RM_START) console.warn(`[${TAG}] journal is IN_PROGRESS: starting at step 0 (Duke). If an early item is already used up, set RM_START=<step>.`);

let ok = false;
for (let attempt = 1; attempt <= 3 && !ok; attempt++) {
    ok = await driveRuneMysteries(bot, { findLongPath: W.findLongPath, timeoutMs: 30 * 60_000 });
    if (!ok) console.log(`[${TAG}] attempt ${attempt} timed out at step ${bot.stepIdx} — resuming`);
}
// leave the account on the SURFACE and confirm it before reporting COMPLETE (the essence wave mines from Varrock;
// 2 of 11 live runs ended parked in the basement and still printed COMPLETE). surfaceFromBasement leaves Sedridor's
// room by its inside tile (3107,9570), climbs the ladder, then falls back to multi-level travel; on the surface it then
// walks OUT of the Wizards' Tower ground floor (doors opened as needed) so the essence miner starts outside.
if (ok && !(await surfaceFromBasement(bot))) { ok = false; console.log(`[${TAG}] quest done but the account is still in the basement`); }
console.log(`[${TAG}] journal 'runemysteries': ${journal()}`);
await finish(bot, TAG, ok, t0, 'Rune Mysteries');
