/// <reference types="bun" />
// q-pirates-treasure.ts — Pirate's Treasure (2 QP), cheat-free. Lane f2p-b.
//
// Content (rev 289; quests/quest_hunt/scripts = H, areas/area_port_sarim/scripts/wydin.rs2, general_use/scripts/spade.rs2).
// %hunt: fetch_rum 1, received_key 2, read_note 3 (quest_hunt.constant).
//   1. Redbeard Frank (375; 3053,3250) "I'm in search of treasure." -> fetch_rum (H/redbeard_frank.rs2:59-67).
//   2. Wydin (557; 3014,3204) "Can I get a job here?" holding a white apron -> employed (wydin.rs2:6-44); the back-room door
//      2069 (3012,3204) wants the apron WORN while Wydin is within 10 tiles (H/food_store.rs2:1-22).
//   3. Karamja rum is untradeable and SPILLS on any teleport (skill_magic/scripts/spells/teleport.rs2:87-93 post_tele_checks)
//      and the customs officer confiscates it (customs_officer.rs2:13-53): smuggle it in Luthas' banana crate. Glory ->
//      Karamja; Zambo (568; 2925,3143) sells the rum (op3 Trade); Luthas (379; 2939,3154) "Could you offer me employment on
//      your plantation?"; crate 2072 (2943,3151): rum (needs %hunt = 1) + 10 bananas (H/banana_crate.rs2:20-62); Luthas pays
//      30 gp and ships it: %crate_rum = 2 (H/luthas.rs2:13-27).
//   4. Customs officer's ship back to Port Sarim (30 gp, no rum held: fk-lib boatKaramjaToSarim). Wydin's job now (it only
//      gates the door), apron on, back room, crate 2071 (3009,3207) -> the rum (H/food_store.rs2:24-40), out the same door.
//   5. Frank: rum -> chest key (H/redbeard_frank.rs2:25-56).
//   6. Varrock Teleport; Blue Moon Inn L1 (stairs 1725 at 3227,3393): key on Hector's chest 2079 (3218,3396) -> pirate message
//      (H/pirate_message.rs2:1-17); read it -> read_note (:19-23).
//   7. Falador Teleport; dig with a spade within 1 tile of (2999,3383) (spade.rs2:1-5); the gardener (1217, spawn 2996,3381)
//      within 10 tiles stops the dig and attacks (H/dig.rs2:1-12): kill him first. Completion: 450 gp, gold ring, emerald.
import { SpeedBot, objId } from '../../../core.js';
import { M2, M3, M4, R, locAt, opLocGo, useOnLocGo, inDialog, nav, npc, npcsOf, tele, type Tile } from '../../q-lib.js';
import { openNpc, converse, chat, go, guard, fail, mkLog, completeCheck, answerUntil, glory, packStr, setRetaliate, buyFrom, killFor, opHeld, GLORIES, type Item } from './fb-lib.js';
import { wield } from '../../run-lib.js';
import { mkLogE, climb, boatKaramjaToSarim } from './fk-lib.js';
import { isResuming, readJournal, failHook } from '../journal.js';
import { NO_GLORY } from '../noglory.js';
import { SHOP } from '../../../../capability-tables.js';

export const QUEST = { name: "Pirate's Treasure", dir: 'quest_hunt', qp: 2 };
export const REQUIREMENTS = {
    quests: [] as string[], qp: 0,
    skills: {
        magic: [37, 'Falador Teleport (Varrock Teleport 25); optional: the code walks without the runes'],
        attack: [15, 'the Falador gardener (lvl 3, 7 hp, attack 2) must die before the dig (H/dig.rs2:7-8); chaos-proven at att/str 30 hp 20 (sim default), 15/15/15 ok (fk19 285 t), 60/60/40 no faster (fk20 293 t); fresh hp 10 died (fk8)'],
        strength: [15, 'as attack'],
        hitpoints: [15, 'as attack'],
    } as Record<string, [number, string]>,
    start: { x: 3050, z: 3250, level: 0 },   // Port Sarim, by Redbeard Frank
    end: { x: 2999, z: 3383, level: 0 },     // Falador park dig spot
};
export const SUPPLY: Item[] = [
    { name: 'white_apron', n: 1 }, { name: 'banana', n: 10 }, { name: 'spade', n: 1 }, { name: 'coins', n: 60 },
    { name: 'amulet_of_glory_1', n: 1 },   // Karamja only: the way back is the customs ship (30 gp; FK_PT_RETURN=glory needs glory_2)
    { name: 'lawrune', n: 2 }, { name: 'airrune', n: 6 }, { name: 'firerune', n: 1 }, { name: 'waterrune', n: 1 },
];

