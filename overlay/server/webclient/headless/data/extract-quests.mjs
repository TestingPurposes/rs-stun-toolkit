#!/usr/bin/env bun
// QUEST / PROGRESS STATE EXTRACTOR — emits `headless/quest-state.ts`, the table + reader that answers
// "has THIS bot done quest X?" for the route-feasibility oracle, which until now could only say UNKNOWN.
//
// ⛔ WHY THIS EXISTS.
// `route-feasibility.ts` classifies 88 loc types as NEEDS_QUEST and evaluates each against
// `BotProfile.quests` — a `varp name -> stage value` map. No brain could ever fill that map, so
// every quest gate degraded to UNKNOWN ("do not depart"). A VARP decode landed in leanbot.ts today
// (getVarp/onVarp, VARP_SMALL/VARP_LARGE/VARP_SYNC), so the obvious move was "read the quest varps".
// This generator's job was to work out WHICH varps that is, and the answer is the headline finding:
//
// =================================================================================================
// ⛔ 63 OF THE 64 QUESTS HAVE A PROGRESS VARP THE SERVER NEVER SENDS. READING IT RETURNS 0 FOREVER.
// =================================================================================================
// A varp is pushed to the client only when its config declares `transmit=yes`
// (VarPlayerType.ts:98 sets it from config code 6; Player.ts:519 and Player.ts:549 loop the whole varp
// array at LOGIN and at RECONNECT and skip every `!type.transmit` entry; Player.ts:1776 does the same on
// every later write). A varp without it is server-side state the wire never mentions — so `getVarp(id)`
// returns 0 on every call, and 0 is ALSO the legitimate "not started" value. The two are
// indistinguishable, which is the "absence must never look like zero" trap (learnings/00-START-HERE.md
// rule 2) in its purest and most dangerous form.
//
// THIS ALREADY BIT US ONCE TODAY: `prayer_drain_effect` was exposed as an "is anything praying?" signal
// and read 0 while protect-from-melee was demonstrably lit and burning points. extract-capabilities.mjs now
// refuses to emit a non-transmitted varp at all, and so does this generator:
//
//     A QUEST WHOSE PROGRESS VARP DOES NOT TRANSMIT GETS **NO VARP ID IN THE OUTPUT AT ALL**.
//
// Not a flagged id, not a commented-out id — the number is simply absent from the emitted table, so
// there is no id for a reader to pass to getVarp() and the mistake cannot be made. The rows keep the
// varp NAME (it is the key `route-feasibility` looks up, and it is provenance), and carry
// `readVarpId: -1`, which the reader turns into `NOT_OBSERVABLE` — a fourth state that is NEVER
// collapsed into `NOT_STARTED`.
//
// The one exception is real and useful: `tbwt_main` (Tai Bwo Wannai Trio) IS declared transmit=yes.
// Exactly one quest in the game is varp-readable, and that is the honest limit of the varp channel.
//
// =================================================================================================
// ⛔ BUT THE STATE IS NOT UNREADABLE — IT IS ON THE WIRE AS A COLOUR, FOR ALL 64 QUESTS, AT LOGIN
// =================================================================================================
// `[proc,update_questlist]` (general/scripts/quests.rs2:254) calls `~send_quest_progress_colour` once
// per quest, and `login.rs2:96` (via `~initalltabs`) calls it on EVERY LOGIN, unconditionally, before
// any interaction. That proc is a three-way branch on the quest's own progress varp
// (general/scripts/quests.rs2:5-13):
//
//     progress = 0                  -> if_setcolour(questlist:<quest>, ^red_rgb)      NOT STARTED
//     progress >= complete_progress -> if_setcolour(questlist:<quest>, ^green_rgb)     COMPLETE
//     otherwise                     -> if_setcolour(questlist:<quest>, ^yellow_rgb)    IN PROGRESS
//
// IF_SETCOLOUR is a real server packet — ServerGameProt.ts:13 `(183, 4)`, encoded as
// `p2(component) p2(colour)` (IfSetColourEncoder.ts:9-12) with the colour pushed through
// ColorConversion.rgb24to15 (ColorConversion.ts:36-42). So the wire carries, per quest, a component id
// and one of three 15-bit colours. That is a TRANSMITTED, LOGIN-TIME, PER-QUEST TRI-STATE — precisely
// the COMPLETE / IN_PROGRESS / NOT_STARTED distinction this module needs, for every quest including the
// 63 whose varp is invisible.
//
// It is a WEAKER signal than the varp and this file never pretends otherwise: green pins the stage only
// to `>= complete`, yellow only to `1 .. complete-1`. Red is exact (0). The reader therefore models a
// quest as an INTERVAL [atLeast, atMost] and answers a gate `undefined` when the interval straddles the
// threshold — which is not a hypothetical: `^prince_saved = 100` sits BELOW `^prince_complete = 110`,
// so a yellow Prince Ali Rescue genuinely cannot decide the Al Kharid toll waiver.
//
// ⛔ leanbot.ts DOES NOT DECODE IF_SETCOLOUR TODAY (it decodes IF_SETTEXT(44) only). Wiring that is a
// one-case addition to the decode switch and is written up in the WIRING SPEC at the bottom of the
// emitted file. Nothing here edits leanbot.ts.
//
// =================================================================================================
// ⛔ ID RESOLUTION: content/pack/*.pack IS THE TRUTH, data/pack/server/*.dat MUST AGREE, *.sym ADVISORY
// =================================================================================================
// Same corrected rule as extract-item-values.mjs / extract-skilling.mjs. `data/symbols/*.sym` is a stale
// build OUTPUT: for `param.sym`, 0 of 245 ids agree and 212 diverge (`no_alchemy` is 215 in the pack and
// 115 in the sym, which is an unrelated field). The RuneScript compiler resolves ids from
// `${srcDir}/pack/*.pack` (tools/pack/Compiler.ts:181) and the engine loads `data/pack/server/*.dat`.
//
//     PRIMARY   server/content/pack/{varp,interface}.pack          the compiler's own inputs
//     REQUIRED  server/engine/data/pack/server/varp.dat            runtime varp table; MUST agree, and
//                                                                  it is where `transmit` is READ FROM
//     REQUIRED  server/engine/data/pack/server/interface.dat       runtime component debugnames; MUST agree
//     ADVISORY  server/engine/data/symbols/{varp,component,interface}.sym   counted + reported, never used
//
// The transmit flag is taken from the RUNTIME .dat (config code 6) — the byte the engine itself reads —
// and then cross-checked against every `transmit=yes` line in the content `.varp` sources. A single
// disagreement is fatal, because the whole point of this file is that one wrong transmit flag
// re-creates the prayer bug for 64 quests at once.
//
// SOURCES (every one re-cited in the emitted provenance block):
//   server/content/pack/varp.pack                        frozen varp id=name
//   server/content/pack/interface.pack                   frozen component id=name (questlist:*)
//   server/engine/data/pack/server/varp.dat              runtime varp table + the transmit flag
//   server/engine/data/pack/server/interface.dat         runtime component debugnames
//   server/content/scripts/**/*.varp                     transmit= declarations (cross-check)
//   general/scripts/quests.rs2 [proc,update_questlist]   quest -> progress varp -> complete threshold
//   general/scripts/quests.rs2 [proc,count_questpoints]  quest -> quest points (cross-check of the same)
//   general/scripts/quests.rs2 [proc,send_quest_progress_colour]  the red/yellow/green branch
//   general/configs/quest.constant                       ^<quest>_complete / ^<quest>_questpoints
//   general/configs/colour.constant                      ^red_rgb / ^yellow_rgb / ^green_rgb
//   player/interfaces/questlist.if                       per-quest display name (text=)
//   login_logout/login.rs2:96                            ~update_questlist runs on every login
//   engine/src/cache/config/VarPlayerType.ts:86-100      transmit is config code 6
//   engine/src/engine/entity/Player.ts:515-521,547-553   login/reconnect varp dump skips !transmit
//   engine/src/network/game/server/ServerGameProt.ts:13  IF_SETCOLOUR = (183, 4)
//   engine/src/util/ColorConversion.ts:36-42             rgb24to15
//   headless/data/obstacles.json                         which quest varps gate which locs
//   **/*.rs2 (excluding _test/)                          named milestone constants per progress varp
//
// Run:   bun server/webclient/headless/data/extract-quests.mjs
// Check: bun server/webclient/headless/data/extract-quests.mjs --stdout   (prints, writes nothing)
import fs from 'fs';
import path from 'path';
import { bunzip2 } from '../../src/io/BZip2.js';

const ROOT = path.resolve(import.meta.dir, '../../../..');
const CONTENT = path.join(ROOT, 'server/content');
const SCRIPTS = path.join(CONTENT, 'scripts');
const PACK = path.join(CONTENT, 'pack');
const ENGINE_PACK = path.join(ROOT, 'server/engine/data/pack');
const SYMBOLS = path.join(ROOT, 'server/engine/data/symbols');
const OUT = path.join(import.meta.dir, '..', 'quest-state.ts');
const STDOUT_ONLY = process.argv.includes('--stdout');

const die = (msg) => { console.error(`[quest-extract] FATAL: ${msg}`); process.exit(1); };
const read = (p) => { if (!fs.existsSync(p)) die(`missing source ${p}`); return fs.readFileSync(p, 'utf8'); };
const readBin = (p) => { if (!fs.existsSync(p)) die(`missing source ${p}`); return fs.readFileSync(p); };
const rs = (rel) => read(path.join(SCRIPTS, rel));
/** JSON-safe TS string literal. */
const ts = (s) => JSON.stringify(s);

function collect(dir, ext, out = []) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) collect(full, ext, out);
        else if (e.name.endsWith(ext)) out.push(full);
    }
    return out;
}

// =================================================================================================
// PACK FILES — "id=name" per line. The compiler's own frozen assignment.
// =================================================================================================
function readPack(file) {
    const byName = new Map(), byId = new Map();
    let max = -1;
    for (const line of read(path.join(PACK, file)).split('\n')) {
        const t = line.trim();
        if (!t) continue;
        const eq = t.indexOf('=');
        if (eq <= 0) continue;
        const id = Number(t.slice(0, eq));
        if (!Number.isFinite(id)) continue;
        const name = t.slice(eq + 1);
        byName.set(name, id);
        byId.set(id, name);
        if (id > max) max = id;
    }
    return { byName, byId, max };
}
const varpPack = readPack('varp.pack');
const varbitPack = readPack('varbit.pack');
const ifacePack = readPack('interface.pack');

/** ADVISORY only. Loaded so divergences can be REPORTED; never used to resolve an id. */
function loadSym(file) {
    const p = path.join(SYMBOLS, file);
    if (!fs.existsSync(p)) return null;
    const out = new Map();
    for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
        const t = line.trim();
        if (!t) continue;
        const parts = t.split('\t');
        if (parts.length < 2) continue;
        const id = Number(parts[0]);
        if (!Number.isFinite(id)) continue;
        out.set(parts[1], id);
    }
    return out;
}
function symAudit(pack, file) {
    const sym = loadSym(file);
    if (!sym) return { divergent: -1, absent: -1, agree: -1, loaded: false, size: 0 };
    let divergent = 0, absent = 0, agree = 0;
    for (const [id, name] of pack.byId) {
        const s = sym.get(name);
        if (s === undefined) absent++;
        else if (s !== id) divergent++;
        else agree++;
    }
    return { divergent, absent, agree, loaded: true, size: sym.size };
}
const varpSymAudit = symAudit(varpPack, 'varp.sym');

