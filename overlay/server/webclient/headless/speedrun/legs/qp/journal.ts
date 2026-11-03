/// <reference types="bun" />
// journal.ts — read a quest's JOURNAL text (cheat-free, live-legal): the stage reader for resumes (session 10).
//
// Most quest varps are NOT transmitted (scope=perm, no transmit), so a client cannot see a stage. But clicking the quest's
// row in the quest tab (IF_BUTTON questlist:<key>) runs [if_button,questlist:<key>] (quests/*/scripts/*_journal.rs2), which
// builds the journal from the server-side varp and sends it as IF_SETTEXT questjournal_scroll:qj1..qj50 + IF_OPENMAIN
// (player/scripts/quest_journal.rs2). Finished parts are struck through (@str@); the open task is in @dbl@/@dre@ text.
// So the journal IS the stage, readable by any player. Cost: ~2-3 ticks (send, open, close).
//
// Use it between attempts (no dialog open): it opens a main modal, which closes any chat dialog.
import { SpeedBot, componentId } from '../../core.js';

export interface Journal { ok: boolean; lines: string[]; struck: boolean[]; open: string; text: string; raw: string[]; ticks: number }
const strip = (s: string) => s.replace(/@[a-z0-9]{3}@/gi, '').replace(/<[^>]*>/g, '').trim();

/** Open quest `key`'s journal (questlist key, e.g. 'desertrescue', 'crest', 'mcannon'), read it, close it. */
export async function readJournal(bot: SpeedBot, key: string, maxTicks = 8): Promise<Journal> {
    const t0 = bot.tickCount;
    let btn: number, qj1: number, modal: number;
    try { btn = componentId(`questlist:${key}`); qj1 = componentId('questjournal_scroll:qj1'); modal = componentId('questjournal_scroll'); }
    catch { return { ok: false, lines: [], struck: [], open: '', text: '', raw: [], ticks: 0 }; }
    const qj: number[] = [];
    for (let i = 1; i <= 50; i++) { try { qj.push(componentId(`questjournal_scroll:qj${i}`)); } catch { break; } }
    if (bot.chatModalId !== -1 || bot.mainModalId !== -1) { bot.closeModal(); await bot.tick(1); }
    for (const c of qj) bot.ifText.delete(c);
    bot.ifButton(btn); bot.queueFlush();
    await bot.until(() => bot.mainModalId === modal || bot.ifText.has(qj1), maxTicks);
    await bot.tick(1);   // all qj texts arrive in the same cycle as the open; one more tick for safety
    const raw = qj.map(c => bot.ifText.get(c) ?? '');
    let n = raw.length; while (n > 0 && !raw[n - 1]) n--;
    const r = raw.slice(0, n);
    const ok = bot.mainModalId === modal || r.length > 0;
    if (bot.mainModalId === modal) { bot.closeModal(); await bot.tick(1); }
    // a struck line: its leading tag run holds @str@ and does not end in an open-task colour (split_get prefixes a wrapped
    // line with the colour carried over: '@dre@@dbl@To complete...' = open; clock journal '@str@@bla@I have placed...' = struck)
    const struck = r.map(s => { const m = /^((?:@[a-z0-9]{3}@)+)/i.exec(s); return !!m && /@str@/i.test(m[1]!) && !/@(dbl|dre)@$/i.test(m[1]!); });
    const lines = r.map(strip);
    let last = -1; struck.forEach((s, i) => { if (s) last = i; });
    const open = lines.slice(last + 1).filter(Boolean).join(' ');
    return { ok, lines, struck, open, text: lines.filter(Boolean).join(' '), raw: r, ticks: bot.tickCount - t0 };
}

/** The open (unstruck) journal text of quest `key`, '' when unreadable. Logs it when `log` is given. */
export async function journalOpen(bot: SpeedBot, key: string, log?: (s: string) => void): Promise<string> {
    if (process.env.SR_JOURNAL === '0') return '';
    const j = await readJournal(bot, key);
    log?.(`[journal] ${key}: ${j.ok ? `'${j.open.slice(0, 200)}'` : 'UNREADABLE'} (${j.ticks} t)`);
    return j.ok ? j.open : '';
}

/** Pick the first stage whose regex matches the journal's whole text (struck + open); `fallback` when unreadable/no match. */
export async function journalStage<T>(bot: SpeedBot, key: string, table: Array<[RegExp, T]>, fallback: T, log?: (s: string) => void): Promise<T> {
    if (process.env.SR_JOURNAL === '0') return fallback;
    const j = await readJournal(bot, key);
    const hit = j.ok ? table.find(([re]) => re.test(j.text)) : undefined;
    log?.(`[journal] ${key}: ${j.ok ? `stage ${hit ? String(hit[1]) : `${String(fallback)} (no match)`} | open '${j.open.slice(0, 160)}'` : 'UNREADABLE'} (${j.ticks} t)`);
    return hit ? hit[1] : fallback;
}

/** Accounts whose current quest attempt is a RETRY or the first quest after a resume (route.ts sets it with LENIENT).
 *  Modules read the journal only then (a fresh attempt costs nothing). SR_RESUME_ALWAYS=1 = read it on every attempt. */
export const RESUMING = new Set<string>();
export const isResuming = (bot: SpeedBot): boolean => process.env.SR_RESUME_ALWAYS === '1' || RESUMING.has(String((bot as any).loginUser ?? '').toLowerCase());

/** TEST HOOK for resume proofs: SR_FAIL_AT=<mark> throws ONCE per process when a module reaches that mark (sp-lib split
 *  names, k-mcannon marks, ...). Off unless set. */
let failFired = false;
export function failHook(mark: string): void {
    if (!failFired && process.env.SR_FAIL_AT && process.env.SR_FAIL_AT === mark) { failFired = true; throw new Error(`SR_FAIL_AT ${mark} (test)`); }
}
