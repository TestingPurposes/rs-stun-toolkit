// RM ITEM RECOVERY. A Rune Mysteries 'use' step (2: package on Aubury, 4: notes on
// Sedridor) can come round with the item GONE from the pack: the retired rc-strip banked it, or a death /
// keep-set drop threw it away. QuestRunnerBot then holds "missing use-item" forever (live: 8 accounts,
// ~3,000 hold lines, every run a 20-min timeout). Both NPCs re-issue a lost copy — but only when
// ~obj_gettotal (pack + BANK + worn) is 0 (aubury.rs2:11, sedridor.rs2:11), so a banked copy blocks
// the re-issue. Recovery, tick-driven so the sim can drive it:
//   1. walk to the Varrock-East bank (beside Aubury) and withdraw the item if it is banked;
//   2. not banked -> rewind to the step whose NPC re-issues it (290 -> Sedridor 1, 291 -> Aubury 3).
// Only on the surface: a basement copy of the problem is the bootstrap's escape job.
import { QuestRunnerBot } from './quest-runner.js';

const BANK_MAIN = 5292, BANK_INV = 5382, BANK_BOOTH_LOC = 2213;
const BANK_STAND = { x: 3253, z: 3420 }, BANK_BOOTH = { x: 3253, z: 3419 };   // Varrock East
const RESEARCH_PACKAGE = 290, RESEARCH_NOTES = 291, AUBURY = 553, SEDRIDOR = 300;
const RM_NPCS = new Set([AUBURY, SEDRIDOR, 741]);
const SED_DOOR = { x: 3108, z: 9570, closed: 1530 };   // Sedridor's room door (closed id; open = 1531)
/** item -> the step whose NPC hands out a replacement once none exists anywhere */
export const REISSUE_STEP: Readonly<Record<number, number>> = { [RESEARCH_PACKAGE]: 1, [RESEARCH_NOTES]: 3, 1438: 0 };
const AIR_TALISMAN = 1438;
const GIVE_UP_TICKS = 600;   // a bank trip that has not resolved in ~6 min is abandoned (rewind anyway)

export class RmRecoverBot extends QuestRunnerBot {
    private checked = new Set<number>();
    /** Sedridor said "...except I don't have it with me..." (state started, air talisman lost): bank, else the Duke. */
    needTali = false;   // items whose bank we already looked in this run
    private rItem = -1; private rSince = -1; private rOp = -100; private wdSent = -100;
    private sedDoorOp = -100; private sedDoorOps = 0;
    //

    /**
     * The quest item to look for in the bank, else -1. Two shapes:
     *  - a 'use' step whose item the pack lacks (hand-over impossible without it);
     *  - a 'talk' step whose REWARD is a quest item (Sedridor's package, Aubury's notes): if a copy is already
     *    banked the NPC will never hand out another (obj_gettotal counts the bank) — live: step-3 retries
     *    talked to Aubury for 20 min with the notes in the bank. A found copy completes that step.
     */
    missingItem(): number {
        const step = this.steps[this.stepIdx]; const ph = (this as any).phase;
        if (!step) return -1;
        if (ph !== 'travel' && ph !== 'interact') return -1;          // verify/dialog: an exchange is in flight
        if (this.needTali && this.backpack() && this.countOf(AIR_TALISMAN) === 0 && this.tile().z < 4000 && !this.checked.has(AIR_TALISMAN)) return AIR_TALISMAN;
        const item = step.op === 'use' ? step.useItem : step.op === 'talk' && step.expectItem !== undefined && REISSUE_STEP[step.expectItem] !== undefined ? step.expectItem : undefined;
        if (item === undefined) return -1;
        if (!this.backpack() || this.countOf(item) > 0) return -1;
        if (this.tile().z >= 4000 || this.checked.has(item)) return -1;
        return item;
    }
    needsRecovery(): boolean { return this.rItem >= 0 || this.missingItem() >= 0; }

    private finish(item: number, why: string): void {
        this.checked.add(item); this.rItem = -1;
        if (this.mainModalId === BANK_MAIN) this.sendCloseModalPublic();
        const held = this.countOf(item) > 0;
        const step = this.steps[this.stepIdx];
        const rewardStep = step?.op === 'talk' && step.expectItem === item;
        if (item === AIR_TALISMAN) { this.needTali = false; this.stepIdx = held ? 1 : 0; }
        else if (held && rewardStep) this.stepIdx++;                        // the banked copy IS this step's reward
        else if (!held && !rewardStep && REISSUE_STEP[item] !== undefined) this.stepIdx = REISSUE_STEP[item]!;
        (this as any).phase = 'travel'; (this as any).mlStarted = false; (this as any).attemptSince = -1;
        console.log(`[rm-recover] ${this.loginUser}: item ${item} ${held ? 'WITHDRAWN from bank' : `not banked (${why}) -> step ${this.stepIdx}${rewardStep ? ' asks the NPC for it' : ' re-issues it'}`}`);
    }