// =================================================================================================
// BINARY READER — mirrors engine/src/io/Packet.ts getters (gjstr is \n-terminated)
// =================================================================================================
function reader(buf) {
    let p = 0;
    return {
        get pos() { return p; },
        get avail() { return buf.length - p; },
        g1: () => buf[p++],
        g2: () => { const v = (buf[p] << 8) | buf[p + 1]; p += 2; return v; },
        gbool: () => buf[p++] === 1,
        gjstr: () => { let s = ''; let b; while (p < buf.length && (b = buf[p++]) !== 10) s += String.fromCharCode(b); return s; },
        seek: (v) => { p = v; },
        g3: () => { const v = (buf[p] << 16) | (buf[p + 1] << 8) | buf[p + 2]; p += 3; return v; },
        raw: buf,
    };
}

/** The client config archive is a jagfile (io/Jagfile.ts). Header: g3 unpacked, g3 packed; equal means
 *  the ARCHIVE is uncompressed and each member is individually bzip2'd. (Same helper as
 *  extract-item-values.mjs, which needs the client half of the obj table for the same reason.) */
function readJagMember(file, member) {
    const buf = readBin(file);
    const head = reader(buf);
    const unpackedSize = head.g3();
    const packedSize = head.g3();
    const compressWhole = unpackedSize !== packedSize;
    const data = compressWhole ? Buffer.from(bunzip2(buf.subarray(6))) : buf;
    const r = reader(data);
    r.seek(compressWhole ? 0 : 6);
    const fileCount = r.g2();
    const entries = [];
    let pos = r.pos + fileCount * 10;
    for (let i = 0; i < fileCount; i++) {
        const hash = data.readInt32BE(r.pos); r.seek(r.pos + 4);
        const unpacked = r.g3(), packed = r.g3();
        entries.push({ hash, unpacked, packed, pos });
        pos += packed;
    }
    let want = 0;
    const upper = member.toUpperCase();
    for (let i = 0; i < upper.length; i++) want = (want * 61 + upper.charCodeAt(i) - 32) | 0;
    const e = entries.find(x => x.hash === want);
    if (!e) die(`jagfile ${file} has no member '${member}'`);
    let out = data.subarray(e.pos, e.pos + e.packed);
    if (!compressWhole) out = Buffer.from(bunzip2(out));
    if (out.length !== e.unpacked) die(`jagfile member '${member}' unpacked to ${out.length}, header says ${e.unpacked}`);
    return out;
}

// =================================================================================================
// RUNTIME VARP TABLE — verbatim from VarPlayerType.decode() (VarPlayerType.ts:89-107)
// =================================================================================================
// Only the SERVER half is read: `transmit` (code 6) and `scope` (code 1) are server-side fields and the
// client jagfile half carries nothing this table wants. An unrecognised code is FATAL — a code whose
// payload width we guessed wrong would desync the cursor and silently mislabel every later varp's
// transmit flag, which is the exact failure this generator exists to prevent.
function decodeVarpTable() {
    const rd = reader(readBin(path.join(ENGINE_PACK, 'server/varp.dat')));
    const count = rd.g2();
    const out = [];
    for (let id = 0; id < count; id++) {
        const rec = { id, scope: 0, transmit: false, protect: true, clientcode: 0, debugname: null };
        for (;;) {
            if (rd.avail <= 0) break;
            const code = rd.g1();
            if (code === 0) break;
            if (code === 1) rec.scope = rd.g1();
            else if (code === 2) rd.g1();                    // type (ScriptVarType)
            else if (code === 4) rec.protect = false;
            else if (code === 5) rec.clientcode = rd.g2();
            else if (code === 6) rec.transmit = true;
            else if (code === 250) rec.debugname = rd.gjstr();
            else die(`varp id=${id}: unrecognized config code ${code} at byte ${rd.pos} — the packed ` +
                `data is out of sync with VarPlayerType.decode(). Repack before regenerating.`);
        }
        out.push(rec);
    }
    if (rd.avail !== 0) die(`varp.dat has ${rd.avail} trailing bytes after ${count} records — decode desync`);
    return out;
}
const runtimeVarps = decodeVarpTable();
const VARP_COUNT = runtimeVarps.length;

// ---- REQUIRED cross-check: varp.pack id=name MUST equal the runtime table's debugname --------------
if (varpPack.max !== VARP_COUNT - 1) {
    die(`varp.pack's highest id is ${varpPack.max} but the runtime varp.dat holds ${VARP_COUNT} records ` +
        `(expected max id ${VARP_COUNT - 1}). Repack before regenerating.`);
}
{
    const bad = [];
    for (let id = 0; id < VARP_COUNT; id++) {
        const packName = varpPack.byId.get(id) ?? null;
        const runtimeName = runtimeVarps[id].debugname ?? null;
        if (packName !== runtimeName) bad.push(`id ${id}: pack=${packName} runtime=${runtimeName}`);
    }
    if (bad.length) {
        for (const b of bad.slice(0, 10)) console.error(`  ${b}`);
        die(`${bad.length} varp ids DISAGREE between server/content/pack/varp.pack and the runtime ` +
            `server/engine/data/pack/server/varp.dat. Repack before regenerating.`);
    }
}
const varpByName = new Map(runtimeVarps.filter(v => v.debugname).map(v => [v.debugname, v]));

// ---- REQUIRED cross-check: the .varp SOURCES' transmit= lines must match the runtime flags ---------
// The runtime .dat is the authority (it is the byte the engine reads). The sources are checked against
// it so that a content edit that is packed but not rebuilt — or a stale pack — is caught here rather
// than by a bot silently reading 0 for a quest it has finished.
function loadSourceTransmit() {
    const flags = new Map();
    for (const file of collect(SCRIPTS, '.varp')) {
        let cur = null;
        for (const raw of read(file).split('\n')) {
            const line = raw.trim();
            const sec = /^\[(\w+)\]$/.exec(line);
            if (sec) { cur = sec[1]; if (!flags.has(cur)) flags.set(cur, false); continue; }
            if (cur && /^transmit\s*=\s*yes$/.test(line)) flags.set(cur, true);
        }
    }
    return flags;
}
const sourceTransmit = loadSourceTransmit();
{
    const bad = [];
    for (const [name, declared] of sourceTransmit) {
        const rt = varpByName.get(name);
        if (!rt) continue;                          // declared in content but not in the packed table
        if (rt.transmit !== declared) bad.push(`${name}: source=${declared} runtime=${rt.transmit}`);
    }
    if (bad.length) {
        for (const b of bad.slice(0, 10)) console.error(`  ${b}`);
        die(`${bad.length} varps disagree on transmit between the content .varp sources and the runtime ` +
            `varp.dat. A wrong transmit flag makes a client read 0 forever for state that is true ` +
            `server-side. Repack before regenerating.`);
    }
}
const TRANSMITTED_VARPS = runtimeVarps.filter(v => v.transmit).length;

// =================================================================================================
// RUNTIME VARBIT TABLE — VarBitType.decode() (VarBitType.ts:71-81)
// =================================================================================================
// ⛔ A QUEST'S "%progress" IS NOT ALWAYS A VARP. `%horrorquest` (Horror from the Deep) is a VARBIT —
// bits 0..10 of the varp `deephorror` — and RuneScript writes `%name` for both, so nothing in the
// script text distinguishes them. Resolving `%horrorquest` against varp.pack alone does not merely miss
// the quest: it would have resolved to nothing at all here (fatal, correctly), but a laxer generator
// would have silently matched a same-named varp and read an unrelated field.
//
// A varbit rides its BASE varp on the wire: Player.setVarBit (Player.ts:1793-1809) writes through
// setVar(basevar, ...), which transmits iff the BASE varp does. So a varbit is readable exactly when its
// basevar is transmit=yes, and its value is `(getVarp(basevar) >> startbit) & mask`.
// ⛔ A VARBIT'S FIELDS LIVE IN **TWO** FILES, LIKE AN OBJ'S. tools/pack/config/VarbitConfig.ts:64-70
// writes `basevar/startbit/endbit` (code 1) to the CLIENT half only and `debugname` (250) to the SERVER
// half only; VarBitType.load (VarBitType.ts:15-21) reads both and decodes them into the same object.
// Reading only `server/varbit.dat` yields every varbit with `basevar = -1`.
function decodeVarbitHalf(rd, count, label) {
    const out = [];
    for (let id = 0; id < count; id++) {
        const rec = { id, basevar: -1, startbit: -1, endbit: -1, debugname: null };
        for (;;) {
            if (rd.avail <= 0) break;
            const code = rd.g1();
            if (code === 0) break;
            if (code === 1) { rec.basevar = rd.g2(); rec.startbit = rd.g1(); rec.endbit = rd.g1(); }
            else if (code === 250) rec.debugname = rd.gjstr();
            else die(`${label} varbit id=${id}: unrecognized config code ${code} at byte ${rd.pos}`);
        }
        out.push(rec);
    }
    if (rd.avail !== 0) die(`${label} varbit table has ${rd.avail} trailing bytes after ${count} records — decode desync`);
    return out;
}
function decodeVarbitTable() {
    const srd = reader(readBin(path.join(ENGINE_PACK, 'server/varbit.dat')));
    const count = srd.g2();
    const server = decodeVarbitHalf(srd, count, 'server');
    const crd = reader(readJagMember(path.join(ENGINE_PACK, 'client/config'), 'varbit.dat'));
    const clientCount = crd.g2();
    if (clientCount !== count) {
        die(`record-count disagreement: server varbit.dat says ${count}, client config/varbit.dat says ` +
            `${clientCount}. The two halves are from different packer runs — repack before regenerating.`);
    }
    const client = decodeVarbitHalf(crd, clientCount, 'client');
    return server.map((s, i) => ({ ...s, basevar: client[i].basevar, startbit: client[i].startbit, endbit: client[i].endbit }));
}
const runtimeVarbits = decodeVarbitTable();
if (varbitPack.max !== runtimeVarbits.length - 1) {
    die(`varbit.pack's highest id is ${varbitPack.max} but the runtime varbit.dat holds ${runtimeVarbits.length} records. Repack before regenerating.`);
}
{
    const bad = [];
    for (let id = 0; id < runtimeVarbits.length; id++) {
        const packName = varbitPack.byId.get(id) ?? null;
        const runtimeName = runtimeVarbits[id].debugname ?? null;
        if (packName !== runtimeName) bad.push(`id ${id}: pack=${packName} runtime=${runtimeName}`);
    }
    if (bad.length) {
        for (const b of bad.slice(0, 10)) console.error(`  ${b}`);
        die(`${bad.length} varbit ids DISAGREE between varbit.pack and the runtime varbit.dat. Repack before regenerating.`);
    }
}
const varbitByName = new Map(runtimeVarbits.filter(v => v.debugname).map(v => [v.debugname, v]));

/**
 * Resolve a `%symbol` to { kind, base varp record, shift, mask }. `mask === -1` means "the whole varp",
 * which is how a plain varp is represented so the reader has exactly one code path.
 */
function resolveSymbol(sym) {
    const v = varpByName.get(sym);
    if (v) return { kind: 'varp', base: v, shift: 0, mask: -1, varbit: null };
    const b = varbitByName.get(sym);
    if (b) {
        const base = runtimeVarps[b.basevar];
        if (!base) die(`varbit '${sym}' names basevar ${b.basevar}, which is not in the varp table`);
        const width = b.endbit - b.startbit + 1;
        if (width < 1 || width > 31) die(`varbit '${sym}' has an implausible width ${width} (bits ${b.startbit}..${b.endbit})`);
        return { kind: 'varbit', base, shift: b.startbit, mask: (1 << width) - 1, varbit: b };
    }
    return null;
}

// =================================================================================================
// RUNTIME COMPONENT NAMES — Component.decodeExtra() (Component.ts:241-253)
// =================================================================================================
function decodeComponentNames() {
    const rd = reader(readBin(path.join(ENGINE_PACK, 'server/interface.dat')));
    rd.g2();                                        // count (the engine ignores it and reads to EOF)
    const byName = new Map();
    while (rd.avail > 0) {
        const id = rd.g2();
        const debugname = rd.gjstr();
        rd.gbool();                                 // overlay
        byName.set(debugname, id);
    }
    return byName;
}
const runtimeComponents = decodeComponentNames();

