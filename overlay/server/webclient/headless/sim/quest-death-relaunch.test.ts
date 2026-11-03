// cd server/webclient/headless/sim && bun test quest-death-relaunch.test.ts
//
// DEATH PLATEAU — a RELAUNCHED account, the whole async driver (driveDeathPlateau) against a world that runs
// TRANSCRIPTIONS of Tenzing / Dunstan / Denulth / the sherpa-hut doors / the scouting zone (every branch cited to
// server/content/scripts/quests/quest_death/scripts/*.rs2), with the engine's inv_add overflow rule (a full pack drops
// the obj on the floor, engine/script/handlers/InvOps.ts INV_ADD).
//
// THE LIVE WEDGE (acct15, logs/paths/dp-acct15.log + logs/dpquest-acct15.json,):
//   a full pack lost Denulth's certificate on the floor; the old no-progress BUMP then walked map 4 -> 8 on four
//   probes that "matched no fact"; the persisted {equip:70, map:8} sent every relaunch to Tenzing for a
//   'replacement map (for Denulth)' — which he only draws at map >= got_map — forever.
//   1. that exact relaunch (real map 4, cert gone, full pack, stale store) must reach the right next task and FINISH;
//   2. a probe whose answer carries no stage evidence must NOT move the knowledge, and must stop (not loop).
// ⛔ What this does NOT prove: live page timing / the live hut geometry (pockets are sealed here by a canTravel rule,
// not the real walls). The NPC scripts below are hand transcriptions and can drift — quest-death.test.ts pins the
// lines the driver reads against the .rs2 sources.
import { describe, test, expect, afterEach } from 'bun:test';
import { CoopWorld, CoopHarness, type CoopPlayer } from './coop.js';
import type { ClientAction } from './protocol.js';
import { linePath } from './harness.js';
import { DIALOG_ROOT_BY_ID } from '../capability-tables.js';
import {
    DeathPlateauBot, driveDeathPlateau, DP_NPC, DP_OBJ, DP_LOC, DP_IF, EQ, MAP, SCOUT_ZONE, pocketOf, type DpKnowledge,
} from '../quest-death.js';

const lp = (_l: number, sx: number, sz: number, dx: number, dz: number) => linePath(sx, sz, dx, dz);
const INV_INTERFACE = 3214;
const CHAT_TEXT = 4885, CHAT_CONTINUE_ROOT = 2461;   // the coop sim's continue-page convention (coop.ts questInteract)
const CHOICE_ROOT: Record<number, number> = { 2: 2459, 3: 2469, 4: 2480, 5: 2492 };
const YELLOW = 32736, GREEN = 992;   // quest-state.ts JOURNAL_COLOUR
const FLY_ROD = 309, FEATHER = 314, LOBSTER = 379;

let h: CoopHarness | null = null;
afterEach(async () => { await h?.stop(); h = null; });

// ---- the sealed pockets: no step may cross into / out of the hut or the yard (only the doors' teleports do) ----
const sealed = (p: string | null) => p === 'hut' || p === 'yard';
const canTravel = (level: number, x: number, z: number, dx: number, dz: number) => {
    const a = pocketOf(level, x, z), b = pocketOf(level, x + dx, z + dz);
    return !((sealed(a) || sealed(b)) && a !== b);
};

type Page = { t: 'npc' | 'player' | 'box'; text: string } | { t: 'choice'; opts: string[] };
type Script = Generator<Page, void, number>;
const N = (text: string): Page => ({ t: 'npc', text });
const P = (text: string): Page => ({ t: 'player', text });
const B = (text: string): Page => ({ t: 'box', text });
const C = (...opts: string[]): Page => ({ t: 'choice', opts });

class DpScriptWorld extends CoopWorld {
    equip = 0; map = 0; givenMap = false; givenCombo = false;
    tenzingOverride: ((p: CoopPlayer) => Script) | null = null;
    talks: Array<{ npc: string; equip: number; map: number }> = [];
    overflowDrops: number[] = [];
    private dialogs = new Map<number, { gen: Script; page: Page }>();
    private journaled = false;