    /**
     * AUBURY'S OPTIONS REVEAL THE TRUE QUEST STATE ( accounts resumed at "step 4" from their
     * logs talked to Aubury for 20 min per attempt and never got notes). The quest varp is not transmitted, but
     * Aubury's choice is (aubury.rs2): a "teleport me to the Rune Essence" option = RM COMPLETE (done); a
     * "package for you" option = package held at state 3 (hand it over); a plain shop choice at the notes step =
     * the package was lost BEFORE Aubury got it -> rewind to Sedridor (step 1), who re-issues a lost package.
     */
    private lastText = new Map<number, string>();
    /** IF_SETTEXT values that changed since the last call (NPC lines, option labels). */
    private freshTexts(): string[] {
        const out: string[] = [];
        for (const [c, t] of this.ifText) if (this.lastText.get(c) !== t) { this.lastText.set(c, t); if (t && t.length > 12) out.push(t); }
        return out;
    }
    private jumpTo(step: number, why: string): void {
        this.stepIdx = step;
        (this as any).phase = 'travel'; (this as any).mlStarted = false; (this as any).attemptSince = -1;
        console.log(`[rm-recover] ${this.loginUser}: ${why} -> step ${step >= this.steps.length ? 'DONE' : step}`);
    }

    protected override driveDialog(): void {
        const step = this.steps[this.stepIdx];
        const opts = this.dialogOptions();
        // Every RM NPC line is logged (the varp is invisible; the dialog is the only evidence of the true state).
        if (step && RM_NPCS.has(step.npcType ?? -1)) {
            for (const t of this.freshTexts()) {
                console.log(`[rm-recover] ${this.loginUser}: step ${this.stepIdx} npc says: ${t.slice(0, 110)}`);
                // Sedridor at given_package (sedridor.rs2:24-29): "go and speak to him again" -> Aubury hands the notes
                if (step.npcType === SEDRIDOR && this.stepIdx === 1 && /don't have it with me/i.test(t) && !this.needTali && !this.checked.has(AIR_TALISMAN)) {
                    this.needTali = true; this.jumpTo(0, 'Sedridor wants the air talisman we no longer hold (state started) — bank first, else the Duke re-issues it');
                    super.driveDialog(); return;
                }
                // Duke at runemysteries_complete (duke_horacio.rs2:54-56): "No, all is well for me." — 7 rmquest accounts
                // ledgered at step 0 had finished RM long ago and asked him for 3 h
                // Duke at runemysteries_started, talisman NOT lost (duke_horacio.rs2:50 else-branch): "...delivery of that
                // talisman I gave you..." — step 0 already happened in an earlier run; its verify waits for the talisman count
                // to RISE and never advances.
                if (step.npcType === 741 && this.stepIdx === 0 && /talisman I gave you/i.test(t)) { this.jumpTo(1, 'the Duke says "that talisman I gave you": RM already started — on to Sedridor'); super.driveDialog(); return; }
                if (step.npcType === 741 && /all is well for me/i.test(t)) { this.jumpTo(this.steps.length, 'the Duke says "all is well": Rune Mysteries is ALREADY COMPLETE'); super.driveDialog(); return; }
                if (step.npcType === SEDRIDOR && /speak to Aubury once more/i.test(t)) { this.jumpTo(3, 'Sedridor: the notes were lost — Aubury makes a copy (state notes received)'); super.driveDialog(); return; }
                if (step.npcType === SEDRIDOR && /speak to him again/i.test(t)) { this.jumpTo(3, 'Sedridor says Aubury still has our package (state given_package)'); super.driveDialog(); return; }
            }
            // "teleport me to the Rune Essence" is offered only once the quest is COMPLETE (Aubury and Sedridor alike)
            if (opts.length && !opts.some(o => o.text === '') && opts.some(o => /teleport me to the Rune Essence/i.test(o.text))) {
                if (!(this as any).resumedDialog) {
                    const i = opts.findIndex(o => /no thank you|nothing thanks/i.test(o.text));
                    this.ifButton(opts[i >= 0 ? i : 0]!.com); (this as any).resumedDialog = true;
                    this.jumpTo(this.steps.length, 'the essence teleport is offered: Rune Mysteries is ALREADY COMPLETE');
                }
                return;
            }
        }
        if (step?.op !== 'talk' || step.npcType !== AUBURY || step.expectItem !== RESEARCH_NOTES || !opts.length) { super.driveDialog(); return; }
        if (opts.some(o => o.text === '')) { this.warm(); return; }   // labels trail IF_OPENCHAT by a tick
        if ((this as any).resumedDialog) return;
        const pick = (re: RegExp) => { const i = opts.findIndex(o => re.test(o.text)); if (i >= 0) { this.ifButton(opts[i]!.com); (this as any).resumedDialog = true; } return i >= 0; };
        const tp = opts.some(o => /teleport me to the Rune Essence/i.test(o.text));
        if (!tp && pick(/package for you/i)) { console.log(`[rm-recover] ${this.loginUser}: Aubury offers the package branch -> handing it over`); return; }
        if (opts.some(o => /no thank you/i.test(o.text))) {
            pick(/no thank you/i);
            if (tp) { this.stepIdx = this.steps.length; console.log(`[rm-recover] ${this.loginUser}: Aubury offers the essence teleport -> Rune Mysteries is ALREADY COMPLETE`); }
            else { this.stepIdx = REISSUE_STEP[RESEARCH_PACKAGE]!; console.log(`[rm-recover] ${this.loginUser}: Aubury offers only his shop -> package was lost before delivery; rewinding to step ${this.stepIdx} (Sedridor re-issues it)`); }
            (this as any).phase = 'travel'; (this as any).mlStarted = false; (this as any).attemptSince = -1;
            return;
        }
        super.driveDialog();
    }