// =================================================================================================
// CONSTANTS — every `^name = int` in the content tree
// =================================================================================================
function loadConstants() {
    const out = new Map();
    const conflicts = [];
    for (const file of collect(SCRIPTS, '.constant')) {
        for (const m of read(file).matchAll(/^\^([a-z_0-9]+)\s*=\s*(-?\d+)\s*$/gm)) {
            const name = m[1], value = +m[2];
            if (out.has(name) && out.get(name) !== value) conflicts.push(`${name}: ${out.get(name)} vs ${value}`);
            out.set(name, value);
        }
    }
    if (conflicts.length) die(`constant redefined with a different value: ${conflicts.slice(0, 5).join('; ')}`);
    return out;
}
const constants = loadConstants();
const konst = (name) => {
    if (!constants.has(name)) die(`constant ^${name} not found in any *.constant`);
    return constants.get(name);
};

// =================================================================================================
// THE QUEST TABLE ITSELF — [proc,update_questlist], general/scripts/quests.rs2:254
// =================================================================================================
// This proc is the game's OWN quest list: one `~send_quest_progress_colour(questlist:<key>, <progress>,
// <complete>)` per quest, in journal order. It is authoritative in a way nothing else is — it is what
// decides the colour the player sees, and it is the only place that states, for every quest at once,
// which varp holds the progress and which constant means "done".
//
// Four shapes appear and all four are handled explicitly rather than skipped:
//   %varp, ^const                      the norm
//   ~proc, ^const                      itexam / cog compute progress in a proc: NO progress varp exists
//   1, ^const                          upass' `started` branch: a literal, not a varp
//   %varp, sub(pow(2, ^const), 1)      elemental workshop stores a BITMASK; complete = all bits set
//
// Two quests emit the call TWICE inside an if/else (shield of arrav picks phoenixgang vs blackarmgang;
// underground pass picks a literal 1 vs %upass). The ELSE branch is the general case, so the LAST
// occurrence wins and the alternates are recorded in `note` rather than dropped.
function parseUpdateQuestlist() {
    const src = rs('general/scripts/quests.rs2');
    const start = src.indexOf('[proc,update_questlist]');
    if (start < 0) die('[proc,update_questlist] not found in general/scripts/quests.rs2');
    const after = src.indexOf('\n[', start + 1);
    const body = src.slice(start, after < 0 ? src.length : after);
    const order = [];
    const byKey = new Map();
    const re = /~send_quest_progress_colour\(questlist:(\w+),\s*([^,]+?),\s*(.+?)\);/g;
    for (const m of body.matchAll(re)) {
        const key = m[1], progressExpr = m[2].trim(), completeExpr = m[3].trim();

        let varp = null, progressNote = null;
        if (/^%(\w+)$/.test(progressExpr)) varp = /^%(\w+)$/.exec(progressExpr)[1];
        else if (/^~\w+$/.test(progressExpr)) progressNote = `progress is computed by ${progressExpr} — this quest has no single progress varp`;
        else if (/^\d+$/.test(progressExpr)) progressNote = `branch passes the literal ${progressExpr}`;
        else die(`update_questlist: unparsed progress expression for questlist:${key}: ${progressExpr}`);

        let complete, completeName;
        let mm;
        if ((mm = /^\^(\w+)$/.exec(completeExpr))) { completeName = mm[1]; complete = konst(mm[1]); }
        else if ((mm = /^sub\(pow\(2,\s*\^(\w+)\),\s*1\)$/.exec(completeExpr))) {
            completeName = mm[1];
            complete = Math.pow(2, konst(mm[1])) - 1;       // bitmask quest: complete = every bit set
        } else die(`update_questlist: unparsed complete expression for questlist:${key}: ${completeExpr}`);

        const rec = { key, varp, complete, completeName, progressExpr, completeExpr, progressNote, alternates: [] };
        if (byKey.has(key)) {
            const prev = byKey.get(key);
            rec.alternates = [...prev.alternates, `${prev.progressExpr} vs ${prev.completeExpr}`];
        } else order.push(key);
        byKey.set(key, rec);
    }
    if (!order.length) die('update_questlist parsed 0 quests — the proc shape changed');
    return order.map(k => byKey.get(k));
}
const questRows = parseUpdateQuestlist();