    constructor() { super(canTravel); }
    // ---- engine primitives ----
    total(p: CoopPlayer, obj: number) { return this.invTotal(p.inv, obj); }
    give(p: CoopPlayer, obj: number, n = 1) {   // inv_add: overflow -> the floor under the player (InvOps.ts INV_ADD)
        const added = this.invAdd(p.inv, obj, n);
        p.outInvs.add(INV_INTERFACE);
        if (added < n) { this.addGroundObj(p.x, p.z, obj, n - added); this.overflowDrops.push(obj); this.events.push({ tick: this.tick, kind: 'overflow-drop', detail: { obj } }); }
    }
    del(p: CoopPlayer, obj: number, n = 1) { this.invRemove(p.inv, obj, n); p.outInvs.add(INV_INTERFACE); }
    mes(p: CoopPlayer, text: string) { (p.outPre as unknown as Array<{ kind: string; text: string }>).push({ kind: 'msg', text }); }
    private out(p: CoopPlayer, o: Record<string, unknown>) { (p.outPre as unknown as Array<Record<string, unknown>>).push(o); }
    private near(p: CoopPlayer, type: number, r: number) { for (const n of this.npcs.values()) if (n.typeId === type && Math.max(Math.abs(n.x - p.x), Math.abs(n.z - p.z)) <= r) return true; return false; }

    // ---- dialog driver: a script is a generator of pages; effects run between pages, in script order ----
    private start(p: CoopPlayer, gen: Script) { this.dialogs.set(p.index, { gen, page: N('') }); this.step(p, undefined); }
    private step(p: CoopPlayer, answer: number | undefined) {
        const d = this.dialogs.get(p.index)!;
        const r = d.gen.next(answer as number);
        if (r.done) { this.dialogs.delete(p.index); this.out(p, { kind: 'close' }); return; }
        d.page = r.value;
        if (r.value.t === 'choice') {
            const root = CHOICE_ROOT[r.value.opts.length]!;
            DIALOG_ROOT_BY_ID.get(root)!.optionComs.forEach((com, i) => this.out(p, { kind: 'settext', com, text: (r.value as { opts: string[] }).opts[i] }));
            this.out(p, { kind: 'openchat', com: root });
        } else {
            this.out(p, { kind: 'settext', com: CHAT_TEXT, text: r.value.text });
            this.out(p, { kind: 'openchat', com: CHAT_CONTINUE_ROOT });
        }
    }

    override coopTick(actions: Map<number, ClientAction[]>) {
        if (!this.journaled) {   // the login burst's journal colour (quests.rs2 ~send_quest_progress_colour)
            this.journaled = true;
            for (const p of this.playersByIndex.values()) this.out(p, { kind: 'setcolour', com: DP_IF.JOURNAL, colour: this.equip >= EQ.COMPLETE ? GREEN : YELLOW });
        }
        const out = super.coopTick(actions);
        // [zone,0_44_56_48_24] (quest_death.rs2:130-136)
        for (const p of this.playersByIndex.values()) {
            if (p.x >= SCOUT_ZONE.x0 && p.x <= SCOUT_ZONE.x1 && p.z >= SCOUT_ZONE.z0 && p.z <= SCOUT_ZONE.z1 && this.map === MAP.GOT_MAP && !this.dialogs.has(p.index)) {
                this.map = MAP.SCOUTED_AREA;
                this.mes(p, 'You can see that there are no trolls on the secret path.');
                this.mes(p, 'You should go and speak to Denulth.');
                this.start(p, (function* () { yield P("I think this is far enough, I can see Death Plateau and it looks like the trolls haven't found the path. I'd better go and tell Denulth."); })());
            }
        }
        return out;
    }