const N = { frank: 375, wydin: 557, zambo: 568, luthas: 379, gardener: 1217 };
const T = { frank: { x: 3053, z: 3250 }, wydin: { x: 3014, z: 3204 }, zambo: { x: 2925, z: 3143 }, luthas: { x: 2939, z: 3154 } };
const CRATE = { id: 2072, x: 2943, z: 3151 }, GROCERY = { id: 2071, x: 3009, z: 3207 }, WDOOR = { id: 2069, x: 3012, z: 3204 };
const CHEST = { id: 2079, x: 3218, z: 3396, level: 1 }, DIG: Tile = { x: 2999, z: 3383 };
type Res = { ok: boolean; ticks: number; msg: string };
const onKaramja = (bot: SpeedBot) => bot.tile().x < 2970 && bot.tile().z < 3190 && bot.tile().z > 3000;
const runes = (bot: SpeedBot, need: Record<string, number>) => Object.entries(need).every(([k, n]) => bot.count(k) >= n);

// session 11 fix 279a (PT_RUM_RETRY): qx27p 'zambo: could not buy karamja_rum (coins 400)'. Not price/stock/dialog: an
// engine-restart drop (ws 1012) hit at (2923,3147) on the way to Zambo; after the re-login the Trade op and every SHOP-BUY
// were DISCARDED (ACK-NOACK: the client still thought the shop was open, the server had no shop) and buyFrom gave up after
// 30 t. Fix: up to 4 rounds; between rounds close the (stale) shop locally + on the server and re-open it; a round that saw
// the shop open but bought nothing waits 20 t (Zambo restocks; crowd buyers). PT_RUM_RETRY=0 reverts (one buyFrom).
// TEST: PT_RUM_TEST=1 fakes a stale shop (local mainModalId = shop) before round 1.
async function buyRum(bot: SpeedBot): Promise<void> {
    if (process.env.PT_RUM_RETRY === '0') { await buyFrom(bot, N.zambo, T.zambo, [{ name: 'karamja_rum', n: 1 }], 'zambo'); return; }
    if (process.env.PT_RUM_TEST === '1' && bot.count('karamja_rum') === 0) { bot.mainModalId = SHOP.MAIN; console.log(`[pirate] 279 TEST: stale shop modal ${bot.mainModalId}`); }
    for (let k = 1; bot.count('karamja_rum') === 0; k++) {
        try { await buyFrom(bot, N.zambo, T.zambo, [{ name: 'karamja_rum', n: 1 }], 'zambo'); }
        catch (e) {
            if (k >= 4) throw e;
            const sawShop = bot.shopIsOpen();
            console.log(`[pirate] 279 rum round ${k} failed (${(e as Error).message.slice(0, 60)}), coins ${bot.count('coins')}, shop ${sawShop}: re-open`);
            bot.closeModal(); bot.mainModalId = -1; bot.chatModalId = -1; await bot.tick(2);
            if (k >= 2) await bot.tick(20);   // restock wait
        }
    }
}
// session 11 fix 279b (PT_KARAMJA_BOAT): the qx27p retries threw 'glory: no charged amulet of glory' at Port Sarim: the kit's
// single glory_1 went on the Karamja hop, the retry's route travel rubbed the next one (glory-draynor to Frank) and the
// partner owns no other. With no charged glory, take the Port Sarim ship (Captain Tobias / seamen 376-378, 30 gp,
// sailors.rs2 -> deck (2956,3143 L1)) and its plank 2082 (2956,3144 L1) off. PT_KARAMJA_BOAT=0 reverts (glory only).
// TEST: PT_BOAT_TEST=1 takes the ship even with a charged glory.
async function toKaramja(bot: SpeedBot): Promise<void> {
    if (process.env.PT_KARAMJA_BOAT === '0' || (process.env.PT_BOAT_TEST !== '1' && (GLORIES.some(n => bot.count(n) > 0) || NO_GLORY()))) { await glory(bot, 'karamja'); return; }
    if (bot.count('coins') < 30) fail(bot, 'karamja boat: need 30 coins (no charged glory)');
    console.log(`[pirate] 279 no charged glory: Port Sarim ship to Karamja from ${JSON.stringify(bot.tile())}`);
    const sailed = () => bot.tile().x < 2970 && bot.tile().z < 3190;
    await converse(bot, [376, 377, 378], { x: 3028, z: 3218 }, [R, R, M2[0]!, R, R], () => sailed() || bot.mainModalId !== -1, [/^Yes please\.$/], 'sarim ship', { maxTicks: 60 });
    if (!(await bot.until(sailed, 20))) fail(bot, 'karamja boat: no sail');
    if (bot.chatModalId !== -1 || bot.mainModalId !== -1) { bot.closeModal(); await bot.tick(1); }
    if (bot.minusedlevel === 1) await climb(bot, { id: 2082, x: 2956, z: 3144, level: 1 }, { x: 2956, z: 3143 }, 'karamja plank');
    console.log(`[pirate] 279 landed on Karamja at ${JSON.stringify(bot.pos())}`);
}