    protected override doCombat(): void {
        if (this.stallDoorTick()) return;   // the shared stall-door rule FIRST (this override returns early in its own branches)
        // SEDRIDOR'S ROOM DOOR: his basement room (x3100-3107, z9568-9574) is walled; its ONLY door is
        // m48_149 "0 36 34: 1530 0" @(3108,9570) — map-placed CLOSED. The planner masks doors and the quest walker never
        // opens them, so bots wait in the corridor at (3106,9575) and every talk is DISCARDED (ACK-NOACK-TALK-NPC; 4 h,
        // all zip RM batches). Earlier batches only passed while another player had it open. Outside the room on a
        // Sedridor step: blind-op the CLOSED id (an open door = id miss, ignored by the server) every 12 ticks, bounded.
        {
            const st = this.steps[this.stepIdx]; const ph = (this as any).phase; const me = this.tile();
            const inRoom = me.x >= 3100 && me.x <= 3107 && me.z >= 9568 && me.z <= 9574;
            if (st?.npcType === SEDRIDOR && me.z > 9500 && !inRoom && (ph === 'interact' || ph === 'verify')
                && this.tickCount - this.sedDoorOp >= 12 && this.sedDoorOps < 30) {
                this.opLoc(SED_DOOR.x, SED_DOOR.z, SED_DOOR.closed, 1); this.sedDoorOp = this.tickCount; this.sedDoorOps++;
                if (this.sedDoorOps === 1) console.log(`[rm-recover] ${this.loginUser}: opening Sedridor's room door (${SED_DOOR.x},${SED_DOOR.z}) from (${me.x},${me.z})`);
                return;
            }
        }
        // REWARD ALREADY HELD: an account at "received package" that still carries the package got Sedridor's
        // "...vital he receives this package" forever — the step waits to GAIN a package it already has. A quest-only
        // reward (package/notes) in the pack means that step is done. (Not the air talisman: it can come from elsewhere.)
        {
            const st = this.steps[this.stepIdx]; const ph = (this as any).phase;
            if (st?.op === 'talk' && (st.expectItem === RESEARCH_PACKAGE || st.expectItem === RESEARCH_NOTES)
                && (ph === 'travel' || ph === 'interact') && this.backpack() && this.countOf(st.expectItem) > 0) {
                this.jumpTo(this.stepIdx + 1, `step ${this.stepIdx}'s reward ${st.expectItem} is already in the pack`);
                return;
            }
        }
        if (this.rItem < 0) { const m = this.missingItem(); if (m >= 0) { this.rItem = m; this.rSince = this.tickCount; console.log(`[rm-recover] ${this.loginUser}: step ${this.stepIdx} needs item ${m} but the pack has none — checking the bank`); } }
        if (this.rItem < 0) { super.doCombat(); return; }
        if (this.countOf(this.rItem) > 0) { this.finish(this.rItem, 'held'); return; }
        if (this.tickCount - this.rSince > GIVE_UP_TICKS) { this.finish(this.rItem, 'bank trip timed out'); return; }
        if (this.mainModalId === BANK_MAIN) { this.warm(); return; }
        const me = this.tile();
        if (Math.max(Math.abs(me.x - BANK_STAND.x), Math.abs(me.z - BANK_STAND.z)) > 1) { if (this.walkToExact(BANK_STAND.x, BANK_STAND.z)) return; }
        if (this.tickCount - this.rOp >= 8) { this.opLoc(BANK_BOOTH.x, BANK_BOOTH.z, BANK_BOOTH_LOC, 2); this.rOp = this.tickCount; } else this.warm();
    }

    protected override handleMainModal(): boolean {
        if (this.rItem < 0 || this.mainModalId !== BANK_MAIN) return super.handleMainModal();
        const item = this.rItem;
        if (this.countOf(item) > 0) { this.finish(item, 'held'); return true; }
        if (this.tickCount - this.rSince > GIVE_UP_TICKS) { this.finish(item, 'bank trip timed out'); return true; }
        const inv = (this as any).invs.get(BANK_INV);
        if (!inv) return true;   // bank contents not decoded yet
        let slot = -1; for (let i = 0; i < inv.ids.length; i++) if (inv.ids[i] === item && inv.counts[i] > 0) { slot = i; break; }
        if (slot < 0) { this.finish(item, 'bank has none'); return true; }
        if (this.tickCount - this.wdSent >= 6) { this.invButton(1, item, slot, BANK_INV); this.wdSent = this.tickCount; }
        return true;
    }
}