    protected override applyAction(p: CoopPlayer, a: ClientAction): void {
        const d = this.dialogs.get(p.index);
        if (d && a.type === 'resume' && d.page.t !== 'choice') { this.step(p, undefined); return; }
        if (d && a.type === 'ifbutton' && d.page.t === 'choice') {
            const root = CHOICE_ROOT[d.page.opts.length]!;
            const opt = DIALOG_ROOT_BY_ID.get(root)!.optionComs.indexOf(a.com) + 1;
            if (opt > 0) this.step(p, opt);
            return;
        }
        if (d && a.type === 'closemodal') { this.dialogs.delete(p.index); this.out(p, { kind: 'close' }); return; }
        if (a.type === 'opnpc' && a.op === 1) {
            const npc = this.npcs.get(a.index);
            if (npc && Math.max(Math.abs(p.x - npc.x), Math.abs(p.z - npc.z)) <= 2 && !d) {
                const script = npc.typeId === DP_NPC.TENZING ? (this.tenzingOverride?.(p) ?? this.tenzing(p))
                    : npc.typeId === DP_NPC.DUNSTAN ? this.dunstan(p) : npc.typeId === DP_NPC.DENULTH ? this.denulth(p) : null;
                if (script) { this.talks.push({ npc: npc.typeId === DP_NPC.TENZING ? 'tenzing' : npc.typeId === DP_NPC.DUNSTAN ? 'dunstan' : 'denulth', equip: this.equip, map: this.map }); this.start(p, script); return; }
            }
        }
        if (a.type === 'oploc' && a.op === 1 && this.oploc(p, a)) return;
        super.applyAction(p, a);
    }

    // ---- the hut doors + the stile (quest_death.rs2:46-71, :103-118) ----
    private oploc(p: CoopPlayer, a: { x: number; z: number; locId: number }): boolean {
        const self = this;
        const tp = (x: number, z: number) => { p.teleport(x, z); this.events.push({ tick: this.tick, kind: 'door-through', detail: { loc: a.locId, x, z } }); };
        if (a.locId === DP_LOC.SHERPA_DOOR && a.x === 2822 && a.z === 3555) {
            // wall on the EAST edge of (2822,3555): on the loc's own column = leaving (check_axis)
            if (p.x === 2822 && p.z === 3555) { tp(2823, 3555); return true; }
            if (!(p.x === 2823 && p.z === 3555)) return true;   // not on the door's tiles: the op does nothing
            if (this.map >= MAP.SPOKEN_TENZING) { tp(2822, 3555); return true; }
            this.start(p, (function* () {
                yield B('You knock on the door.');
                if (self.near(p, DP_NPC.TENZING, 5)) {
                    yield N('No milk today! Thank you!');
                    if (self.map >= MAP.SPOKEN_SABA) { yield P("I'm not the milkman, I need your help!"); yield N("Oh...OK. You'd better come in then."); tp(2822, 3555); }
                }
            })());
            return true;
        }
        if (a.locId === DP_LOC.SHERPA_BACKDOOR && a.x === 2820 && a.z === 3557) {
            // wall on the NORTH edge of (2820,3557): on the loc's own row = leaving
            if (p.x === 2820 && p.z === 3557) {
                if (this.map >= MAP.GOT_MAP) tp(2820, 3558);
                else if (this.near(p, DP_NPC.TENZING, 5)) this.start(p, (function* () { yield N("Where do you think you're going? This is private property!"); })());
                return true;
            }
            if (p.x === 2820 && p.z === 3558) tp(2820, 3557);
            return true;
        }
        if (a.locId === DP_LOC.STILE && a.x === 2817 && a.z === 3562) {
            if (p.x === 2817 && p.z === 3561) tp(2817, 3564);
            else if (p.x === 2817 && p.z === 3564) tp(2817, 3561);
            return true;
        }
        return false;
    }

