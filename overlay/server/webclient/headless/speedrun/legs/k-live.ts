import { readFileSync } from 'fs';
import { resolve } from 'path';
import { SpeedBot } from '../core.js';

export interface LiveCreds { user: string; pass: string; server?: string }
/** Read <tree>/bots/<acct>/bot.env (BOT_USERNAME / PASSWORD / SERVER). RUN_BOTS_DIR set (run-route --live, remote-host mode):
 *  RUN_BOTS_DIR/<acct>/bot.env instead, the same file core.ts passwordOf reads, so one credential dir serves every login. */
export function readBotEnv(acct: string): LiveCreds {
    const p = process.env.RUN_BOTS_DIR ? resolve(process.env.RUN_BOTS_DIR, acct, 'bot.env') : resolve(import.meta.dir, '../../../../../bots', acct, 'bot.env');
    const kv: Record<string, string> = {};
    for (const line of readFileSync(p, 'utf8').split(/\r?\n/)) { const m = /^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/.exec(line); if (m) kv[m[1]!] = m[2]!; }
    if (!kv.PASSWORD) throw new Error(`no PASSWORD in ${p}`);
    return { user: kv.BOT_USERNAME || acct, pass: kv.PASSWORD, server: kv.SERVER };
}
let chain: Promise<unknown> = Promise.resolve();
/** SpeedBot.create with a real password. Serialised so two concurrent creates never see each other's patch. */
export async function createLive(c: LiveCreds, opts: { nav?: boolean; timeoutMs?: number } = {}): Promise<SpeedBot> {
    const run = async () => {
        // login() lives on LeanClient.prototype; shadow it with an own property on SpeedBot.prototype for one call
        const sp: any = SpeedBot.prototype, inherited = sp.login;
        sp.login = function (this: unknown, u: string, _p: string, ...rest: unknown[]) { delete sp.login; return inherited.call(this, u, c.pass, ...rest); };
        try { return await SpeedBot.create(c.user, { nav: opts.nav, timeoutMs: opts.timeoutMs ?? 90_000 }); }
        finally { if (Object.prototype.hasOwnProperty.call(sp, 'login')) delete sp.login; }
    };
    const p = chain.then(run, run); chain = p.catch(() => undefined);
    return p;
}