// ---- [proc,count_questpoints] — the SAME quest->varp->complete pairing, plus the point award --------
// Parsed independently and used two ways: it supplies each quest's questpoints, and its (varp, complete)
// pairs are diffed against update_questlist's. A quest whose two tables disagree is reported, not hidden.
// FIVE condition shapes appear and all five are parsed, because four of them are the ones that make a
// quest silently look like it awards 0 points if you only handle the first:
//   if (%runemysteries = ^runemysteries_complete)                          the norm
//   if (%itgronigen >= ^itgronigen_complete) { // comment                  `>=`, AND a trailing comment
//   if (%blackarmgang = ^bag_complete | %phoenixgang = ^pg_complete)       shield of arrav: EITHER gang
//   if (~get_cog_progress = ^quest_cog_complete)                           a proc, not a varp
//   if (testbit(%elemental_workshop_bits, ^ew_complete) = ^true)           a BIT, not a value
// A row is matched to a quest by its progress symbol OR by its complete-constant name, because the two
// procs do not always name the same variable: the journal colours Digsite from `~itexam_progress` while
// the point award tests `%itexamlevel` — but both compare against `^itexam_complete`.
function parseCountQuestpoints() {
    const src = rs('general/scripts/quests.rs2');
    const start = src.indexOf('[proc,count_questpoints]');
    if (start < 0) die('[proc,count_questpoints] not found');
    const after = src.indexOf('\n[', start + 1);
    const body = src.slice(start, after < 0 ? src.length : after);
    const out = [];
    // `.*?` (non-greedy, with backtracking) so a condition containing its own parens — testbit(...) —
    // still ends at the `)` that actually closes the `if`.
    const re = /if\s*\((.*?)\)\s*\{[^\n]*\n\s*\$questpoints\s*=\s*add\(\$questpoints,\s*\^(\w+)\)/g;
    for (const m of body.matchAll(re)) {
        const cond = m[1];
        const terms = [];
        for (const t of cond.matchAll(/testbit\(%(\w+),\s*\^(\w+)\)\s*=\s*\^true/g)) terms.push({ symbol: t[1], op: 'testbit', constant: t[2] });
        for (const t of cond.matchAll(/([%~])(\w+)\s*(>=|<=|=|>|<|!)\s*\^(\w+)/g)) terms.push({ symbol: t[2], op: t[3], constant: t[4] });
        if (!terms.length) die(`count_questpoints: unparsed award condition "${cond.trim()}"`);
        const isBit = terms.some(t => t.op === 'testbit');
        out.push({
            symbols: terms.map(t => t.symbol),
            ops: terms.map(t => t.op),
            completes: terms.map(t => t.constant),
            // a testbit constant is a BIT INDEX, not a stage value — do not present it as a threshold
            complete: isBit ? null : konst(terms[0].constant),
            completeName: terms[0].constant,
            points: konst(m[2]),
            pointsName: m[2],
        });
    }
    if (!out.length) die('count_questpoints parsed 0 quests — the proc shape changed');
    return out;
}
const questPointRows = parseCountQuestpoints();
/** Look a quest's point award up by its progress symbol first, then by its complete-constant name. */
function pointsFor(symbol, completeName) {
    if (symbol) { const r = questPointRows.find(x => x.symbols.includes(symbol)); if (r) return r; }
    return questPointRows.find(x => x.completes.includes(completeName));
}

// =================================================================================================
// DISPLAY NAMES — player/interfaces/questlist.if `text=`
// =================================================================================================
function parseQuestlistInterface() {
    const src = rs('player/interfaces/questlist.if');
    const out = new Map();
    let cur = null;
    for (const raw of src.split('\n')) {
        const line = raw.trim();
        const sec = /^\[([\w:]+)\]$/.exec(line);
        if (sec) { cur = sec[1]; continue; }
        if (!cur) continue;
        const t = /^text=(.*)$/.exec(line);
        if (t && !out.has(cur)) out.set(cur, t[1].trim());
    }
    return out;
}
const questlistText = parseQuestlistInterface();

// =================================================================================================
// MILESTONES — the named stage constants each progress varp is actually compared or assigned against
// =================================================================================================
// Not guessed from a name prefix. Every `.rs2` outside `_test/` is split into its `[trigger,subject]`
// blocks, and for a progress varp `%V` we collect (a) every `%V <op> ^const` comparison/assignment and
// (b) every `case ^const` inside a block that contains `switch_int(%V)`. That is evidence: a constant is
// a milestone of V because content compares V to it, not because it starts with the same letters.
function loadScriptBlocks() {
    const blocks = [];
    for (const file of collect(SCRIPTS, '.rs2')) {
        const rel = path.relative(SCRIPTS, file).replace(/\\/g, '/');
        if (rel.startsWith('_test/')) continue;     // cheat/debug harnesses are not content
        const src = read(file);
        for (const part of src.split(/^(?=\[)/m)) {
            if (part.trim()) blocks.push(part);
        }
    }
    return blocks;
}
const scriptBlocks = loadScriptBlocks();

/**
 * ⛔ A `switch_int(%V)`'s cases must be read from ITS OWN BRACES, not from the whole script block.
 * `quests/quest_upass/**` switches on `%upass` and on `%regicide_quest` inside the SAME block, so a
 * block-wide `case ^x` sweep gave Underground Pass four Regicide milestones (`regicide_killed_tyras`
 * at 12, past its own complete of 10). Brace-matching from the switch's `{` fixes it exactly.
 */
function switchCases(body, from) {
    const open = body.indexOf('{', from);
    if (open < 0) return [];
    let depth = 0;
    let i = open;
    for (; i < body.length; i++) {
        if (body[i] === '{') depth++;
        else if (body[i] === '}') { depth--; if (depth === 0) { i++; break; } }
    }
    return [...body.slice(open, i).matchAll(/case\s+\^(\w+)/g)].map(m => m[1]);
}

function milestonesFor(varp) {
    if (!varp) return [];
    const esc = varp.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const cmp = new RegExp(`%${esc}\\s*(?:>=|<=|!=|=|!|>|<)\\s*\\^(\\w+)`, 'g');
    const swi = new RegExp(`switch_int\\(%${esc}\\)`, 'g');
    const names = new Set();
    for (const b of scriptBlocks) {
        if (!b.includes(`%${varp}`)) continue;
        for (const m of b.matchAll(cmp)) names.add(m[1]);
        for (const m of b.matchAll(swi)) for (const c of switchCases(b, m.index + m[0].length)) names.add(c);
    }
    const out = [];
    for (const n of names) {
        if (!constants.has(n)) continue;            // a `case ^x` from an unrelated switch in the block
        out.push({ name: n, value: constants.get(n) });
    }
    out.sort((a, b) => a.value - b.value || (a.name < b.name ? -1 : 1));
    return out;
}

// =================================================================================================
// AUX VARPS — the other varps a quest's own config dir declares
// =================================================================================================
// `route-feasibility` keys gates by VARP NAME, and 15 of the 43 gating varps are NOT a quest's progress
// varp — they are per-quest sub-state (`dragon_oracle`, `hemenster_comp_stage`, `gutanoth_gold`).
// Recording them keeps the reader honest: a gate on one of those is NOT_OBSERVABLE even when the
// journal colour tells us the quest itself is finished.
function loadQuestDirVarps() {
    const byDir = new Map();
    const dirOfVarp = new Map();
    const qroot = path.join(SCRIPTS, 'quests');
    for (const e of fs.readdirSync(qroot, { withFileTypes: true })) {
        if (!e.isDirectory() || !e.name.startsWith('quest_')) continue;
        const cfg = path.join(qroot, e.name, 'configs');
        if (!fs.existsSync(cfg)) continue;
        const names = [];
        for (const f of fs.readdirSync(cfg)) {
            if (!f.endsWith('.varp')) continue;
            for (const m of read(path.join(cfg, f)).matchAll(/^\[([a-z_0-9]+)\]/gm)) {
                names.push(m[1]);
                dirOfVarp.set(m[1], e.name);
            }
        }
        byDir.set(e.name, names);
    }
    return { byDir, dirOfVarp };
}
const questDirVarps = loadQuestDirVarps();

// =================================================================================================
// GATES — headless/data/obstacles.json (generated by extract-obstacles.mjs)
// =================================================================================================
const OBSTACLES = JSON.parse(read(path.join(import.meta.dir, 'obstacles.json')));
const gateVarpCounts = new Map();
const gateOpCounts = new Map();
const gateLocsByVarp = new Map();
for (const e of OBSTACLES.entries) {
    for (const o of e.ops ?? []) {
        for (const r of o.reqs ?? []) {
            if (r.kind !== 'quest' || !r.varp) continue;
            gateVarpCounts.set(r.varp, (gateVarpCounts.get(r.varp) ?? 0) + 1);
            gateOpCounts.set(r.op, (gateOpCounts.get(r.op) ?? 0) + 1);
            if (!gateLocsByVarp.has(r.varp)) gateLocsByVarp.set(r.varp, new Set());
            gateLocsByVarp.get(r.varp).add(e.internal);
        }
        for (const r of o.reqs ?? []) {
            if (!r.waivedBy?.varp) continue;
            gateVarpCounts.set(r.waivedBy.varp, (gateVarpCounts.get(r.waivedBy.varp) ?? 0) + 1);
            gateOpCounts.set(`waive:${r.waivedBy.op}`, (gateOpCounts.get(`waive:${r.waivedBy.op}`) ?? 0) + 1);
            if (!gateLocsByVarp.has(r.waivedBy.varp)) gateLocsByVarp.set(r.waivedBy.varp, new Set());
            gateLocsByVarp.get(r.waivedBy.varp).add(e.internal);
        }
    }
}
const GATING_VARPS = [...gateVarpCounts.keys()].sort();

// =================================================================================================
// COLOURS — ^red/^yellow/^green_rgb through ColorConversion.rgb24to15
// =================================================================================================
function parseColourConstant(name) {
    const src = rs('general/configs/colour.constant');
    const m = new RegExp(`^\\^${name}\\s*=\\s*(0x[0-9a-fA-F]+|\\d+)\\s*$`, 'm').exec(src);
    if (!m) die(`colour constant ^${name} not found`);
    return Number(m[1]);
}
/** engine/src/util/ColorConversion.ts:36-42 — 5 bits per channel, exactly as the wire carries it. */
const rgb24to15 = (rgb) => (((rgb >> 16 & 0xff) >> 3) << 10) + (((rgb >> 8 & 0xff) >> 3) << 5) + ((rgb & 0xff) >> 3);
const RGB = { red: parseColourConstant('red_rgb'), yellow: parseColourConstant('yellow_rgb'), green: parseColourConstant('green_rgb') };
const WIRE = { red: rgb24to15(RGB.red), yellow: rgb24to15(RGB.yellow), green: rgb24to15(RGB.green) };
if (new Set(Object.values(WIRE)).size !== 3) {
    die(`the three journal colours are not distinct after rgb24to15 (${JSON.stringify(WIRE)}) — the ` +
        `tri-state cannot be decoded from the wire`);
}
// Verify the branch order in send_quest_progress_colour is still (0 -> red, >=complete -> green, else
// yellow). If content ever reorders it, the whole colour channel inverts silently.
{
    const src = rs('general/scripts/quests.rs2');
    const start = src.indexOf('[proc,send_quest_progress_colour]');
    if (start < 0) die('[proc,send_quest_progress_colour] not found');
    const body = src.slice(start, src.indexOf('\n[', start + 1));
    const want = [
        /if\s*\(\$progress\s*=\s*0\)[\s\S]*?if_setcolour\(\$component,\s*\^red_rgb\)/,
        /else if\s*\(\$progress\s*>=\s*\$complete_progress\)[\s\S]*?if_setcolour\(\$component,\s*\^green_rgb\)/,
        /else\s*\{[\s\S]*?if_setcolour\(\$component,\s*\^yellow_rgb\)/,
    ];
    for (const w of want) if (!w.test(body)) die(`send_quest_progress_colour no longer matches the expected ` +
        `0->red / >=complete->green / else->yellow branch. The journal colour channel would be decoded ` +
        `backwards. Re-read general/scripts/quests.rs2:5-13 before regenerating.`);
}
// And that login actually runs it.
if (!/~update_questlist/.test(rs('login_logout/login.rs2'))) {
    die('login.rs2 no longer calls ~update_questlist — the journal colours would not arrive at login');
}
const IF_SETCOLOUR = { id: 160, size: 4 };   // rev 289 (was 183 @274)
{
    const prot = read(path.join(ROOT, 'server/engine/src/network/game/server/ServerGameProt.ts'));
    const m = /IF_SETCOLOUR\s*=\s*new ServerGameProt\((\d+),\s*(-?\d+)\)/.exec(prot);
    if (!m) die('IF_SETCOLOUR not found in ServerGameProt.ts');
    if (+m[1] !== IF_SETCOLOUR.id || +m[2] !== IF_SETCOLOUR.size) {
        die(`IF_SETCOLOUR moved to (${m[1]}, ${m[2]}) — update this generator`);
    }
}

// =================================================================================================
// BUILD THE ROWS
// =================================================================================================
const QP_VARP = varpByName.get('qp');
if (!QP_VARP) die('varp `qp` (quest points) not in the runtime table');
if (!QP_VARP.transmit) die('varp `qp` is no longer transmit=yes — the quest-point cross-check is dead');

const rows = [];
const warnings = [];
for (const q of questRows) {
    const componentName = `questlist:${q.key}`;
    const packId = ifacePack.byName.get(componentName);
    if (packId === undefined) die(`component '${componentName}' not in interface.pack`);
    const runtimeId = runtimeComponents.get(componentName);
    if (runtimeId === undefined) die(`component '${componentName}' has no debugname in the runtime interface.dat`);
    if (runtimeId !== packId) {
        die(`component '${componentName}' DISAGREES: interface.pack=${packId} runtime interface.dat=` +
            `${runtimeId}. An IF_SETCOLOUR decoder keyed on the wrong id would read another quest's ` +
            `state. Repack before regenerating.`);
    }

    const name = questlistText.get(q.key);
    if (!name) die(`questlist.if has no text= for [${q.key}]`);

    let transmitted = false, readVarpId = -1, scopePerm = null, kind = null, shift = 0, mask = -1, baseVarpName = null;
    if (q.varp) {
        const r = resolveSymbol(q.varp);
        if (!r) die(`progress symbol '%${q.varp}' (questlist:${q.key}) is neither a varp nor a varbit — ` +
            `it is in neither varp.pack nor varbit.pack. Repack before regenerating.`);
        kind = r.kind;
        shift = r.shift;
        mask = r.mask;
        baseVarpName = r.base.debugname;
        transmitted = r.base.transmit;
        scopePerm = r.base.scope === 1;
        // ⛔ THE REFUSAL. A non-transmitted varp's id never reaches the output.
        readVarpId = transmitted ? r.base.id : -1;
        if (!scopePerm) warnings.push(`%${q.varp} (${q.key}) rides scope=temp varp ${baseVarpName} — progress would not survive a logout`);
    }

    const pts = pointsFor(q.varp, q.completeName);
    if (pts && pts.complete !== null && pts.completes.includes(q.completeName) && pts.complete !== q.complete) {
        warnings.push(`${q.key}: update_questlist completes at ^${q.completeName}=${q.complete} but ` +
            `count_questpoints awards at ^${pts.completeName}=${pts.complete}`);
    }

    const dir = q.varp ? (questDirVarps.dirOfVarp.get(q.varp) ?? (baseVarpName ? questDirVarps.dirOfVarp.get(baseVarpName) : undefined)) : undefined;
    const auxAll = dir ? (questDirVarps.byDir.get(dir) ?? []) : [];
    const aux = auxAll.filter(n => n !== q.varp && n !== baseVarpName).map(n => {
        const v = varpByName.get(n);
        return { name: n, transmitted: v ? v.transmit : false, gates: gateVarpCounts.get(n) ?? 0 };
    }).sort((a, b) => (a.name < b.name ? -1 : 1));

    const notes = [];
    if (q.progressNote) notes.push(q.progressNote);
    for (const alt of q.alternates) notes.push(`another branch of update_questlist uses ${alt}`);
    if (/^sub\(pow/.test(q.completeExpr)) notes.push(`bitmask quest: complete = 2^^${q.completeName} - 1 = ${q.complete}`);
    if (pts && pts.complete !== null && pts.completes.includes(q.completeName) && pts.complete !== q.complete) {
        notes.push(`quest points are awarded at ^${pts.completeName}=${pts.complete}, not at ^${q.completeName}`);
    }
    if (pts && !pts.completes.includes(q.completeName)) {
        notes.push(`quest points are awarded on a different test: ${pts.symbols.map((s, i) => `${s} ${pts.ops[i]} ^${pts.completes[i]}`).join(' | ')}`);
    }

    if (kind === 'varbit') notes.push(`%${q.varp} is a VARBIT: bits ${shift}..${shift + Math.log2(mask + 1) - 1} of varp ${baseVarpName}`);

    // ⛔ AMBIGUOUS JOURNAL ROW. Two quests colour their row from a DIFFERENT variable depending on a
    // runtime condition, so the colour does not identify which variable it describes:
    //   shield of arrav  if (%phoenixgang > 0 & %blackarmgang != complete) colour(%phoenixgang) else colour(%blackarmgang)
    //   underground pass if (testbit(%ibanmulti, started) & %upass != complete) colour(1) else colour(%upass)
    // A GREEN shield of arrav can mean "%phoenixgang is finished" while %blackarmgang is 0, and a YELLOW
    // underground pass can mean "%upass is 0 but the started bit is set". Reading either as a bound on
    // the named varp is unsound in the passable direction, so the colour channel is refused for them.
    const journalAmbiguous = q.alternates.length > 0;
    if (journalAmbiguous) notes.push(`the journal colour for this row is computed from a DIFFERENT variable on one branch, so it does not pin %${q.varp} — the colour channel is refused for this quest`);

    rows.push({
        key: q.key,
        name,
        component: packId,
        varp: q.varp,
        kind,
        baseVarpName,
        shift,
        mask,
        transmitted,
        readVarpId,
        scopePerm,
        journalAmbiguous,
        complete: q.complete,
        completeName: q.completeName,
        questPoints: pts ? pts.points : 0,
        milestones: milestonesFor(q.varp),
        aux,
        gates: q.varp ? (gateVarpCounts.get(q.varp) ?? 0) : 0,
        dir: dir ?? null,
        note: notes.length ? notes.join('; ') : null,
    });
}

// ---- INVARIANT: no row may carry a readable id for a varp that does not transmit -------------------
for (const r of rows) {
    if (r.readVarpId >= 0 && !r.transmitted) die(`INVARIANT VIOLATED: ${r.key} emits readVarpId=${r.readVarpId} for a non-transmitted varp`);
    if (r.readVarpId >= 0 && runtimeVarps[r.readVarpId].debugname !== r.baseVarpName) die(`INVARIANT VIOLATED: ${r.key} readVarpId=${r.readVarpId} names ${runtimeVarps[r.readVarpId].debugname}, not ${r.baseVarpName}`);
    if (r.transmitted && r.readVarpId < 0) die(`INVARIANT VIOLATED: ${r.key} is transmitted but has no readVarpId`);
}

const QUEST_COUNT = rows.length;
const WITH_VARP = rows.filter(r => r.varp).length;
const NO_VARP = QUEST_COUNT - WITH_VARP;
const READABLE = rows.filter(r => r.readVarpId >= 0).length;
const DARK = WITH_VARP - READABLE;
const UNREADABLE = QUEST_COUNT - READABLE;
const TOTAL_QP = rows.reduce((a, r) => a + r.questPoints, 0);
const EQUALITY_AWARDS = questPointRows.filter(r => r.ops.every(o => o === '=')).length;

// every gating varp, labelled by the CHANNEL that can observe it — varp, journal colour, or nothing
const varpToQuest = new Map();
for (const r of rows) {
    if (r.varp) varpToQuest.set(r.varp, { key: r.key, kind: r.journalAmbiguous ? 'progress-ambiguous' : 'progress' });
    for (const a of r.aux) if (!varpToQuest.has(a.name)) varpToQuest.set(a.name, { key: r.key, kind: 'aux' });
}
const gatingRows = GATING_VARPS.map(v => {
    const rt = varpByName.get(v);
    const owner = varpToQuest.get(v) ?? null;
    const transmitted = rt ? rt.transmit : false;
    const kind = owner?.kind ?? (questDirVarps.dirOfVarp.has(v) ? 'unlisted-quest' : 'unknown');
    return {
        varp: v,
        transmitted,
        quest: owner?.key ?? null,
        kind,
        channel: transmitted ? 'varp' : (kind === 'progress' ? 'journal' : 'none'),
        gates: gateVarpCounts.get(v) ?? 0,
        locs: [...(gateLocsByVarp.get(v) ?? [])].sort(),
    };
});
const VARP_GATING = gatingRows.filter(g => g.channel === 'varp');
const JOURNAL_ONLY_GATING = gatingRows.filter(g => g.channel === 'journal');
const DARK_GATING = gatingRows.filter(g => g.channel === 'none');
const DARK_GATE_TESTS = DARK_GATING.reduce((a, g) => a + g.gates, 0);
const ALL_GATE_TESTS = gatingRows.reduce((a, g) => a + g.gates, 0);
const orderedOps = [...gateOpCounts.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
const LOWER_BOUND_SAFE_OPS = new Set(['>=', '>', 'waive:>=', 'waive:>']);
const LOWER_BOUND_UNSAFE = orderedOps.filter(([op]) => !LOWER_BOUND_SAFE_OPS.has(op)).reduce((a, [, n]) => a + n, 0);
const LOWER_BOUND_SAFE = orderedOps.filter(([op]) => LOWER_BOUND_SAFE_OPS.has(op)).reduce((a, [, n]) => a + n, 0);

for (const w of warnings) console.error(`[quest-extract] NOTE: ${w}`);

// =================================================================================================
// EMIT
// =================================================================================================
const L = [];
const push = (s) => L.push(s);

push(`// GENERATED by headless/data/extract-quests.mjs — DO NOT EDIT BY HAND.`);
push(`// Regenerate: bun server/webclient/headless/data/extract-quests.mjs`);
push(`//`);
push(`// QUEST / PROGRESS STATE — "has THIS bot done quest X?", the field route-feasibility could only`);
push(`// answer UNKNOWN. ${QUEST_COUNT} quests, ${WITH_VARP} of them backed by a single progress varp.`);
push(`//`);
push(`// =====================================================================================================`);
push(`// ⛔ THE HEADLINE: ${DARK} OF THE ${WITH_VARP} QUESTS WITH A PROGRESS VARIABLE HAVE ONE THE SERVER NEVER SENDS`);
push(`// =====================================================================================================`);
push(`// A varp reaches a client only if its config declares transmit=yes (VarPlayerType.ts:98, config code`);
push(`// 6). Player.ts:515-521 dumps the whole varp array at LOGIN and Player.ts:547-553 again on RECONNECT,`);
push(`// both skipping every \`!type.transmit\` entry; Player.ts:1776 skips it on each later write too. So a`);
push(`// non-transmitted varp reads 0 forever on the wire WHILE BEING TRUE SERVER-SIDE — and 0 is also the`);
push(`// real "not started" value. The two are indistinguishable.`);
push(`//`);
push(`// Of the ${VARP_COUNT} varps in the game, ${TRANSMITTED_VARPS} transmit. Exactly ${READABLE} of them is a quest progress varp:`);
for (const r of rows.filter(x => x.readVarpId >= 0)) push(`//     ${r.name} — %${r.varp} = varp ${r.readVarpId}, complete at ^${r.completeName} = ${r.complete}`);
push(`//`);
push(`// (A further ${NO_VARP} quests — ${rows.filter(r => !r.varp).map(r => r.name).join(', ')} — compute progress in a`);
push(`// proc and have no single variable to read AT ALL, so ${UNREADABLE} of ${QUEST_COUNT} rows carry no id.)`);
push(`//`);
push(`// ⛔ AND "%progress" IS NOT ALWAYS A VARP. \`%horrorquest\` is a VARBIT — bits 0..10 of the varp`);
push(`// \`deephorror\` — and RuneScript spells varps and varbits identically. A generator that resolved`);
push(`// \`%name\` against varp.pack alone would drop the quest (or, worse, match an unrelated same-named`);
push(`// varp). Rows carry \`kind\` plus \`bitShift\`/\`bitMask\`, and a varbit is readable exactly when its BASE`);
push(`// varp transmits, because setVarBit writes through setVar (Player.ts:1793-1809).`);
push(`//`);
push(`// ⛔ THIS FILE THEREFORE EMITS **NO VARP ID AT ALL** FOR THE OTHER ${UNREADABLE}. Not a flagged id, not a`);
push(`// commented-out one — the number is absent, so there is nothing for a caller to pass to getVarp() and`);
push(`// the mistake is structurally impossible. Those rows carry \`readVarpId: -1\` and the reader reports`);
push(`// NOT_OBSERVABLE, which is a FOURTH state and is NEVER collapsed into NOT_STARTED.`);
push(`//`);
push(`// This is not a theoretical hazard: \`prayer_drain_effect\` was exposed as an "is anything praying?"`);
push(`// signal earlier the same day and read 0 while protect-from-melee was demonstrably lit and burning points.`);
push(`//`);
push(`// =====================================================================================================`);
push(`// ⛔ THE STATE IS STILL READABLE — AS A COLOUR, FOR ALL ${QUEST_COUNT} QUESTS, ON EVERY LOGIN`);
push(`// =====================================================================================================`);
push(`// login.rs2 -> ~initalltabs -> ~update_questlist (general/scripts/quests.rs2:254) calls`);
push(`// ~send_quest_progress_colour once per quest, unconditionally, before any interaction. That proc`);
push(`// (quests.rs2:5-13) is a three-way branch on the quest's own progress varp:`);
push(`//`);
push(`//     progress = 0                  -> if_setcolour(questlist:<q>, ^red_rgb)     -> NOT_STARTED`);
push(`//     progress >= complete          -> if_setcolour(questlist:<q>, ^green_rgb)   -> COMPLETE`);
push(`//     otherwise                     -> if_setcolour(questlist:<q>, ^yellow_rgb)  -> IN_PROGRESS`);
push(`//`);
push(`// IF_SETCOLOUR is ServerGameProt(${IF_SETCOLOUR.id}, ${IF_SETCOLOUR.size}) encoded \`p2(component) p2(colour)\``);
push(`// (IfSetColourEncoder.ts:9-12), the colour pushed through ColorConversion.rgb24to15 (5 bits/channel):`);
push(`//     0x${RGB.red.toString(16).toUpperCase().padStart(6, '0')} red    -> ${WIRE.red}`);
push(`//     0x${RGB.yellow.toString(16).toUpperCase().padStart(6, '0')} yellow -> ${WIRE.yellow}`);
push(`//     0x${RGB.green.toString(16).toUpperCase().padStart(6, '0')} green  -> ${WIRE.green}`);
push(`//`);
push(`// The colour is a WEAKER signal than the varp and this file never pretends otherwise. Green pins the`);
push(`// stage only to \`>= complete\`; yellow only to \`1 .. complete-1\`; red alone is exact (0). So a quest is`);
push(`// modelled as the INTERVAL [atLeast, atMost] and a gate whose threshold falls INSIDE the interval is`);
push(`// answered \`undefined\`, never guessed. That case is real: ^prince_saved = ${constants.get('prince_saved') ?? '?'} is BELOW`);
push(`// ^prince_complete = ${rows.find(r => r.key === 'prince')?.complete ?? '?'}, so a YELLOW Prince Ali Rescue cannot decide the Al Kharid toll waiver.`);
push(`//`);
push(`// ⛔ leanbot.ts DOES NOT DECODE IF_SETCOLOUR YET (it decodes IF_SETTEXT(44) only). See the WIRING SPEC`);
push(`// at the bottom of this file. Until that lands, \`journal\` is always empty and every quest but`);
push(`// ${rows.filter(r => r.readVarpId >= 0).map(r => r.name).join(', ')} reports NOT_OBSERVABLE — which is the correct answer, not a bug.`);
push(`//`);
push(`// PROVENANCE (nothing below was typed in):`);
push(`//   server/content/pack/varp.pack                      frozen varp id=name (${VARP_COUNT} ids)`);
push(`//   server/content/pack/interface.pack                 frozen component id=name (questlist:*)`);
push(`//   server/engine/data/pack/server/varp.dat            runtime varp table + the transmit flag (code 6)`);
push(`//   server/engine/data/pack/server/interface.dat       runtime component debugnames`);
push(`//   server/content/scripts/**/*.varp                   transmit= declarations (cross-checked)`);
push(`//   general/scripts/quests.rs2 [proc,update_questlist] quest -> progress varp -> complete threshold`);
push(`//   general/scripts/quests.rs2 [proc,count_questpoints] quest -> quest points (independent cross-check)`);
push(`//   general/configs/quest.constant                     ^<q>_complete / ^<q>_questpoints`);
push(`//   general/configs/colour.constant                    ^red_rgb / ^yellow_rgb / ^green_rgb`);
push(`//   player/interfaces/questlist.if                     per-quest display name (text=)`);
push(`//   login_logout/login.rs2                             ~update_questlist runs on every login`);
push(`//   engine/src/cache/config/VarPlayerType.ts:86-107     transmit is config code 6`);
push(`//   engine/src/engine/entity/Player.ts:515-521,547-553  login/reconnect varp dump skips !transmit`);
push(`//   engine/src/network/game/server/ServerGameProt.ts:13 IF_SETCOLOUR = (${IF_SETCOLOUR.id}, ${IF_SETCOLOUR.size})`);
push(`//   engine/src/util/ColorConversion.ts:36-42            rgb24to15`);
push(`//   headless/data/obstacles.json                        which quest varps gate which locs`);
push(`//   **/*.rs2 (excluding _test/)                         the named milestone constants per varp`);
push(`//`);
push(`// CROSS-CHECK, at generation time:`);
push(`//   * all ${VARP_COUNT} varp ids agreed between varp.pack and the runtime server varp.dat debugname table`);
push(`//     (0 disagreements — the generator refuses to emit on even one)`);
push(`//   * every transmit= line in the content .varp sources agreed with the runtime varp.dat flag`);
push(`//   * all ${QUEST_COUNT} questlist:* component ids agreed between interface.pack and the runtime interface.dat`);
push(`//   * [proc,count_questpoints] independently re-states the quest -> varp -> complete pairing;`);
push(`//     ${rows.filter(r => r.note?.includes('quest points are awarded at')).length} quest(s) award points at a DIFFERENT value than the journal calls complete, and that`);
push(`//     is recorded in the row's \`note\` rather than reconciled away`);
push(`//   * the red/green/yellow branch order in send_quest_progress_colour was re-verified (a reorder`);
push(`//     would invert the whole colour channel silently)`);
push(`//`);
push(`// ⛔ data/symbols/varp.sym IS NOT AUTHORITATIVE AND IS NOT USED HERE. Audited only:`);
push(`//   ${varpSymAudit.agree} of ${VARP_COUNT} agree, ${varpSymAudit.divergent} diverge, ${varpSymAudit.absent} absent (sym holds ${varpSymAudit.size} entries).`);
push(`// It happens to be mostly-right for varps, which is exactly why it is dangerous to lean on: for`);
push(`// param.sym, 0 of 245 agree and 212 diverge. The compiler reads pack/*.pack (Compiler.ts:181).`);
push(``);
push(`import type { BotProfile } from './route-feasibility.js';`);
push(``);
push(`// -----------------------------------------------------------------------------------------------------`);
push(`// types`);
push(`// -----------------------------------------------------------------------------------------------------`);
push(``);
push(`/**`);
push(` * The four states. \`NOT_OBSERVABLE\` is in the SAME enum as the rest, not a separate error channel, so`);
push(` * a caller that switches on this type is forced to write the branch that says "I cannot see this".`);
push(` * Collapsing it into \`NOT_STARTED\` is the bug this whole module exists to prevent.`);
push(` */`);
push(`export type QuestStatus = 'COMPLETE' | 'IN_PROGRESS' | 'NOT_STARTED' | 'NOT_OBSERVABLE';`);
push(``);
push(`/** A named stage value the content actually compares this quest's progress varp against. */`);
push(`export interface QuestMilestone {`);
push(`    /** constant name without the caret, e.g. \`prince_saved\`. */`);
push(`    readonly name: string;`);
push(`    readonly value: number;`);
push(`}`);
push(``);
push(`/** A varp declared in the quest's own config dir that is NOT its progress varp. */`);
push(`export interface QuestAuxVarp {`);
push(`    readonly name: string;`);
push(`    readonly transmitted: boolean;`);
push(`    /** how many loc/op gates in obstacles.json test this varp. */`);
push(`    readonly gates: number;`);
push(`}`);
push(``);
push(`export interface QuestDef {`);
push(`    /** questlist component name without the \`questlist:\` prefix. The stable key. */`);
push(`    readonly key: string;`);
push(`    /** display name, from questlist.if \`text=\`. */`);
push(`    readonly name: string;`);
push(`    /** questlist:<key> component id — the IF_SETCOLOUR target that carries this quest's tri-state. */`);
push(`    readonly component: number;`);
push(`    /**`);
push(`     * Progress varp NAME, or null when the journal computes progress in a proc instead. This is the`);
push(`     * key \`BotProfile.quests\` is indexed by, which is why the NAME is always emitted even when the id`);
push(`     * is not.`);
push(`     */`);
push(`    readonly varp: string | null;`);
push(`    /**`);
push(`     * Whether \`varp\` names a VARP or a VARBIT. RuneScript writes \`%name\` for both and nothing in the`);
push(`     * script text tells them apart — \`%horrorquest\` is bits 0..10 of the varp \`deephorror\`.`);
push(`     */`);
push(`    readonly kind: 'varp' | 'varbit' | null;`);
push(`    /** does the server ever push this (for a varbit: its BASE varp) to a client? */`);
push(`    readonly transmitted: boolean;`);
push(`    /**`);
push(`     * ⛔ THE ONLY ID A READER MAY PASS TO getVarp(). \`-1\` when it does not transmit — in which case`);
push(`     * the real id is deliberately ABSENT from this file, because a non-transmitted varp reads 0`);
push(`     * forever and 0 is a plausible value. For a varbit this is the BASE varp's id.`);
push(`     */`);
push(`    readonly readVarpId: number;`);
push(`    /** varbit extraction: \`(raw >>> bitShift) & bitMask\`. \`bitMask === -1\` means "the whole varp". */`);
push(`    readonly bitShift: number;`);
push(`    readonly bitMask: number;`);
push(`    /**`);
push(`     * ⛔ This quest's journal row is coloured from a DIFFERENT variable on one branch of`);
push(`     * update_questlist, so the colour does not identify what it describes and cannot bound \`varp\`.`);
push(`     * The reader refuses the colour channel for these — see the row's \`note\`.`);
push(`     */`);
push(`    readonly journalAmbiguous: boolean;`);
push(`    /** \`^<name>_complete\` — the value at which the journal turns the quest green. */`);
push(`    readonly complete: number;`);
push(`    readonly completeName: string;`);
push(`    /** quest points awarded, from [proc,count_questpoints]. Every quest in the table awards >= 1;`);
push(`     *  they sum to ${TOTAL_QP}, which is what a fully-completed account's \`qp\` varp reads. */`);
push(`    readonly questPoints: number;`);
push(`    /** stage constants the content compares this varp against, ascending. */`);
push(`    readonly milestones: readonly QuestMilestone[];`);
push(`    /** other varps this quest's config dir declares — sub-state that gates locs but is not progress. */`);
push(`    readonly aux: readonly QuestAuxVarp[];`);
push(`    /** how many loc/op gates in obstacles.json test the PROGRESS varp. */`);
push(`    readonly gates: number;`);
push(`    /** anything surprising about this row. Read it before trusting the numbers. */`);
push(`    readonly note: string | null;`);
push(`}`);
push(``);
push(`// -----------------------------------------------------------------------------------------------------`);
push(`// the table`);
push(`// -----------------------------------------------------------------------------------------------------`);
push(``);
push(`/** Journal order — the order [proc,update_questlist] itself emits. */`);
push(`export const QUESTS: readonly QuestDef[] = [`);
for (const r of rows) {
    const ms = r.milestones.map(m => `{ name: ${ts(m.name)}, value: ${m.value} }`).join(', ');
    const ax = r.aux.map(a => `{ name: ${ts(a.name)}, transmitted: ${a.transmitted}, gates: ${a.gates} }`).join(', ');
    push(`    {`);
    push(`        key: ${ts(r.key)}, name: ${ts(r.name)}, component: ${r.component},`);
    push(`        varp: ${r.varp === null ? 'null' : ts(r.varp)}, kind: ${r.kind === null ? 'null' : ts(r.kind)}, transmitted: ${r.transmitted}, readVarpId: ${r.readVarpId}, bitShift: ${r.shift}, bitMask: ${r.mask},`);
    push(`        complete: ${r.complete}, completeName: ${ts(r.completeName)}, questPoints: ${r.questPoints}, gates: ${r.gates}, journalAmbiguous: ${r.journalAmbiguous},`);
    push(`        milestones: [${ms}],`);
    push(`        aux: [${ax}],`);
    push(`        note: ${r.note === null ? 'null' : ts(r.note)},`);
    push(`    },`);
}
push(`];`);
push(``);
push(`/** key -> def. */`);
push(`export const QUEST_BY_KEY: ReadonlyMap<string, QuestDef> = new Map(QUESTS.map(q => [q.key, q]));`);
push(`/** progress varp NAME -> def. The join key with \`route-feasibility\`, which indexes gates by varp. */`);
push(`export const QUEST_BY_VARP: ReadonlyMap<string, QuestDef> =`);
push(`    new Map(QUESTS.filter(q => q.varp !== null).map(q => [q.varp as string, q]));`);
push(``);
push(`/** Quest points. THE ONE AGGREGATE THAT TRANSMITS — varp ${QP_VARP.id}, dumped at login like any other. */`);
push(`export const QUEST_POINTS_VARP = ${QP_VARP.id};`);
push(`/** Sum of every quest's award, from [proc,count_questpoints]. */`);
push(`export const TOTAL_QUEST_POINTS = ${TOTAL_QP};`);
push(``);
push(`/**`);
push(` * ⛔ qp IS A WEAKER SIGNAL THAN IT LOOKS. ${EQUALITY_AWARDS} of the ${questPointRows.length} awards in [proc,count_questpoints] fire on`);
push(` * \`%varp = ^complete\` — EQUALITY, not \`>=\` — so \`qp === 0\` proves only that no quest sits exactly on`);
push(` * its complete value. It does NOT prove a quest is unstarted, and it specifically does NOT decide`);
push(` * the Al Kharid toll: ^prince_saved (${constants.get('prince_saved') ?? '?'}) is a real reachable stage BELOW ^prince_complete`);
push(` * (${rows.find(r => r.key === 'prince')?.complete ?? '?'}), so a bot can have the toll waived while contributing 0 quest points. Use qp as a`);
push(` * cheap sanity check, never as a gate.`);
push(` */`);
push(`export const QUEST_POINTS_EQUALITY_AWARDS = ${EQUALITY_AWARDS};`);
push(`/** Total awards in [proc,count_questpoints], one per quest that pays out. */`);
push(`export const QUEST_POINTS_AWARDS = ${questPointRows.length};`);
push(``);
push(`/** IF_SETCOLOUR — ServerGameProt.ts:13. Payload: \`p2(component) p2(colour)\`. */`);
push(`export const IF_SETCOLOUR_PROT = { id: ${IF_SETCOLOUR.id}, size: ${IF_SETCOLOUR.size} } as const;`);
push(``);
push(`/** The three 15-bit wire colours, post ColorConversion.rgb24to15. Distinct, so the tri-state decodes. */`);
push(`export const JOURNAL_COLOUR = {`);
push(`    /** ^red_rgb 0x${RGB.red.toString(16).toUpperCase().padStart(6, '0')} — progress is exactly 0. */`);
push(`    NOT_STARTED: ${WIRE.red},`);
push(`    /** ^yellow_rgb 0x${RGB.yellow.toString(16).toUpperCase().padStart(6, '0')} — 0 < progress < complete. */`);
push(`    IN_PROGRESS: ${WIRE.yellow},`);
push(`    /** ^green_rgb 0x${RGB.green.toString(16).toUpperCase().padStart(6, '0')} — progress >= complete. */`);
push(`    COMPLETE: ${WIRE.green},`);
push(`} as const;`);
push(``);
push(`/** component id -> quest key, for decoding an IF_SETCOLOUR straight off the wire. */`);
push(`export const QUEST_BY_COMPONENT: ReadonlyMap<number, string> =`);
push(`    new Map(QUESTS.map(q => [q.component, q.key]));`);
push(``);
push(`/**`);
push(` * Every varp name a \`route-feasibility\` quest gate can look up (from obstacles.json), sorted.`);
push(` * ${GATING_VARPS.length} of them across ${OBSTACLES.entries.filter(e => (e.ops ?? []).some(o => (o.reqs ?? []).some(r => r.kind === 'quest'))).length} loc types.`);
push(` */`);
push(`export const GATING_VARPS: readonly string[] = [${GATING_VARPS.map(ts).join(', ')}];`);
push(``);
push(`/**`);
push(` * The ${JOURNAL_ONLY_GATING.length} gating varps the JOURNAL COLOUR can pin (they are an unambiguous quest's progress varp),`);
push(` * once IF_SETCOLOUR is decoded. ${VARP_GATING.length} more (${VARP_GATING.map(g => g.varp).join(', ')}) are readable straight from getVarp.`);
push(` */`);
push(`export const JOURNAL_OBSERVABLE_GATING_VARPS: readonly string[] = [${JOURNAL_ONLY_GATING.map(g => ts(g.varp)).join(', ')}];`);
push(``);
push(`/**`);
push(` * ⛔ THE RESIDUE NEITHER CHANNEL REACHES — ${DARK_GATING.length} gating varps, ${DARK_GATE_TESTS} of the ${ALL_GATE_TESTS} gate tests. Three kinds:`);
for (const g of DARK_GATING) push(` *   ${g.varp.padEnd(22)} ${String(g.gates).padStart(2)} test(s)  ${g.kind === 'aux' ? `sub-state of ${g.quest}` : g.kind === 'progress-ambiguous' ? `progress of ${g.quest}, but its journal row is CONDITIONAL` : g.kind === 'unlisted-quest' ? 'a miniquest with no questlist row, so no colour is ever sent' : 'not owned by any quest'}`);
push(` *`);
push(` * A gate on one of these is NOT_OBSERVABLE even when the quest itself is known complete, because`);
push(` * nothing transmits them and the colour channel says nothing about them. Closing it needs a content`);
push(` * change (transmit=yes) or a live behavioural probe — never a default.`);
push(` */`);
push(`export const UNOBSERVABLE_GATING_VARPS: readonly string[] = [${DARK_GATING.map(g => ts(g.varp)).join(', ')}];`);
push(``);
push(`/**`);
push(` * How real quest gates compare. Counted from obstacles.json, and it is why a "green means complete,`);
push(` * so write the complete value into the profile" shortcut is NOT the default:`);
push(` * ${LOWER_BOUND_SAFE} of ${LOWER_BOUND_SAFE + LOWER_BOUND_UNSAFE} gate tests are \`>=\`/\`>\` (a lower bound answers them); the other ${LOWER_BOUND_UNSAFE} are`);
push(` * \`=\`/\`<\`/\`<=\`/\`!\`/switch, which a lower bound answers WRONGLY.`);
push(` *`);
push(` * ⛔ THESE ARE THE OPERATORS THE **BOT** MUST SATISFY, NOT THE ONES THE SCRIPT WROTE.`);
push(` * extract-obstacles.mjs classifies each comparison by the branch it guards and flips it when it`);
push(` * guards a refusal, so mcannon_doors.rs2:3's \`if (%mcannon < ^stage) { mes("The door is locked."); }\``);
push(` * is counted here as a \`>=\`. Counting the raw text instead put 53 refusal-shaped gates in the`);
push(` * "\`<\`, a lower bound answers it wrongly" column when they are the exact case a lower bound DOES`);
push(` * answer. Rows that the polarity pass found INERT (both branches pass — a state bump on the way`);
push(` * through, or the Al Kharid toll waiver) are not gates and are not counted at all; the waiver is`);
push(` * carried separately as \`waive:<op>\`, which IS the script's own operator.`);
push(` */`);
push(`export const QUEST_GATE_OPS: Readonly<Record<string, number>> = {`);
for (const [op, n] of orderedOps) push(`    ${ts(op)}: ${n},`);
push(`};`);
push(``);
push(`export const QUEST_TABLE_STATS = {`);
push(`    /** quests in [proc,update_questlist]. */`);
push(`    quests: ${QUEST_COUNT},`);
push(`    /** ...of which have a single progress varp/varbit (the rest compute progress in a proc). */`);
push(`    withProgressVarp: ${WITH_VARP},`);
push(`    /** ...of which compute progress in a proc and so have NO single variable to read at all. */`);
push(`    progressComputedByProc: ${NO_VARP},`);
push(`    /** ...of which that variable transmits and is therefore readable via getVarp. THE HONEST LIMIT. */`);
push(`    varpReadable: ${READABLE},`);
push(`    /** ...of which have a progress variable that does NOT transmit: readable only via the journal. */`);
push(`    varpDark: ${DARK},`);
push(`    /** quests with no varp-readable state at all (varpDark + progressComputedByProc). */`);
push(`    notVarpReadable: ${UNREADABLE},`);
push(`    /** varps in the game, and how many of those transmit at all. */`);
push(`    varpsTotal: ${VARP_COUNT},`);
push(`    varpsTransmitted: ${TRANSMITTED_VARPS},`);
push(`    /** distinct varps that gate a loc, split by the channel that can observe each. */`);
push(`    gatingVarps: ${GATING_VARPS.length},`);
push(`    gatingVarpsViaVarp: ${VARP_GATING.length},`);
push(`    gatingVarpsViaJournal: ${JOURNAL_ONLY_GATING.length},`);
push(`    gatingVarpsUnobservable: ${DARK_GATING.length},`);
push(`    /** individual gate TESTS across obstacles.json, and how many sit on an unobservable varp. */`);
push(`    gateTests: ${ALL_GATE_TESTS},`);
push(`    gateTestsUnobservable: ${DARK_GATE_TESTS},`);
push(`    /** quests whose journal row is coloured from a different variable on one branch. */`);
push(`    journalAmbiguousQuests: ${rows.filter(r => r.journalAmbiguous).length},`);
push(`} as const;`);
push(``);
push(`// -----------------------------------------------------------------------------------------------------`);
push(`// reader`);
push(`// -----------------------------------------------------------------------------------------------------`);
push(``);
push(READER_SRC());
push(``);
push(WIRING_SPEC());

function READER_SRC() {
    return `/** Any varp source. \`leanbot.getVarp\` satisfies it; so does a synthetic map in a test. */
export type VarpSource = (id: number) => number;

/**
 * Observed IF_SETCOLOUR values, keyed by COMPONENT id (what the wire carries), value = the 15-bit
 * colour. A component that was never seen is simply absent — which is why this is a Map and not an
 * array: "not observed" and "observed as 0" must not be the same thing.
 */
export type JournalColours = ReadonlyMap<number, number>;

/**
 * What is known about one quest, as an INTERVAL rather than a number.
 *
 * The interval is the whole point. A varp read pins the stage exactly (\`atLeast === atMost === value\`).
 * A journal colour does not: green means \`>= complete\` and yellow means \`1 .. complete-1\`. Carrying the
 * bounds instead of inventing a representative value is what lets \`questGateSatisfied\` answer
 * \`undefined\` for a threshold that falls inside the interval instead of guessing.
 */
export interface QuestObservation {
    /** quest key. */
    readonly quest: string;
    readonly name: string;
    /** progress varp name, or null when the quest has none. */
    readonly varp: string | null;
    readonly status: QuestStatus;
    /** the exact stage, when it is pinned. null whenever the observation is only a bound. */
    readonly value: number | null;
    /** inclusive lower bound on the stage. 0 when nothing is known. */
    readonly atLeast: number;
    /** inclusive upper bound, or null for "unbounded above". */
    readonly atMost: number | null;
    /**
     * Where the answer came from. \`'none'\` always accompanies NOT_OBSERVABLE.
     *   varp    read off the wire through getVarp (only possible for a transmit=yes variable)
     *   journal decoded from an IF_SETCOLOUR on this quest's questlist row
     *   exact   supplied by the caller via questStateFromStage/knownStages — the reader did not
     *           observe it and takes no responsibility for where it came from
     */
    readonly source: 'varp' | 'journal' | 'exact' | 'none';
}

function defOf(quest: string): QuestDef {
    const def = QUEST_BY_KEY.get(quest) ?? QUEST_BY_VARP.get(quest);
    if (!def) {
        throw new Error(
            \`unknown quest '\${quest}' — pass a questlist key (e.g. 'prince') or a progress varp name \` +
            \`(e.g. 'princequest'). Returning NOT_OBSERVABLE for a typo would hide the typo.\`);
    }
    return def;
}

function unobservable(def: QuestDef): QuestObservation {
    return {
        quest: def.key, name: def.name, varp: def.varp,
        status: 'NOT_OBSERVABLE', value: null, atLeast: 0, atMost: null, source: 'none',
    };
}

function fromValue(def: QuestDef, v: number, source: 'varp' | 'exact'): QuestObservation {
    const status: QuestStatus = v >= def.complete ? 'COMPLETE' : v > 0 ? 'IN_PROGRESS' : 'NOT_STARTED';
    return { quest: def.key, name: def.name, varp: def.varp, status, value: v, atLeast: v, atMost: v, source };
}

/**
 * Turn an EXACT stage value the caller obtained elsewhere into an observation.
 *
 * This is the only way to get a pinned interval for one of the ${DARK} quests whose variable does not
 * transmit, and it deliberately does NOT read a varp — it cannot re-create the "reads 0 forever" trap
 * because there is no id involved. Legitimate sources: a live behavioural probe, a fixture, a sim
 * world, or a future content change that adds transmit=yes. NOT a legitimate source: getVarp on an id
 * this file declined to publish.
 */
export function questStateFromStage(quest: string, stage: number): QuestObservation {
    return fromValue(defOf(quest), stage, 'exact');
}

/**
 * Decode one IF_SETCOLOUR observation into an interval. An unrecognised colour is NOT_OBSERVABLE:
 * content may colour a questlist row for some other reason, and a fourth colour must never be read as
 * one of the three.
 */
export function questStateFromColour(quest: string, colour: number): QuestObservation {
    const def = defOf(quest);
    // ⛔ A CONDITIONAL JOURNAL ROW TELLS YOU NOTHING ABOUT THE NAMED VARIABLE. Shield of Arrav colours
    // its row from %phoenixgang on one branch and %blackarmgang on the other; Underground Pass colours
    // it from the literal 1 when a start BIT is set. So a green Shield of Arrav can coexist with
    // %blackarmgang = 0, and a yellow Underground Pass with %upass = 0. Refuse the channel.
    if (def.journalAmbiguous) return unobservable(def);
    const base = { quest: def.key, name: def.name, varp: def.varp } as const;
    if (colour === JOURNAL_COLOUR.NOT_STARTED) {
        return { ...base, status: 'NOT_STARTED', value: 0, atLeast: 0, atMost: 0, source: 'journal' };
    }
    if (colour === JOURNAL_COLOUR.COMPLETE) {
        return { ...base, status: 'COMPLETE', value: null, atLeast: def.complete, atMost: null, source: 'journal' };
    }
    if (colour === JOURNAL_COLOUR.IN_PROGRESS) {
        return { ...base, status: 'IN_PROGRESS', value: null, atLeast: 1, atMost: def.complete - 1, source: 'journal' };
    }
    return unobservable(def);
}

/**
 * The reader. Prefers the exact varp when the quest has a transmitted one, falls back to the journal
 * colour, and reports NOT_OBSERVABLE when it has neither — never NOT_STARTED.
 *
 * \`quest\` accepts either a questlist key ('prince') or a progress varp name ('princequest').
 * An unknown name THROWS rather than degrading, because a silent NOT_OBSERVABLE for a typo is exactly
 * the "absence looks like zero" failure one level up.
 */
export function questState(getVarp: VarpSource, quest: string, journal?: JournalColours, knownStages?: Readonly<Record<string, number>>): QuestObservation {
    const def = defOf(quest);
    const known = def.varp !== null ? knownStages?.[def.varp] : undefined;
    if (known !== undefined) return fromValue(def, known, 'exact');
    if (def.readVarpId >= 0) {
        const raw = getVarp(def.readVarpId);
        return fromValue(def, def.bitMask < 0 ? raw : (raw >>> def.bitShift) & def.bitMask, 'varp');
    }
    const colour = journal?.get(def.component);
    if (colour !== undefined) return questStateFromColour(def.key, colour);
    return unobservable(def);
}

/**
 * \`true\`/\`false\` when known, \`undefined\` when NOT_OBSERVABLE. The undefined is load-bearing: a caller
 * that writes \`if (!isComplete(...))\` treats "cannot see" as "not done", which is the bug. Write
 * \`=== false\` or switch on \`questState().status\`.
 */
export function isComplete(getVarp: VarpSource, quest: string, journal?: JournalColours, knownStages?: Readonly<Record<string, number>>): boolean | undefined {
    const s = questState(getVarp, quest, journal, knownStages);
    if (s.status === 'NOT_OBSERVABLE') return undefined;
    return s.status === 'COMPLETE';
}

/** Every quest, in journal order. */
export function allQuestStates(getVarp: VarpSource, journal?: JournalColours, knownStages?: Readonly<Record<string, number>>): QuestObservation[] {
    return QUESTS.map(q => questState(getVarp, q.key, journal, knownStages));
}

/** Only the quests whose state is actually known. */
export function observableQuestStates(getVarp: VarpSource, journal?: JournalColours, knownStages?: Readonly<Record<string, number>>): QuestObservation[] {
    return allQuestStates(getVarp, journal, knownStages).filter(s => s.status !== 'NOT_OBSERVABLE');
}

/** Build the \`component id -> colour\` map from raw IF_SETCOLOUR events. Later events win. */
export function journalFromEvents(events: Iterable<{ component: number; colour: number }>): JournalColours {
    const m = new Map<number, number>();
    for (const e of events) m.set(e.component, e.colour);
    return m;
}

/**
 * Interval-exact evaluation of one gate. Mirrors \`route-feasibility\`'s own operator set
 * (\`>=\`, \`>\`, \`<=\`, \`<\`, \`=\`, \`!\`); anything else — including its \`switch\` form, whose stage is
 * unknowable — returns \`undefined\`.
 *
 * \`undefined\` means "the interval straddles the threshold", i.e. genuinely undecidable from what was
 * observed. It is NOT an error and it is NOT false.
 */
export function questGateSatisfied(obs: QuestObservation, op: string, want: number): boolean | undefined {
    if (obs.status === 'NOT_OBSERVABLE') return undefined;
    const lo = obs.atLeast;
    const hi = obs.atMost;                              // null = unbounded above
    switch (op) {
        case '>=': if (lo >= want) return true; if (hi !== null && hi < want) return false; return undefined;
        case '>':  if (lo > want) return true;  if (hi !== null && hi <= want) return false; return undefined;
        case '<=': if (hi !== null && hi <= want) return true; if (lo > want) return false; return undefined;
        case '<':  if (hi !== null && hi < want) return true;  if (lo >= want) return false; return undefined;
        case '=':  if (lo === want && hi === want) return true; if (want < lo || (hi !== null && want > hi)) return false; return undefined;
        case '!':  if (want < lo || (hi !== null && want > hi)) return true; if (lo === want && hi === want) return false; return undefined;
        default:   return undefined;
    }
}

export interface QuestProfileOptions {
    /** observed IF_SETCOLOUR values, if the client decodes them. */
    readonly journal?: JournalColours;
    /**
     * Varp names that must be pinned before a map may be handed to \`route-feasibility\`. Defaults to
     * \`GATING_VARPS\` — every varp any quest gate in the world can look up. Pass the subset a specific
     * route actually needs to get an answer far more often.
     */
    readonly requiredVarps?: readonly string[];
    /**
     * Exact stages the caller established some other way (a live probe, a fixture, a sim world),
     * keyed by progress varp NAME. Wins over both channels. Nothing in this file produces these — it is
     * how a caller closes a gap the wire cannot, without this module pretending it observed anything.
     */
    readonly knownStages?: Readonly<Record<string, number>>;
    /**
     * Write a journal-GREEN quest into the map as its \`complete\` value, which is only a LOWER BOUND.
     *
     * ⛔ OFF BY DEFAULT AND IT SHOULD USUALLY STAY OFF. \`route-feasibility\` treats a supplied map as
     * exact, and ${LOWER_BOUND_UNSAFE} of the ${LOWER_BOUND_SAFE + LOWER_BOUND_UNSAFE} real gate tests are \`=\`/\`<\`/\`<=\`/\`!\` (see QUEST_GATE_OPS),
     * which a lower bound answers WRONGLY — and answering wrongly in the passable direction is the
     * failure mode that cost five days. Turn it on only when the route's gates are known to be \`>=\`.
     */
    readonly allowCompleteLowerBound?: boolean;
}

export interface QuestProfileResult {
    /**
     * Spread into a \`BotProfile\`: \`{ ...base, ...result.profile }\`.
     *
     * \`{}\` — the \`quests\` key ABSENT — whenever any required varp could not be pinned. That is not a
     * failure to report; it is the answer that makes \`route-feasibility\` return UNKNOWN instead of
     * inventing a stage. A PRESENT-but-empty \`quests: {}\` is a different and much stronger claim
     * ("every quest is at 0"), and this builder only makes it when it is actually established.
     */
    readonly profile: Pick<BotProfile, 'quests'>;
    /** required varp names that could not be pinned. Empty iff \`profile.quests\` is present. */
    readonly unresolved: readonly string[];
    /** every quest's observation, for logging/diagnosis. */
    readonly observations: readonly QuestObservation[];
}

/**
 * Build the quest portion of a \`route-feasibility\` \`BotProfile\`.
 *
 * ⛔ WHY THIS IS ALL-OR-NOTHING. \`BotProfile.quests\` is documented as AUTHORITATIVE when present: a
 * missing key means stage 0, not "unknown" (route-feasibility.ts, \`questSatisfied\`). So there is no way
 * to express "I know about prince but not about dragon" inside the map — a partial map silently asserts
 * 0 for everything it omits. The only honest choices are a map in which every required varp is pinned,
 * or no map at all.
 */
export function questProfile(getVarp: VarpSource, opts: QuestProfileOptions = {}): QuestProfileResult {
    const journal = opts.journal;
    const required = opts.requiredVarps ?? GATING_VARPS;
    const observations = allQuestStates(getVarp, journal, opts.knownStages);
    const byVarp = new Map<string, QuestObservation>();
    for (const o of observations) if (o.varp) byVarp.set(o.varp, o);

    const quests: Record<string, number> = {};
    const unresolved: string[] = [];
    for (const varp of required) {
        const o = byVarp.get(varp);
        if (!o) { unresolved.push(varp); continue; }     // sub-state varp: no quest observes it
        // A pinned 0 is written by OMITTING the key: route-feasibility reads an absent key in a supplied
        // map as stage 0, so this is the same claim in fewer bytes. (The FIELD is still present — that
        // is what distinguishes "everything is at 0" from "I know nothing".)
        if (o.value !== null) { if (o.value !== 0) quests[varp] = o.value; continue; }
        if (o.status === 'COMPLETE' && opts.allowCompleteLowerBound) {
            const def = QUEST_BY_VARP.get(varp);
            if (def) { quests[varp] = def.complete; continue; }
        }
        unresolved.push(varp);
    }
    return {
        profile: unresolved.length ? {} : { quests },
        unresolved,
        observations,
    };
}
`;
}

function WIRING_SPEC() {
    const dark = DARK_GATING.length;
    return `// =====================================================================================================
// WIRING SPEC — what has to happen for this to answer anything
// =====================================================================================================
// Nothing imports this file yet, and on today's client it answers NOT_OBSERVABLE for ${UNREADABLE} of ${QUEST_COUNT}
// quests. That is correct, not broken: leanbot decodes VARP_SMALL/VARP_LARGE/VARP_SYNC but the quest
// progress varps do not transmit, and it does not decode IF_SETCOLOUR yet.
//
// STEP 1 — DECODE IF_SETCOLOUR (leanbot.ts, one case; owned by another agent, NOT done here).
//   ServerGameProt IF_SETCOLOUR = (${IF_SETCOLOUR.id}, ${IF_SETCOLOUR.size}), payload \`p2(component) p2(colour)\`.
//       case ${IF_SETCOLOUR.id}: { const com = this.g2(); const col = this.g2(); this.ifColour.set(com, col); break; }
//   Store into a \`Map<number, number>\` exactly like \`ifText\`. Do NOT default it to 0: an unobserved
//   component must stay ABSENT, or the tri-state acquires a fourth meaning that reads as "some other
//   colour" and this reader will (correctly) call it NOT_OBSERVABLE.
//
// STEP 2 — the colours arrive in the LOGIN burst. login.rs2 -> ~initalltabs -> ~update_questlist fires
//   before the first movement, so a brain can read quest state on tick 1 without opening the journal,
//   walking anywhere, or talking to anyone. ~update_questlist is ALSO re-run by the tutorial scripts, and
//   ~send_quest_progress fires per-quest on the relevant NPC dialogue, so the map self-heals as a quest
//   advances. Treat a colour change as an event: it is the cheapest possible "quest advanced" signal.
//
// STEP 3 — compose with route-feasibility:
//       import { questProfile } from './quest-state.js';
//       import { classifyRoute } from './route-feasibility.js';
//       const q = questProfile(id => bot.getVarp(id), { journal: bot.ifColour });
//       const verdict = classifyRoute(from, to, { coins, inventory, worn, skills, ...q.profile });
//   \`q.profile\` is \`{}\` unless every required varp is pinned, so an unresolved quest degrades the route
//   to UNKNOWN rather than being guessed. Narrow \`requiredVarps\` to the gates a given route actually
//   contains to get a definite answer far more often.
//
// STEP 4 — the residue. ${dark} of the ${GATING_VARPS.length} gating varps (${DARK_GATE_TESTS} of ${ALL_GATE_TESTS} gate tests) reach neither channel —
//   see UNOBSERVABLE_GATING_VARPS for the per-varp reason. Gates on those stay UNKNOWN. Closing that
//   needs either a content change (transmit=yes) or a live behavioural probe — both out of scope here,
//   and neither should be faked with a default.
//
// STEP 5 — quest-runner.ts: KEEP ITS OBSERVABLE GATING, ADD THIS AS A SUPERVISOR (not a step gate).
//   quest-runner.ts advances a step on an OBSERVABLE (an item gained or consumed) and says so in its
//   header: "never the server varp (the client may not even decode it)". That caution turns out to be
//   RIGHT ON THE FACTS, not merely conservative — the client now decodes varps and it still cannot see
//   ${DARK} of the ${WITH_VARP} quest progress variables, including \`%runemysteries\`, the one quest the runner
//   actually ships a step list for. Re-gating its steps on a varp would replace a working item check
//   with a permanent 0.
//
//   Even where a signal EXISTS it is the wrong shape for a step gate: the journal colour is per-QUEST
//   tri-state, so it changes once at "started" and once at "complete" — it cannot distinguish step 2
//   from step 3, which is what the runner needs. And the mid-quest \`~send_quest_progress\` calls fire
//   only on the relevant NPC's dialogue, i.e. they lag the item the runner is already watching.
//
//   The useful pairing is at the EDGES of a run, where this module is strictly better than an item
//   check:
//     * RESUME — QR_START_STEP is set by hand today, and a wrong value makes an early step retry
//       forever (its gain-check cannot re-trigger while the item is already held). \`questState\` on the
//       journal colour distinguishes NOT_STARTED / IN_PROGRESS / COMPLETE cheaply at login, so the
//       runner can skip the whole quest when green and refuse to start from step 0 when yellow.
//     * DONE — the runner declares success when its LAST step's observable lands. A green journal row
//       is the server agreeing. Disagreement (steps done, row still yellow) is a fixture bug worth
//       shouting about, and is invisible today.
//     * PRECONDITION — a quest whose prerequisite quest is red should not be attempted at all.
//   All three are supervisor-level checks around the run. None of them belongs inside the step loop,
//   and none of them is done here: quest-runner.ts is untouched by this package.
//
// WHAT THIS DELIBERATELY DOES NOT DO:
//   * it does not infer a quest's sub-state varps from the quest being NOT_STARTED. Plausible, unproven,
//     and the failure direction is "looks passable";
//   * it does not decompose \`qp\` into which quests are done. The award is equality-based and several
//     quests award the same points; the decomposition is not unique;
//   * it does not touch leanbot.ts, leanclient.ts, quest-runner.ts or route-feasibility.ts.
`;
}

const outText = L.join('\n') + '\n';
if (STDOUT_ONLY) process.stdout.write(outText);
else {
    fs.writeFileSync(OUT, outText);
    console.log(`[quest-extract] wrote ${path.relative(ROOT, OUT)}`);
    console.log(`[quest-extract] ${QUEST_COUNT} quests | ${WITH_VARP} with a progress variable (${NO_VARP} proc-computed) | ${READABLE} varp-readable | ${DARK} varp-dark`);
    console.log(`[quest-extract] ${TRANSMITTED_VARPS}/${VARP_COUNT} varps transmit | ${GATING_VARPS.length} gating varps: ${VARP_GATING.length} via varp, ${JOURNAL_ONLY_GATING.length} via journal colour, ${DARK_GATING.length} unobservable (${DARK_GATE_TESTS}/${ALL_GATE_TESTS} gate tests)`);
    console.log(`[quest-extract] gate ops: ${orderedOps.map(([o, n]) => `${o}=${n}`).join(' ')}`);
}