    // ---- [opnpc1,death_sherpa] death_sherpa.rs2 ----
    *tenzing(p: CoopPlayer): Script {
        if (this.equip >= EQ.COMPLETE) {
            yield P('Hello Tenzing!'); yield N('Hello again traveller. What can I do for you?');
            yield C('Can I buy some Climbing boots?', 'What does a Sherpa do?', 'How did you find out about the secret way?', 'Nice place you have here.', 'Nothing, thanks!');
            yield P('Nothing, thanks!'); return;
        }
        switch (this.map) {
            case MAP.GOT_MAP: case MAP.SCOUTED_AREA: {
                yield P('Hello Tenzing!'); yield N('Hello again traveller. What can I do for you?');
                if (this.total(p, DP_OBJ.SECRET_MAP) === 0) {
                    yield P("I've lost the secret way map."); yield N("Never mind. I'll quickly draw you another one.");
                    this.mes(p, 'Tenzing has given you a map of the secret way!'); this.give(p, DP_OBJ.SECRET_MAP);
                    yield B('Tenzing has given you a map of the secret way!'); return;
                }
                const c = yield C("I'm lost!", 'Nothing, thanks.');
                if (c === 1) {
                    yield P("I'm lost!"); yield N('To get back to Burthorpe follow the path going east.');
                    if (this.map === MAP.GOT_MAP) yield N('I thought you were going to investigate the secret way to Death Plateau? Use the back door to my hut, hop over the stile and follow that path.');
                    yield P('Oh yes, of course! Thanks!');
                } else { yield P('Nothing, thanks.'); yield N('Go in peace traveller.'); }
                return;
            }
            case MAP.GIVEN_SUPPLIES:
                yield P('Hello!'); yield N('Hello traveller. Thanks again for the food and boots.');
                yield* this.secretway(p); return;
            case MAP.GIVEN_CERT: {
                yield P('Hello!'); yield N('Have you brought me the items I asked for?');
                if (this.total(p, DP_OBJ.CLIMBING_BOOTS) === 0 && this.total(p, DP_OBJ.SPIKED_BOOTS) === 0) {
                    yield P("I've lost the climbing boots."); yield N('These are expensive, do not lose another pair!');
                    this.give(p, DP_OBJ.CLIMBING_BOOTS); this.mes(p, 'Tenzing has given you some climbing boots.');
                    yield B('Tenzing has given you some climbing boots.'); return;
                }
                let missing = '';
                if (this.total(p, DP_OBJ.SPIKED_BOOTS) === 0) missing += ' Spiked boots.';
                if (this.total(p, DP_OBJ.BREAD) < 10) missing += ' Ten loaves of bread.';
                if (this.total(p, DP_OBJ.TROUT) < 10) missing += ' Ten cooked trout.';
                if (!missing) {
                    this.mes(p, 'You give Tenzing the Spiked boots.'); this.mes(p, 'You give Tenzing the loaves of bread and the cooked trout.');
                    this.map = MAP.GIVEN_SUPPLIES;
                    this.del(p, DP_OBJ.TROUT, 10); this.del(p, DP_OBJ.BREAD, 10); this.del(p, DP_OBJ.SPIKED_BOOTS, 1);
                    yield B('You give Tenzing the Spiked boots.'); yield B('You give Tenzing the loaves of bread and the cooked trout.');
                    yield N("Thank you very much traveller. I'm now ready for the winter!");
                    yield* this.secretway(p); return;
                }
                yield P(`I don't have the:${missing}`); return;
            }
            case MAP.SPOKEN_TENZING: case MAP.SPOKEN_SMITHY: case MAP.GOT_ENTRANCECERT:
                yield P('Hello!'); yield N('Has Dunstan added spikes to my climbing boots yet?'); yield P('No, not yet.');
                yield N('Well, when he has, bring the boots to me with ten loaves of bread and ten cooked trout. I have to prepare for the winter, after all.');
                return;
            case MAP.SPOKEN_SABA: {
                yield P('Hello!'); yield N('Hello. How can I help?');
                yield P("I'm helping the Imperial Guard. They need to find a way to sneak up Death Plateau to destroy the troll camp! Saba seemed to think you'd be able to help.");
                yield N('Ah...Saba is still alive and kicking?');
                const c = yield C("OK, I'll get those for you.", "I'll find the secret way for myself.");
                if (c === 1) { this.map = MAP.SPOKEN_TENZING; this.give(p, DP_OBJ.CLIMBING_BOOTS); yield P("OK, I'll get those for you."); yield N('Thank you traveller!'); yield B('Tenzing has given you his climbing boots.'); }
                else { yield P("I'll find the secret way for myself."); yield N('Hmph.'); }
                return;
            }
        }
        // map 0: the switch has no case -> NO dialog at all
    }
    private *secretway(p: CoopPlayer): Script {
        yield P('You said you would show me the secret way to Death Plateau?');
        yield N('Yes, of course! I drew up a map in case I ever needed to use it again.');
        this.map = MAP.GOT_MAP; this.mes(p, 'Tenzing has given you a map of the secret way!'); this.give(p, DP_OBJ.SECRET_MAP);
        yield B('Tenzing has given you a map of the secret way!');
        yield N("I don't think the Trolls have found the secret way yet, if they had I would've been attacked by now.");
        yield P("OK thanks but I think I'd better check the path. I don't want to send the Imperial Guards to their death!");
        yield N('You are wise for one so young.');
    }