export async function run(bot: SpeedBot, o: { log?: boolean } = {}): Promise<Res> {
    await nav();
    bot.holdDialogs = true;
    const log = mkLogE(bot, 'pirate', o.log !== false);
    { const s0 = log.split; log.split = (k: string) => { s0(k); failHook(k); }; }
    const qp0 = bot.getVarp(101), done = completeCheck(bot, qp0, QUEST.qp);
    const g = guard(bot);
    const has = (k: string) => bot.count(k) > 0;
    setRetaliate(bot, false);
    try {
        const later = () => has('karamja_rum') || has('chest_key') || has('piratemessage');
        const st = { shipped: false, wydin: false };
        // session 10: on a retry / resume, the quest JOURNAL (hunt_journal.rs2) says whether Frank's talk, Wydin's job and the
        // crate shipping are done (none of them leaves an item). All false on a fresh attempt. PT_RESUME=0 reverts.
        const R0 = { frank: false, ship: false };
        if (isResuming(bot) && process.env.PT_RESUME !== '0') {
            if (bot.chatModalId !== -1 || bot.mainModalId !== -1) { bot.closeModal(); await bot.tick(1); }
            const j = await readJournal(bot, 'hunt');
            if (j.ok) {
                const r = (re: RegExp) => re.test(j.text);
                if (r(/QUEST COMPLETE/i)) return { ok: true, ticks: bot.tickCount - log.t0, msg: 'journal: quest complete' };
                R0.frank = !r(/I can start this quest/i);
                st.wydin = r(/taken a job at Wydin's store|I should take it to Redbeard Frank|given the rum to Redbeard Frank/i);
                R0.ship = r(/speak to Luthas and have it shipped/i) && r(/filled it with bananas/i);
            }
            console.log(`[pirate] [journal] hunt: ${j.ok ? `frank ${R0.frank} wydin ${st.wydin} ship-pending ${R0.ship} | open '${j.open.slice(0, 120)}'` : 'UNREADABLE'} (${j.ticks} t)`);
        }
        // resume: the crate is full but not shipped (an attempt died between the bananas and Luthas' payment)
        if (R0.ship) {
            if (!onKaramja(bot)) { await toKaramja(bot); log.split('tele Karamja (resume)'); }
            const c0 = bot.count('coins');
            await converse(bot, N.luthas, T.luthas, [R, R, M4[1]!, R], () => bot.count('coins') >= c0 + 30 && !inDialog(bot), [/^Thank you, I'll be on my way$/], 'luthas2', { maxTicks: 30 });
            await bot.until(() => bot.chatModalId !== -1 && bot.dialogOptions().length > 0, 6);
            await answerUntil(bot, () => !inDialog(bot), [/^Thank you, I'll be on my way$/], 10);
            st.shipped = true; log.split('luthas2 (resume)');
        }
        // ---- 1-2. Frank (start), Wydin (job) ----
        if (!later() && bot.count('banana') >= 10 && !R0.ship) {
            if (!R0.frank) {
            await chat(bot, N.frank, T.frank, [R, M3[0]!, R, R, R, R, R], [/^I'm in search of treasure\.$/], 'frank1');
            log.split('frank1');
            }
            // A/B: the job only gates wydindoor (H/food_store.rs2:1-16), so take it on the way back from Karamja (the boat lands
            // ~20 tiles from Wydin) instead of walking Frank -> Wydin -> glory first (FK_PT_ORDER=old)
            if (process.env.FK_PT_ORDER === 'old') { await chat(bot, N.wydin, T.wydin, [R, M4[3]!, R, R, R, R], [/^Can I get a job here\?$/], 'wydin'); st.wydin = true; log.split('wydin'); }
            // ---- 3. Karamja: rum, Luthas, crate ----
            await toKaramja(bot); log.split('tele Karamja');
            await buyRum(bot);
            log.split('rum');
            // session 11 fix 290 (PT_LUTHAS_RECHECK): qx40p 'crate: rum 1 bananas 10' (160 t, no message): an engine-restart drop
            // (ws 1012, 38 t) hit right after Zambo, luthas1 'finished' in 8 t across the outage, so the employment bit
            // (%hunt_store_employed, luthas.rs2:33-37) was never set and every crate OPLOCU was refused (banana_crate.rs2:25-28
            // 'Why would I want to do that?'). Fix: luthas1 must show his job line (employment) or 'Have you completed your task
            // yet?' (already employed), else talk again (fb chat expect, 3 tries); and in the crate loop, 20 t with no item
            // packed and no page open -> talk to Luthas again (2x). PT_LUTHAS_RECHECK=0 reverts.
            // TEST: PT_LUTHAS_TEST=1 skips the first luthas1 talk (= the lost employment) so the crate-loop re-talk runs.
            const ptRecheck = process.env.PT_LUTHAS_RECHECK !== '0';
            const luthasExpect = /fill it up with bananas|Have you completed your task yet/i;
            const luthas1 = () => chat(bot, N.luthas, T.luthas, [R, M2[0]!, R, R, R], [/^Could you offer me employment on your plantation\?$/, ...(ptRecheck ? [/crate isn't full yet/] : [])], 'luthas1', ptRecheck ? { expect: luthasExpect } : {});
            if (process.env.PT_LUTHAS_TEST === '1') console.log('[pirate] 290 TEST: luthas1 skipped (lost employment)');
            else await luthas1();
            log.split('luthas1');
            // rum first (needs %hunt = 1), then the 10 bananas: one OPLOCU per tick, each a mesbox
            const crate = locAt(CRATE.id, CRATE.x, CRATE.z, 0);
            const t1 = bot.tickCount; let last = -100;
            let packed0 = bot.count('karamja_rum') + bot.count('banana'), progT = bot.tickCount, reTalks = 0;
            while (has('karamja_rum') || has('banana')) {
                if (bot.tickCount - t1 > (process.env.PT_CRATE_DOORS === '0' ? 80 : 160)) fail(bot, `crate: rum ${bot.count('karamja_rum')} bananas ${bot.count('banana')}`);
                // fix 290: no item packed for 20 t -> the employment is missing: talk to Luthas again
                const packedNow = bot.count('karamja_rum') + bot.count('banana');
                if (packedNow !== packed0) { packed0 = packedNow; progT = bot.tickCount; }
                if (ptRecheck && reTalks < 2 && bot.tickCount - progT >= 20 && bot.chatModalId === -1) {
                    reTalks++;
                    console.log(`[pirate] 290 crate: nothing packed for ${bot.tickCount - progT} t (rum ${bot.count('karamja_rum')} bananas ${bot.count('banana')}): Luthas again (${reTalks})`);
                    await luthas1().catch(e => console.log(`[pirate] 290 luthas re-talk: ${(e as Error).message.slice(0, 80)}`));
                    progT = bot.tickCount; last = -100;
                    continue;
                }
                // session 9 (allchaos qu14p 'crate: rum 1 bananas 10' after 80 t at (2942,3151)): every 25 t without progress open a
                // shut door around us / the crate and step next to it (PT_CRATE_DOORS=0 reverts)
                if (process.env.PT_CRATE_DOORS !== '0' && bot.tickCount - t1 >= 25 && (bot.tickCount - t1) % 25 === 0 && bot.chatModalId === -1) {
                    const lv = bot.minusedlevel;
                    for (const c0 of [bot.tile(), { x: CRATE.x, z: CRATE.z }]) for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) {
                        const cd = bot.doorTracker?.closedDoorAt(lv, c0.x + dx, c0.z + dz);
                        if (cd) { bot.opLoc(c0.x + dx, c0.z + dz, cd.locId, cd.op); bot.queueFlush(); await bot.tick(2); console.log(`[pirate] crate: opened a shut door at ${c0.x + dx},${c0.z + dz}`); }
                    }
                    await bot.walkTo(CRATE.x - 1, CRATE.z, { near: 1, maxTicks: 20, log: false } as any).catch(() => undefined);
                    console.log(`[pirate] crate: no progress ${bot.tickCount - t1} t at ${JSON.stringify(bot.tile())} rum ${bot.count('karamja_rum')} bananas ${bot.count('banana')} msgs ${JSON.stringify((bot as any).getChat?.({ limit: 2 })?.map((m: any) => m.text) ?? [])}`);
                }
                // each banana is a ~mesbox (banana_crate.rs2:40-49): resume it and send the next OPLOCU in the same tick
                if (bot.chatModalId !== -1) { bot.resumeDialogPage(); if (process.env.FK_CRATE !== 'slow' && (has('karamja_rum') || has('banana'))) { useOnLocGo(bot, has('karamja_rum') ? 'karamja_rum' : 'banana', crate); last = bot.tickCount; } bot.queueFlush(); await bot.tick(1); continue; }
                if (bot.tickCount - last >= 2) { useOnLocGo(bot, has('karamja_rum') ? 'karamja_rum' : 'banana', crate); last = bot.tickCount; }
                await bot.tick(1);
            }
            log.split('crate');
            const c0 = bot.count('coins');
            await converse(bot, N.luthas, T.luthas, [R, R, M4[1]!, R], () => bot.count('coins') >= c0 + 30 && !inDialog(bot), [/^Thank you, I'll be on my way$/], 'luthas2', { maxTicks: 30 });
            st.shipped = true;
            // payment does if_close + p_delay(3) THEN opens a multi4 (H/luthas.rs2:19-30): converse returns in the gap, so wait
            // for the options (fk5: the open multi4 swallowed the glory rub, 30 t lost + fail)
            await bot.until(() => bot.chatModalId !== -1 && bot.dialogOptions().length > 0, 6);
            await answerUntil(bot, () => !inDialog(bot), [/^Thank you, I'll be on my way$/], 10);
            log.split('luthas2');
        }
        // ---- 4. Wydin's back room: the rum ----
        if (!has('karamja_rum') && !has('chest_key') && !has('piratemessage')) {
            // on Karamja (x < 2970, z < 3190: across the sea, fk4 tried to walk) or far away: glory -> Draynor Village
            if (onKaramja(bot) && process.env.FK_PT_RETURN !== 'glory' && bot.count('coins') >= 30) { await boatKaramjaToSarim(bot); log.split('boat'); }
            if (onKaramja(bot) || Math.max(Math.abs(bot.tile().x - T.wydin.x), Math.abs(bot.tile().z - T.wydin.z)) > 100) { await glory(bot, 'draynor'); log.split('tele Draynor'); }
            if (!st.wydin) { await chat(bot, N.wydin, T.wydin, [R, M4[3]!, R, R, R, R], [/^Can I get a job here\?$/], 'wydin'); st.wydin = true; log.split('wydin'); }
            await wield(bot, ['white_apron']);
            await go(bot, { x: 3013, z: 3204 }, 1, 'to Wydin', 400);
            const door = locAt(WDOOR.id, WDOOR.x, WDOOR.z, 0);
            const t2 = bot.tickCount; let last = -100;
            while (bot.tile().x >= 3012) {
                if (bot.tickCount - t2 > 40) fail(bot, 'Wydin back room door');
                if (bot.chatModalId !== -1) { bot.resumeDialogPage(); bot.queueFlush(); }
                else if (bot.tickCount - last >= 4) { opLocGo(bot, door, 1); last = bot.tickCount; }
                await bot.tick(1);
            }
            const gc = locAt(GROCERY.id, GROCERY.x, GROCERY.z, 0);
            const t3 = bot.tickCount; last = -100;
            while (!has('karamja_rum')) {
                if (bot.tickCount - t3 > 40) fail(bot, 'grocery crate: no rum');
                if (bot.chatModalId !== -1 && bot.dialogOptions().length) { bot.clickDialogByText(/^No$/); bot.queueFlush(); }
                else if (bot.chatModalId !== -1) { bot.resumeDialogPage(); bot.queueFlush(); }
                else if (bot.tickCount - last >= 6) { opLocGo(bot, gc, 1); last = bot.tickCount; }
                await bot.tick(1);
            }
            await answerUntil(bot, () => !inDialog(bot), [/^No$/], 10);
            // out through the same door (wydindoor op1 from inside: open_and_close_door walks us through, food_store.rs2:1-16).
            // fk6: left to the planner, the door OPLOC was discarded 36x (546 t) - the planner's door handling does not know it
            const t2b = bot.tickCount; last = -100;
            while (bot.tile().x < 3012) {
                if (bot.tickCount - t2b > 40) fail(bot, `Wydin back room door (out) chat ${bot.chatModalId} main ${bot.mainModalId} opts ${JSON.stringify(bot.dialogOptions())}`);
                if (bot.chatModalId !== -1 && bot.dialogOptions().length) { bot.clickDialogByText(/^No$/); bot.queueFlush(); }
                else if (bot.chatModalId !== -1) { bot.resumeDialogPage(); bot.queueFlush(); }
                else if (bot.tickCount - last >= 4) { opLocGo(bot, door, 1); last = bot.tickCount; }
                await bot.tick(1);
            }
            log.split('rum back');
        }
        // ---- 5. Frank: rum -> key ----
        if (has('karamja_rum')) {
            await converse(bot, N.frank, T.frank, [R, R, R, R, R, R, R, R, R, M2[0]!, R], () => has('chest_key') && !inDialog(bot), [/^Ok thanks, I'll go and get it\.$/], 'frank2', { maxTicks: 30 });
            log.split('frank2');
        }
        // ---- 6. Blue Moon Inn chest -> message, read it ----
        if (has('chest_key')) {
            if (bot.stat('magic').level >= 25 && runes(bot, { lawrune: 1, airrune: 3, firerune: 1 })) { if ((await tele(bot, 'varrock_teleport')).ok) log.split('tele Varrock'); }
            // own climb (fk6: core's multi-level traveller failed at 3212,3409): stairs 1725 (3227,3393 L0, 3x2), stand west
            if (bot.minusedlevel === 0) await climb(bot, { id: 1725, x: 3227, z: 3393, level: 0 }, { x: 3226, z: 3394 }, 'Blue Moon stairs');
            await go(bot, { x: 3218, z: 3395 }, 1, 'Blue Moon L1', 200, 1);
            const ch = locAt(CHEST.id, CHEST.x, CHEST.z, 1);
            const t4 = bot.tickCount; let last = -100;
            while (!has('piratemessage')) {
                if (bot.tickCount - t4 > 40) fail(bot, 'Hector\'s chest');
                if (bot.chatModalId !== -1) { bot.resumeDialogPage(); bot.queueFlush(); }
                else if (bot.tickCount - last >= 12) { useOnLocGo(bot, 'chest_key', ch); last = bot.tickCount; }   // p_delay 1 + 7 inside
                await bot.tick(1);
            }
            log.split('message');
        }
        if (has('piratemessage')) {
            // read it (opheld1 sets read_note at once); close the scroll
            const t5 = bot.tickCount; let last = -100;
            while (bot.mainModalId === -1) {
                if (bot.tickCount - t5 > 15) break;
                if (bot.tickCount - last >= 3) { opHeld(bot, 1, 'piratemessage'); last = bot.tickCount; }
                await bot.tick(1);
            }
            if (bot.mainModalId !== -1) bot.closeModal();
        }
        // ---- 7. Falador park: gardener, dig ----
        if (bot.stat('magic').level >= 37 && runes(bot, { lawrune: 1, airrune: 3, waterrune: 1 }) && Math.max(Math.abs(bot.tile().x - DIG.x), Math.abs(bot.tile().z - DIG.z)) > 40) {
            if ((await tele(bot, 'falador_teleport')).ok) log.split('tele Falador');
        }
        await go(bot, DIG, 0, 'dig spot', 600, 0);
        const near = () => npcsOf(bot, N.gardener).filter(q => Math.max(Math.abs(q.x - bot.tile().x), Math.abs(q.z - bot.tile().z)) <= 10);
        if (near().length) { await killFor(bot, 'gardener', [N.gardener], DIG, [], () => near().length === 0, { maxTicks: 200, radius: 11 }); log.split('gardener'); await go(bot, DIG, 0, 'dig spot', 100, 0); }
        const t6 = bot.tickCount; let last = -100;
        while (!done()) {
            if (bot.tickCount - t6 > 60) fail(bot, 'dig: no treasure');
            if (bot.chatModalId !== -1) { bot.resumeDialogPage(); bot.queueFlush(); }
            else if (bot.tickCount - last >= 8) { opHeld(bot, 1, 'spade'); last = bot.tickCount; }
            await bot.tick(1);
        }
        log.split('complete');
        void st; void GLORIES; void npc; void openNpc; void objId;
        return { ok: true, ticks: bot.tickCount - log.t0, msg: JSON.stringify(log.splits) };
    } catch (e) {
        return { ok: false, ticks: bot.tickCount - log.t0, msg: `${(e as Error).message} | pack ${packStr(bot)}` };
    } finally { g.stop = true; bot.holdDialogs = false; setRetaliate(bot, true); }
}