    // ---- [opnpc1,death_smithy] death_smithy.rs2 (troll quest not started) ----
    *dunstan(p: CoopPlayer): Script {
        if (this.map === MAP.SPOKEN_TENZING) {
            yield N('Hi! How can I help?');
            yield P('Tenzing has asked me to bring you his climbing boots, he needs to have spikes put on them.');
            yield N('Tell you what, I\'ll make them for you on one condition.');
            this.map = MAP.SPOKEN_SMITHY;
            yield N("My son has just turned 16 and I'd very much like him to join the Imperial Guard. The Prince's elite forces are invite only so it's very unlikely he'll get in. If you can arrange that you have a deal!");
            yield N("Excellent! You'll need to bring an Iron bar for the spikes!");
            return;
        }
        yield P('Hi!');
        if (this.map === MAP.GIVEN_CERT) { yield N('Hi!'); yield* this.bargain(p); return; }
        if (this.map === MAP.GOT_ENTRANCECERT) {
            yield N('Have you managed to get my son signed up for the Imperial Guard?');
            if (this.total(p, DP_OBJ.CERTIFICATE) > 0) {
                this.del(p, DP_OBJ.CERTIFICATE); this.map = MAP.GIVEN_CERT; this.mes(p, 'You give Dunstan the certificate.');
                yield B('You give Dunstan the certificate.'); yield N('Thank you!');
                yield* this.bargain(p); return;
            }
            yield P("I have but I don't have the entrance certificate on me."); yield N('Good but I need to have the certificate.');
            return;
        }
        if (this.map === MAP.SPOKEN_SMITHY) { yield N('Have you managed to get my son signed up for the Imperial Guard?'); yield P('Not yet! I just need to speak to Denulth!'); return; }
        yield N('Hi! Did you want something?');
        if (this.map >= MAP.GIVEN_SUPPLIES) yield C('Can you put some spikes on my Climbing boots?', 'How is your son getting on?', 'Is it OK if I use your anvil?', 'Nothing, thanks.');
        else yield C("I'm looking for the guard that was on last night.", 'Do you know of another way up Death Plateau?', 'Is it OK if I use your anvil?', 'Can you repair my items for me?', 'Nothing, thanks.');
        yield P('Nothing, thanks.');   // the driver's EXIT option (the other branches only loop back here)
    }
    private *bargain(p: CoopPlayer): Script {
        if (this.total(p, DP_OBJ.SPIKED_BOOTS) > 0) { yield N("I see you've got the spiked boots. Are you going to take them to the Sherpa?"); yield P('I will do shortly.'); return; }
        yield N("Now to keep my end of the bargain. Give me the boots and an iron bar and I'll put on the spikes.");
        const bar = this.total(p, DP_OBJ.IRON_BAR) > 0, boots = this.total(p, DP_OBJ.CLIMBING_BOOTS) > 0;
        if (!bar && !boots) { yield P("I don't have the iron bar or the climbing boots."); return; }
        if (!bar) { yield P("I don't have the iron bar."); return; }
        if (!boots) { yield P("I don't have the climbing boots."); return; }
        this.del(p, DP_OBJ.IRON_BAR); this.del(p, DP_OBJ.CLIMBING_BOOTS); this.give(p, DP_OBJ.SPIKED_BOOTS);
        this.mes(p, 'You give Dunstan an Iron bar and the climbing boots.'); this.mes(p, 'Dunstan has given you the Spiked boots.');
        yield B('You give Dunstan an Iron bar and the climbing boots.'); yield B('Dunstan has given you the Spiked boots.');
        yield P('Thank you!'); yield N('No problem.');
    }

    // ---- [opnpc1,death_ig_commander] death_ig_commander.rs2 (troll quest not started) ----
    *denulth(p: CoopPlayer): Script {
        yield P('Hello!');
        if (this.equip >= EQ.COMPLETE) { yield N('Welcome back friend!'); yield C('How goes your fight with the trolls?', 'I thought the White Knights controlled Asgarnia?', 'See you about Denulth!'); yield P('See you about Denulth!'); yield N('God speed friend!'); return; }
        if (this.equip === EQ.NOT_STARTED) { yield N('Hello citizen, how can I help?'); yield C('Do you have any quests for me?', 'What is this place?', "You can't, thanks."); yield P("You can't, thanks."); return; }
        if (this.equip === EQ.UNLOCKED_DOOR && this.map >= MAP.SCOUTED_AREA) { yield* this.hasMap(p); return; }
        if (this.map < MAP.GIVEN_CERT && this.map >= MAP.SPOKEN_SMITHY) { yield* this.cert(p); return; }
        yield N("Hello citizen, is there anything you'd like to know?");
        yield C('Can you remind me of the quest I am on?', 'I thought the White Knights controlled Asgarnia?', 'What is this place?', "That's all, thanks.");
        yield P("That's all, thanks."); yield N('God speed citizen.');
    }
    private *cert(p: CoopPlayer): Script {
        yield N('Hello citizen, have you found another way up Death Plateau?');
        if (this.map === MAP.GOT_ENTRANCECERT) {
            if (this.total(p, DP_OBJ.CERTIFICATE) === 0) {
                yield P("I'm working on it but I've lost the certificate!"); yield N('No problem, I have a duplicate.');
                this.give(p, DP_OBJ.CERTIFICATE); this.mes(p, 'Denulth has given you a certificate.');
                yield B('Denulth has given you a certificate.'); return;
            }
            yield P("I'm working on it, I just need to give the certificate to Dunstan."); return;
        }
        yield P('Yes there is another way up Death Plateau!'); yield N('We are saved!');
        this.map = MAP.GOT_ENTRANCECERT; this.give(p, DP_OBJ.CERTIFICATE); this.mes(p, 'Denulth has given you a certificate.');
        yield B('Denulth has given you a certificate.');
        yield N("This certificate proves that we have accepted Dunstan's son for training in the Imperial Guard!");
    }
    private *hasMap(p: CoopPlayer): Script {
        if (this.givenMap) yield N('Hello citzen, I have the map of the secret way you gave me earlier.');
        else {
            yield N('Hello citizen, have you found another way up Death Plateau?');
            yield P("Yes! There is a path that runs from a Sherpa's hut around the back of Death Plateau. The trolls haven't found it yet. The Sherpa made a map I can give you.");
            if (this.total(p, DP_OBJ.SECRET_MAP) === 0) yield P("I don't have the map on me.");
            else { this.mes(p, 'You give Denulth the map of the secret way.'); this.givenMap = true; this.del(p, DP_OBJ.SECRET_MAP); yield B('You give Denulth the map of the secret way.'); yield N('Excellent, this looks perfect. They will never see us coming.'); }
        }
        if (this.givenCombo) yield N('I have the combination to the equipment room that you recovered for me.');
        else {
            yield N('Have you managed to open the equipment room?');
            if (this.total(p, DP_OBJ.COMBINATION) === 0) yield P("I have opened the door but I don't have the combination on me.");
            else { yield P('Yes! The door is open and here is the combination.'); this.mes(p, 'You give Denulth the combination to the equipment room.'); this.givenCombo = true; this.del(p, DP_OBJ.COMBINATION); yield B('You give Denulth the combination to the equipment room.'); }
        }
        if (this.givenMap && this.givenCombo) {
            // queue(death_quest_complete): %death_equiproom = complete, steel claws, ~send_quest_complete (journal green)
            this.equip = EQ.COMPLETE; this.give(p, DP_OBJ.STEEL_CLAWS);
            this.out(p, { kind: 'setcolour', com: DP_IF.JOURNAL, colour: GREEN });
            yield N('Well done citizen! We will reward you by training you in attack!');
            yield N('You are now an honorary member of the Imperial Guard!');
        }
    }
}

function mkWorld(equip: number, map: number): DpScriptWorld {
    const w = new DpScriptWorld();
    w.equip = equip; w.map = map;
    w.registerStackable(FEATHER);
    // map placements (quest-death.ts DP_PLACES): Denulth's tent, Dunstan's smithy, Tenzing inside the hut
    w.addNpc(101, DP_NPC.DENULTH, 2896, 3528);
    w.addNpc(102, DP_NPC.TENZING, 2821, 3556);
    w.addNpc(103, DP_NPC.DUNSTAN, 2919, 3574);
    return w;
}
function mkBot(): DeathPlateauBot {
    const b = new DeathPlateauBot();
    b.quiet = true; (b as any).exitOnStuck = false; b.findLongPathFn = lp;
    b.travelEnabled = true; b.arrived = true;
    return b;
}
/** Run the REAL async driver while pumping world ticks (the driver polls on wall-clock; ticks advance between polls). */
async function drive(b: DeathPlateauBot, store: { k: Partial<DpKnowledge> }, logs: string[], timeoutMs: number): Promise<boolean> {
    let fin = false, result = false;
    const run = driveDeathPlateau(b, {
        findLongPath: lp, timeoutMs, shouldStop: () => false, log: s => logs.push(s),
        store: { load: () => ({ ...store.k }), save: k => { store.k = { ...k }; } },
    }).then(r => { result = r; }).finally(() => { fin = true; });
    for (let i = 0; i < 400_000 && !fin; i++) { await h!.tick(); await new Promise(r => setTimeout(r, 1)); }
    await run;
    return result;
}
const FULL_PACK = [
    { id: DP_OBJ.COINS, count: 4847 }, { id: DP_OBJ.COMBINATION, count: 1 }, { id: DP_OBJ.CLIMBING_BOOTS, count: 1 }, { id: DP_OBJ.IRON_BAR, count: 1 },
    ...Array.from({ length: 10 }, () => ({ id: DP_OBJ.BREAD, count: 1 })), ...Array.from({ length: 10 }, () => ({ id: DP_OBJ.TROUT, count: 1 })),
    { id: FLY_ROD, count: 1 }, { id: FEATHER, count: 38 }, { id: LOBSTER, count: 1 }, { id: LOBSTER, count: 1 },
];

describe('Death Plateau: a relaunched account (the acct15 wedge)', () => {
    test('stale store {equip 70, map 8}, real map 4, certificate lost, FULL pack -> the right next task, then the quest completes', async () => {
        const world = mkWorld(EQ.UNLOCKED_DOOR, MAP.GOT_ENTRANCECERT);
        h = new CoopHarness(world);
        const b = mkBot();
        h.add({ bot: b as any, name: 'dprl1', index: 31, x: 2893, z: 3531, inv: FULL_PACK });
        await h.start();
        expect(world.freeSlots(world.playersByIndex.get(31)!.inv)).toBe(0);
        const store = { k: { equip: 70, map: 8, purse: 0, complete: false } as Partial<DpKnowledge> };   // logs/dpquest-acct15.json
        const logs: string[] = [];
        const ok = await drive(b, store, logs, 280_000);
        const trail = logs.filter(l => /next=|fact|probe|dropping|changed nothing|⛔|COMPLETE/.test(l)).join('\n');
        expect(ok, trail).toBe(true);
        expect(world.equip).toBe(EQ.COMPLETE);
        expect(store.k.complete).toBe(true);
        // never guessed: no bump, and the certificate never fell on the floor
        expect(logs.some(l => /assuming (map|equip) >/.test(l))).toBe(false);
        expect(world.overflowDrops).toEqual([]);
        expect(logs.some(l => /dropping obj 309/.test(l))).toBe(true);
        // the FIRST talk is the stale plan's Tenzing probe; his answer ("Has Dunstan added spikes...?") lowers map to 4
        expect(world.talks[0]).toEqual({ npc: 'tenzing', equip: 70, map: 4 });
        expect(logs.some(l => /fact "Has Dunstan added spikes.*-> equip>=70 map>=4/.test(l))).toBe(true);
        // then exactly the content order: duplicate cert (Denulth) -> Dunstan (cert, spikes) -> Tenzing (supplies -> map)
        // -> scout -> Denulth (map + combination)
        expect(world.talks.map(t => `${t.npc}@${t.map}`)).toEqual(['tenzing@4', 'denulth@4', 'dunstan@4', 'tenzing@5', 'denulth@8']);
        expect(h.invCount('dprl1', DP_OBJ.STEEL_CLAWS)).toBe(1);
    }, 300_000);

    test('stale store {70, 8}, real map 5 (spiked boots + supplies held): Tenzing\'s "items" line pins 5 and the SAME talk hands over the map', async () => {
        const world = mkWorld(EQ.UNLOCKED_DOOR, MAP.GIVEN_CERT);
        h = new CoopHarness(world);
        const b = mkBot();
        const inv = FULL_PACK.filter(s => s.id !== DP_OBJ.CLIMBING_BOOTS && s.id !== DP_OBJ.IRON_BAR).concat([{ id: DP_OBJ.SPIKED_BOOTS, count: 1 }]);
        h.add({ bot: b as any, name: 'dprl3', index: 33, x: 2893, z: 3531, inv });
        await h.start();
        const store = { k: { equip: 70, map: 8, purse: 0, complete: false } as Partial<DpKnowledge> };
        const logs: string[] = [];
        const ok = await drive(b, store, logs, 280_000);
        expect(ok, logs.filter(l => /next=|fact|⛔/.test(l)).join('\n')).toBe(true);
        expect(world.equip).toBe(EQ.COMPLETE);
        expect(world.talks.map(t => `${t.npc}@${t.map}`)).toEqual(['tenzing@5', 'denulth@8']);
        expect(logs.some(l => /assuming (map|equip) >/.test(l))).toBe(false);
    }, 300_000);

    test('a probe whose answer carries NO stage evidence does not move the knowledge — the driver stops instead of looping or guessing', async () => {
        const world = mkWorld(EQ.UNLOCKED_DOOR, MAP.GOT_ENTRANCECERT);
        // an answer that matches no fact (a stand-in for any line the driver does not know)
        world.tenzingOverride = () => (function* (): Script { yield P('Hello!'); yield N('Zzzz... the sherpa is fast asleep.'); })();
        h = new CoopHarness(world);
        const b = mkBot();
        h.add({ bot: b as any, name: 'dprl2', index: 32, x: 2893, z: 3531, inv: [{ id: DP_OBJ.COINS, count: 100 }, { id: DP_OBJ.COMBINATION, count: 1 }, { id: DP_OBJ.CLIMBING_BOOTS, count: 1 }] });
        await h.start();
        const store = { k: { equip: 70, map: 8, purse: 0, complete: false } as Partial<DpKnowledge> };
        const logs: string[] = [];
        const ok = await drive(b, store, logs, 200_000);
        expect(ok).toBe(false);
        expect(store.k).toMatchObject({ equip: 70, map: 8 });            // unchanged: nothing was learned, nothing was assumed
        expect(b.k).toMatchObject({ equip: 70, map: 8 });
        expect(world.talks.length).toBe(3);                               // bounded: three tries, then a reasoned stop
        expect(world.talks.every(t => t.npc === 'tenzing')).toBe(true);
        expect(logs.filter(l => /NOT advancing any stage on no evidence/.test(l)).length).toBe(3);
        expect(logs.some(l => /made no progress 3x in a row — stopping instead of guessing/.test(l))).toBe(true);
        expect(logs.some(l => /assuming (map|equip) >/.test(l))).toBe(false);
    }, 240_000);
});
