#!/usr/bin/env bun
// ITEM VALUE / PROPERTY EXTRACTOR — emits `headless/item-values.ts`, the per-obj economic table the
// headless stack has never had: what an item is WORTH, whether it stacks, whether it can be traded or
// alched, and how its noted form links back to the unnoted one.
//
// ⛔ WHY GENERATED AND NOT SCANNED AT RUNTIME.
// The browser SDK learns an item's name/value by loading the client's config cache (ObjType tables) at
// boot. leanclient deliberately never builds that cache — no OnDemand worker, no config tables — so the
// headless stack sees inventories as bare (objId, count) pairs with no idea that 1333 is a rune scimitar
// worth 25,600gp, or that dropping it on death costs more than the entire rest of the backpack. The same
// facts sit in the packer's frozen tables, so we resolve them OFFLINE and check the result in.
//
// =================================================================================================
// ⛔ ID RESOLUTION: content/pack/*.pack IS THE TRUTH, data/pack/*.dat MUST AGREE, *.sym IS ADVISORY
// =================================================================================================
// extract-capabilities.mjs asserts `server/engine/data/symbols/*.sym` is the live id set and refuses to
// emit an id absent from it. THAT RULE IS WRONG and this package is the clearest proof yet — following
// it would not merely have skipped some ids, it would have read the WRONG PARAM off every single obj:
//
//   param              content/pack/param.pack   data/pack/server/param.dat   data/symbols/param.sym
//   no_alchemy         215                       215                          115  (= stabattack_anim)
//   destroy_death      50                        50                           204  (= brew_potion_ingredient)
//   destroy_drop       51                        51                           ABSENT
//
// param.sym is not "mostly right with a few gaps": of the 245 params in the pack, 212 DISAGREE with the
// sym and the remaining 33 are absent from it — ZERO agree. It is a stale build OUTPUT (symbols mtime
//, packed cache). The RuneScript compiler never reads it; tools/pack/Compiler.ts:181
// resolves ids from `${srcDir}/pack/*.pack`, and the runtime tables the engine loads at boot are
// `data/pack/server/*.dat` (+ the client jagfile). So this generator's rule is:
//
//     PRIMARY   server/content/pack/{obj,param}.pack        the compiler's own inputs
//     REQUIRED  server/engine/data/pack/server/{obj,param}.dat   what the engine loads; MUST agree
//     REQUIRED  server/engine/data/pack/client/config -> obj.dat  the OTHER half of the obj table
//     ADVISORY  server/engine/data/symbols/{obj,param}.sym  counted + reported, NEVER used to resolve
//
// The obj cross-check is not a spot check: every one of the 3894 ids has its debugname compared between
// obj.pack and the runtime server obj.dat, and the generator refuses to emit on a single disagreement.
//
// =================================================================================================
// ⛔ AN OBJ'S FIELDS LIVE IN **TWO** FILES AND NEITHER ONE IS ENOUGH
// =================================================================================================
// ObjType.load() (engine/src/cache/config/ObjType.ts:17-25) reads BOTH and decodes them into the same
// object, server first then client (ObjType.ts:38-39). The split is decided by the packer,
// tools/pack/config/ObjConfig.ts:
//
//   SERVER  data/pack/server/obj.dat      tradeable(15) wearpos(13/14/27) weight(75) category(94)
//                                         dummyitem(96) certlink->NOTE(97, ObjConfig.ts:442-446)
//                                         respawnrate(201) params(249) debugname(250)
//   CLIENT  data/pack/client/config       name(2) desc(3) stackable(11) cost(12) members(16)
//           (a bzip2 jagfile; member       certlink->BASE(97) certtemplate(98) op/iop(30-39)
//            'obj.dat')                    countobj/countco(100-109)
//
// So `cost`, `name`, `stackable` and `members` — four of the six fields this table exists for — are NOT
// in the server .dat at all. A generator that read only `data/pack/server/obj.dat` would emit a table
// where every item is worth 1gp (ObjType.cost defaults to 1) and nothing stacks. The client jagfile is
// decompressed here with the WEBCLIENT'S OWN pure-JS bunzip2 (server/webclient/src/io/BZip2.js) so this
// script stays dependency-free and never touches the engine's wasm module.
//
// =================================================================================================
// ⛔ certlink IS ONE FIELD WITH TWO MEANINGS, DISAMBIGUATED BY certtemplate
// =================================================================================================
// Both halves write code 97 into the same `certlink` slot:
//   * an UNNOTED obj gets certlink = the id of its NOTE      (server half, reverse lookup)
//   * a NOTE gets certlink = the id of its BASE item         (client half) AND certtemplate = 799
// They never collide — verified here: 0 of 3894 objs carry a 97 in both halves. The engine disambiguates
// exactly this way in OC_CERT / OC_UNCERT (ObjConfigOps.ts:67-85), and this generator mirrors it.
//
// A note is NOT a distinct item economically: ObjType.toCertificate() (ObjType.ts:295-321) copies
// name, members, cost and tradeable straight off the base and forces stackable=true. That is why noted
// items "inherit the base name" — cert_shark's display name is literally "Shark", not "Shark (noted)".
// It also means a note alchs for exactly what the item does.
//
// =================================================================================================
// ⛔ THE ALCH MULTIPLIERS ARE 60% / 40% — BUT WITH A FLOOR OF 1 AND A TRUNCATION, AND CONFIRMED HERE
// =================================================================================================
// skill_magic/scripts/spells/alchemy.rs2:25   high: max(scale(6, 10, oc_cost($item)), 1)
// skill_magic/scripts/spells/alchemy.rs2:61   low:  max(scale(4, 10, oc_cost($item)), 1)
// SCALE is `(a * c) / b` pushed through toInt32 (handlers/NumberOps.ts:124-127 + util/Numbers.ts:7-9),
// i.e. `(num * cost / den) | 0` — TRUNCATION TOWARD ZERO, not a round. MAX then floors the result at 1,
// so a cost-0 item (there are 18, e.g. `worm`) still alchs for 1gp and every 1gp item alchs for 1gp
// rather than 0. The multipliers are parsed out of alchemy.rs2 at generation time, never typed in — if
// content ever rebalances them this file changes with it instead of quietly lying.
//
// SOURCES (every one re-cited in the emitted provenance block):
//   server/content/pack/{obj,param,category}.pack           frozen id=name assignment
//   server/engine/data/pack/server/{obj,param}.dat          runtime tables (REQUIRED cross-check)
//   server/engine/data/pack/client/config -> obj.dat        runtime client table (name/cost/stack/members)
//   server/engine/src/cache/config/ObjType.ts               field codes + load-time post-processing
//   server/engine/tools/pack/config/ObjConfig.ts            which half each field is written to
//   skill_magic/scripts/spells/alchemy.rs2                  alch multipliers + every alch refusal
//   player/scripts/death.rs2                                what a death does to the carried stack
//   server/engine/src/util/WorldConfig.ts                   node.members (the F2P downgrade switch)
//
// Run:   bun server/webclient/headless/data/extract-item-values.mjs
// Check: bun server/webclient/headless/data/extract-item-values.mjs --stdout   (prints, writes nothing)
import fs from 'fs';
import path from 'path';
import { bunzip2 } from '../../src/io/BZip2.js';

const ROOT = path.resolve(import.meta.dir, '../../../..');
const CONTENT = path.join(ROOT, 'server/content');
const SCRIPTS = path.join(CONTENT, 'scripts');
const PACK = path.join(CONTENT, 'pack');
const ENGINE_PACK = path.join(ROOT, 'server/engine/data/pack');
const SYMBOLS = path.join(ROOT, 'server/engine/data/symbols');
const OUT = path.join(import.meta.dir, '..', 'item-values.ts');
const STDOUT_ONLY = process.argv.includes('--stdout');

const die = (msg) => { console.error(`[item-extract] FATAL: ${msg}`); process.exit(1); };
const read = (p) => { if (!fs.existsSync(p)) die(`missing source ${p}`); return fs.readFileSync(p, 'utf8'); };
const readBin = (p) => { if (!fs.existsSync(p)) die(`missing source ${p}`); return fs.readFileSync(p); };
const rs = (rel) => read(path.join(SCRIPTS, rel));

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
const objPack = readPack('obj.pack');
const paramPack = readPack('param.pack');
const categoryPack = readPack('category.pack');

/** ADVISORY only. Loaded so divergences can be REPORTED; never used to resolve an id. */
function loadSym(file) {
    const p = path.join(SYMBOLS, file);
    if (!fs.existsSync(p)) return null;
    const m = new Map();
    for (const line of read(p).split('\n')) {
        const t = line.trim();
        if (!t) continue;
        const parts = t.split('\t');
        const id = Number(parts[0]);
        if (Number.isFinite(id) && parts[1]) m.set(parts[1], id);
    }
    return m;
}
/** -> { divergent, absent, agree } for a whole pack namespace against its sym. */
function symAudit(pack, symName) {
    const sym = loadSym(symName);
    if (!sym) return { divergent: -1, absent: -1, agree: -1, loaded: false };
    let divergent = 0, absent = 0, agree = 0;
    for (const [id, name] of pack.byId) {
        const s = sym.get(name);
        if (s === undefined) absent++;
        else if (s !== id) divergent++;
        else agree++;
    }
    return { divergent, absent, agree, loaded: true, sym };
}
const objSym = symAudit(objPack, 'obj.sym');
const paramSym = symAudit(paramPack, 'param.sym');

// =================================================================================================
// BINARY READER — mirrors engine/src/io/Packet.ts getters (g1b/g2s/g4s signed, gjstr \n-terminated)
// =================================================================================================
function reader(buf) {
    let p = 0;
    return {
        get pos() { return p; },
        set pos(v) { p = v; },
        get avail() { return buf.length - p; },
        g1: () => buf[p++],
        g1b: () => { const v = buf.readInt8(p); p += 1; return v; },
        g2: () => { const v = (buf[p] << 8) | buf[p + 1]; p += 2; return v; },
        g2s: () => { const v = buf.readInt16BE(p); p += 2; return v; },
        g3: () => { const v = (buf[p] << 16) | (buf[p + 1] << 8) | buf[p + 2]; p += 3; return v; },
        g4s: () => { const v = buf.readInt32BE(p); p += 4; return v; },
        gbool: () => buf[p++] === 1,
        gjstr: () => { let s = ''; let b; while (p < buf.length && (b = buf[p++]) !== 10) s += String.fromCharCode(b); return s; },
    };
}

/** The client config archive is a jagfile (io/Jagfile.ts). Header: g3 unpacked, g3 packed; equal means
 *  the ARCHIVE is uncompressed and each member is individually bzip2'd. */
function readJagMember(file, member) {
    const buf = readBin(file);
    const head = reader(buf);
    const unpackedSize = head.g3();
    const packedSize = head.g3();
    const compressWhole = unpackedSize !== packedSize;
    const data = compressWhole ? Buffer.from(bunzip2(buf.subarray(6))) : buf;
    const r = reader(data);
    r.pos = compressWhole ? 0 : 6;
    const fileCount = r.g2();
    const entries = [];
    let pos = r.pos + fileCount * 10;
    for (let i = 0; i < fileCount; i++) {
        const hash = data.readInt32BE(r.pos); r.pos += 4;
        const unpacked = r.g3(), packed = r.g3();
        entries.push({ hash, unpacked, packed, pos });
        pos += packed;
    }
    // io/Jagfile.ts:4-11 genHash
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
// OBJ DECODE — one switch, verbatim from ObjType.decode() (ObjType.ts:185-293)
// =================================================================================================
// Both halves go through the SAME decoder in the engine, so they go through the same one here. Anything
// this table does not use is still consumed byte-for-byte: a code whose payload width we skipped would
// desync the cursor and silently corrupt every record after it. An unrecognised code is FATAL (the
// engine calls printFatalError on it, ObjType.ts:291).
function decodeObjHalf(rd, count, label) {
    const out = [];
    for (let id = 0; id < count; id++) {
        const rec = { id, certlink: -1, certtemplate: -1, params: null };
        for (;;) {
            if (rd.avail <= 0) break;
            const code = rd.g1();
            if (code === 0) break;
            if (code === 1) rd.g2();                                    // model
            else if (code === 2) rec.name = rd.gjstr();
            else if (code === 3) rec.desc = rd.gjstr();
            else if (code === 4) rd.g2();                               // 2dzoom
            else if (code === 5) rd.g2();                               // 2dxan
            else if (code === 6) rd.g2();                               // 2dyan
            else if (code === 7) rd.g2s();                              // 2dxof
            else if (code === 8) rd.g2s();                              // 2dyof
            else if (code === 9) { /* code9 flag */ }
            else if (code === 10) rd.g2();                              // code10 (seq)
            else if (code === 11) rec.stackable = true;
            else if (code === 12) rec.cost = rd.g4s();
            else if (code === 13) rec.wearpos = rd.g1();
            else if (code === 14) rd.g1();                              // wearpos2
            else if (code === 15) rec.tradeable = false;
            else if (code === 16) rec.members = true;
            else if (code === 23) { rd.g2(); rd.g1b(); }                // manwear + offset
            else if (code === 24) rd.g2();                              // manwear2
            else if (code === 25) { rd.g2(); rd.g1b(); }                // womanwear + offset
            else if (code === 26) rd.g2();                              // womanwear2
            else if (code === 27) rd.g1();                              // wearpos3
            else if (code >= 30 && code < 35) rd.gjstr();               // op1..5
            else if (code >= 35 && code < 40) rd.gjstr();               // iop1..5
            else if (code === 40) { const n = rd.g1(); for (let i = 0; i < n; i++) { rd.g2(); rd.g2(); } }
            else if (code === 75) rec.weight = rd.g2s();
            else if (code === 78 || code === 79) rd.g2();               // man/womanwear3
            else if (code >= 90 && code <= 93) rd.g2();                 // man/womanhead(2)
            else if (code === 94) rec.category = rd.g2();
            else if (code === 95) rd.g2();                              // 2dzan
            else if (code === 96) rec.dummyitem = rd.g1();
            else if (code === 97) rec.certlink = rd.g2();
            else if (code === 98) rec.certtemplate = rd.g2();
            else if (code >= 100 && code < 110) { rd.g2(); rd.g2(); }   // countobj/countco
            else if (code >= 110 && code <= 112) rd.g2();               // resizex/y/z
            else if (code === 113 || code === 114) rd.g1b();            // ambient/contrast
            else if (code === 115) rd.g1();                             // team (rev 289+: castle wars capes; ObjType.decode)
            else if (code === 201) rec.respawnrate = rd.g2();
            else if (code === 249) {                                    // ParamHelper.decodeParams
                const n = rd.g1();
                rec.params = new Map();
                for (let i = 0; i < n; i++) {
                    const key = rd.g3();
                    rec.params.set(key, rd.gbool() ? rd.gjstr() : rd.g4s());
                }
            } else if (code === 250) rec.debugname = rd.gjstr();
            else die(`${label} obj id=${id}: unrecognized config code ${code} at byte ${rd.pos} — ` +
                `the packed data is out of sync with ObjType.decode(). Repack before regenerating.`);
        }
        out.push(rec);
    }
    if (rd.avail !== 0) die(`${label} obj table has ${rd.avail} trailing bytes after ${count} records — decode desync`);
    return out;
}

const serverObjBuf = readBin(path.join(ENGINE_PACK, 'server/obj.dat'));
const serverRd = reader(serverObjBuf);
const OBJ_COUNT = serverRd.g2();
const serverObjs = decodeObjHalf(serverRd, OBJ_COUNT, 'server');

const clientObjBuf = readJagMember(path.join(ENGINE_PACK, 'client/config'), 'obj.dat');
const clientRd = reader(clientObjBuf);
const clientCount = clientRd.g2();
if (clientCount !== OBJ_COUNT) {
    die(`record-count disagreement: server obj.dat says ${OBJ_COUNT}, client config/obj.dat says ${clientCount}. ` +
        `The two halves of the obj table are from different packer runs — repack before regenerating.`);
}
const clientObjs = decodeObjHalf(clientRd, clientCount, 'client');

// ---- REQUIRED cross-check: obj.pack id=name MUST equal the runtime server table's debugname ------
if (objPack.max !== OBJ_COUNT - 1) {
    die(`obj.pack's highest id is ${objPack.max} but the runtime obj.dat holds ${OBJ_COUNT} records ` +
        `(expected max id ${OBJ_COUNT - 1}). Repack before regenerating.`);
}
const packVsRuntime = [];
for (let id = 0; id < OBJ_COUNT; id++) {
    const packName = objPack.byId.get(id);
    const runtimeName = serverObjs[id].debugname ?? null;
    if (packName !== runtimeName) packVsRuntime.push({ id, pack: packName ?? null, runtime: runtimeName });
}
if (packVsRuntime.length) {
    for (const d of packVsRuntime.slice(0, 10)) console.error(`  id ${d.id}: pack=${d.pack} runtime=${d.runtime}`);
    die(`${packVsRuntime.length} obj ids DISAGREE between server/content/pack/obj.pack and the runtime ` +
        `server/engine/data/pack/server/obj.dat. Every id in this table would address the wrong item. ` +
        `Repack before regenerating.`);
}

// ---- PARAM ids: PRIMARY param.pack, REQUIRED agreement with runtime param.dat -------------------
function decodeParamTable() {
    const buf = readBin(path.join(ENGINE_PACK, 'server/param.dat'));
    const rd = reader(buf);
    const count = rd.g2();
    const byId = new Map();
    for (let id = 0; id < count; id++) {
        const rec = { id, autodisable: true };
        for (;;) {
            if (rd.avail <= 0) break;
            const code = rd.g1();
            if (code === 0) break;
            if (code === 1) rec.type = rd.g1();
            else if (code === 2) rec.defaultInt = rd.g4s();
            else if (code === 4) rec.autodisable = false;
            else if (code === 5) rec.defaultString = rd.gjstr();
            else if (code === 250) rec.debugname = rd.gjstr();
            else die(`param id=${id}: unrecognized config code ${code}`);
        }
        byId.set(id, rec);
    }
    if (rd.avail !== 0) die(`param.dat has ${rd.avail} trailing bytes after ${count} records — decode desync`);
    return { byId, count };
}
const paramRuntime = decodeParamTable();
if (paramRuntime.count !== paramPack.max + 1) {
    die(`param.pack max id ${paramPack.max} vs runtime param.dat count ${paramRuntime.count} — repack first`);
}
/** Resolve a param id. PRIMARY = param.pack, REQUIRED = the runtime param.dat debugname agrees. */
const paramLookups = [];
function param(name) {
    const packId = paramPack.byName.get(name);
    if (packId === undefined) die(`param '${name}' is not in param.pack`);
    const runtime = paramRuntime.byId.get(packId);
    if (!runtime || runtime.debugname !== name) {
        die(`param '${name}' is ${packId} in param.pack but the runtime param.dat calls ${packId} ` +
            `'${runtime?.debugname ?? 'null'}'. Refusing to emit — this would read the wrong field off every obj.`);
    }
    const symId = paramSym.loaded ? paramSym.sym.get(name) : undefined;
    paramLookups.push({ name, id: packId, sym: symId === undefined ? null : symId, autodisable: runtime.autodisable });
    return packId;
}
const P_NO_ALCHEMY = param('no_alchemy');
const P_DESTROY_DEATH = param('destroy_death');
const P_DESTROY_DROP = param('destroy_drop');

// =================================================================================================
// MERGE + LOAD-TIME POST-PROCESSING — ObjType.parse() (ObjType.ts:27-75), in the SAME ORDER
// =================================================================================================
// ⛔ THE ORDER IS LOAD-BEARING. parse() runs one pass over ids 0..count: toCertificate() first, then the
// dummyitem clamp, then the F2P clamp. A note therefore inherits whatever its base's `tradeable` was AT
// THE MOMENT THE NOTE'S ID WAS REACHED. Every note in this content sits at base_id+1, so the base is
// always already clamped — but we replicate the loop literally rather than rely on that holding.
const objs = [];
for (let id = 0; id < OBJ_COUNT; id++) {
    const s = serverObjs[id], c = clientObjs[id];
    if (s.certlink >= 0 && c.certlink >= 0) {
        die(`obj ${s.debugname} (${id}) carries a certlink in BOTH halves (server=${s.certlink} client=${c.certlink}) — ` +
            `the note/base disambiguation in OC_CERT/OC_UNCERT is ambiguous for it. Refusing to emit.`);
    }
    objs.push({
        id,
        debugname: s.debugname ?? null,
        name: c.name ?? null,                                    // ObjType.name default null
        cost: c.cost ?? 1,                                       // ObjType.cost default 1
        stackable: c.stackable === true,                         // default false
        members: c.members === true,                             // default false
        tradeable: s.tradeable !== false,                        // default true; code 15 clears it
        certlink: s.certlink >= 0 ? s.certlink : c.certlink,     // one field, two meanings (see header)
        certtemplate: c.certtemplate,
        category: s.category ?? -1,                              // default -1
        dummyitem: s.dummyitem ?? 0,                             // default 0
        weight: s.weight ?? 0,
        params: s.params,                                        // params are server-side only
    });
}
let notedCount = 0, dummyClamped = 0;
for (const o of objs) {
    if (o.certtemplate !== -1) {                                 // ObjType.ts:51-53 -> toCertificate()
        const link = objs[o.certlink];
        if (!link) die(`note ${o.debugname} (${o.id}) links to a nonexistent base ${o.certlink}`);
        o.name = link.name;
        o.members = link.members;
        o.cost = link.cost;
        o.tradeable = link.tradeable;
        o.stackable = true;
        notedCount++;
    }
    if (o.dummyitem !== 0) { o.tradeable = false; dummyClamped++; }   // ObjType.ts:55-57
    // ObjType.ts:59-73 (the F2P clamp) is NOT applied — see MEMBERS_WORLD below.
}

// ---- symmetry check on the note linkage ---------------------------------------------------------
const notes = objs.filter(o => o.certtemplate !== -1);
const noteBearers = objs.filter(o => o.certtemplate === -1 && o.certlink >= 0);
if (notes.length !== noteBearers.length) {
    die(`asymmetric note linkage: ${notes.length} notes but ${noteBearers.length} items claim one`);
}
for (const n of notes) {
    const base = objs[n.certlink];
    if (base.certlink !== n.id) die(`note ${n.debugname} -> base ${base.debugname}, but that base points at ${base.certlink}`);
    if (base.certtemplate !== -1) die(`note ${n.debugname} links to ${base.debugname}, which is itself a note`);
}
const CERT_TEMPLATES = [...new Set(notes.map(n => n.certtemplate))];
if (CERT_TEMPLATES.length !== 1) die(`expected exactly one cert template obj, found ${CERT_TEMPLATES.length}`);
const CERT_TEMPLATE = CERT_TEMPLATES[0];

// =================================================================================================
// WORLD MEMBERS FLAG — the switch that decides whether the F2P clamp runs at all
// =================================================================================================
// ObjType.parse():59-73 turns EVERY members obj untradeable (and strips its category + autodisable
// params) when the node is not a members world. WorldConfig.ts:302-320 loads `data/config/world.json`,
// falling back to `.env`, falling back to createDefaultWorldConfig() where members defaults to true
// (WorldConfig.ts:100). This checkout has no world.json and no engine .env, so the clamp does NOT run —
// but a bot pointed at an F2P node sees a different table, so the count is emitted for that reader.
function resolveMembersWorld() {
    const worldJson = path.join(ROOT, 'server/engine/data/config/world.json');
    if (fs.existsSync(worldJson)) {
        try {
            const parsed = JSON.parse(fs.readFileSync(worldJson, 'utf8'));
            if (typeof parsed?.node?.members === 'boolean') return { members: parsed.node.members, source: 'data/config/world.json' };
        } catch { /* fall through to the engine's own fallback chain */ }
    }
    const legacy = path.join(ROOT, 'server/engine/.env');
    if (fs.existsSync(legacy)) {
        const m = /^NODE_MEMBERS\s*=\s*(\S+)/m.exec(fs.readFileSync(legacy, 'utf8'));
        if (m) return { members: /^(true|1|yes)$/i.test(m[1]), source: 'server/engine/.env NODE_MEMBERS' };
    }
    return { members: true, source: 'WorldConfig.ts:100 default (no world.json, no .env)' };
}
const MEMBERS_WORLD = resolveMembersWorld();
if (!MEMBERS_WORLD.members) {
    die(`this node is configured members=false (${MEMBERS_WORLD.source}). The F2P clamp in ObjType.parse():59-73 ` +
        `would apply and this generator does not model it. Emit refused rather than emit a wrong table.`);
}
const f2pWouldClamp = objs.filter(o => o.members && o.tradeable).length;

// =================================================================================================
// ALCHEMY — multipliers AND refusals, both PARSED out of alchemy.rs2
// =================================================================================================
const alchSrc = rs('skill_magic/scripts/spells/alchemy.rs2');
function parseAlchScale(label) {
    const re = new RegExp(`\\[label,magic_spell_${label}_alch\\][\\s\\S]*?max\\(scale\\((\\d+),\\s*(\\d+),\\s*oc_cost\\(\\$item\\)\\),\\s*(\\d+)\\)`);
    const m = re.exec(alchSrc);
    if (!m) die(`could not parse the ${label}-alch multiplier out of alchemy.rs2 — the formula changed shape`);
    return { num: Number(m[1]), den: Number(m[2]), floor: Number(m[3]) };
}
const HIGH = parseAlchScale('high');
const LOW = parseAlchScale('low');
if (HIGH.floor !== LOW.floor) die(`high and low alch disagree on the floor (${HIGH.floor} vs ${LOW.floor})`);
if (HIGH.den !== LOW.den) die(`high and low alch disagree on the denominator (${HIGH.den} vs ${LOW.den})`);
const ALCH_FLOOR = HIGH.floor;
// SCALE = toInt32((a * c) / b) — NumberOps.ts:124-127 + Numbers.ts:7-9. `| 0` truncates toward zero.
const alch = (cost, num) => Math.max(((num * cost) / HIGH.den) | 0, ALCH_FLOOR);
// A 32-bit overflow in `| 0` would silently produce garbage; assert it cannot happen for this content.
for (const o of objs) {
    for (const n of [HIGH.num, LOW.num]) {
        const raw = (n * o.cost) / HIGH.den;
        if (raw > 2147483647 || raw < -2147483648) die(`alch of ${o.debugname} (cost ${o.cost}) overflows int32`);
    }
}

// ---- the refusal set, from [proc,is_alchable] (alchemy.rs2:71-113) ------------------------------
// Two kinds. HARD = the item can never be alched. CONDITIONAL = the refusal depends on runtime state
// (how many of that rune you are holding), so the item stays alchable in the table and is listed apart.
const isAlchableBlock = /\[proc,is_alchable\][\s\S]*?\nreturn\(true\);/.exec(alchSrc);
if (!isAlchableBlock) die('could not isolate [proc,is_alchable] in alchemy.rs2');
const alchBody = isAlchableBlock[0];

const HARD_OBJ_CASES = [];
for (const m of alchBody.matchAll(/case ([a-z_0-9]+)\s*:\s*\n\s*mes\("([^"]*)"\);\s*\n\s*return\(false\);/g)) {
    HARD_OBJ_CASES.push({ obj: m[1], reason: m[2] });
}
// macro_cube's arm calls a proc instead of mes()ing, so it is matched separately rather than assumed.
const macroCube = /case (macro_cube)\s*:\s*\n\s*~try_add_macro_cube;\s*\n\s*return\(false\);/.exec(alchBody);
if (macroCube) HARD_OBJ_CASES.push({ obj: macroCube[1], reason: 'consumed by the random-event handler (~try_add_macro_cube)' });
if (HARD_OBJ_CASES.length < 3) die(`parsed only ${HARD_OBJ_CASES.length} hard alch refusals from is_alchable`);

const CONDITIONAL_CASES = [];
for (const m of alchBody.matchAll(/case ([a-z_0-9]+)\s*:\s*\n\s*if \(sub\(inv_total\(inv, \1\), \$rune_count\d\) < 1\) \{\s*\n\s*mes\("([^"]*)"\);/g)) {
    CONDITIONAL_CASES.push({ obj: m[1], reason: m[2] });
}
if (!CONDITIONAL_CASES.length) die('parsed no conditional (rune-stock) alch refusals from is_alchable');

// ⛔ `{` IS NOT NECESSARILY THE END OF THE LINE. The `cat | overgrown` arm carries a trailing `//` comment
// between the brace and the mes(), and a `\{\s*\n` anchor silently skipped the whole arm — the first cut
// of this generator emitted 17 blocked objs instead of 29 and looked perfectly healthy doing it. The arm
// count is now asserted against the raw number of oc_category tests, so a miss is fatal, not quiet.
const BLOCKED_CATEGORIES = [];
for (const m of alchBody.matchAll(/if\s*\(\s*oc_category\(\$item\)\s*=\s*(\w+)(?:\s*\|\s*oc_category\(\$item\)\s*=\s*(\w+))?\s*\)\s*\{[^\n]*\n\s*mes\("([^"]*)"\);/g)) {
    for (const cat of [m[1], m[2]]) {
        if (!cat) continue;
        const cid = categoryPack.byName.get(cat);
        if (cid === undefined) die(`is_alchable blocks category '${cat}' which is not in category.pack`);
        BLOCKED_CATEGORIES.push({ name: cat, id: cid, reason: m[3] });
    }
}
if (!BLOCKED_CATEGORIES.length) die('parsed no category-based alch refusals from is_alchable');
const categoryTests = (alchBody.match(/oc_category\(\$item\)\s*=/g) ?? []).length;
if (BLOCKED_CATEGORIES.length !== categoryTests) {
    die(`is_alchable makes ${categoryTests} oc_category tests but only ${BLOCKED_CATEGORIES.length} were parsed ` +
        `(${BLOCKED_CATEGORIES.map(c => c.name).join(', ')}) — an alch refusal would be missing from the table.`);
}

const noAlchParamGate = /oc_param\(\$item, no_alchemy\) = \^true\) \{\s*\n\s*mes\("([^"]*)"\);/.exec(alchBody);
if (!noAlchParamGate) die('is_alchable no longer gates on the no_alchemy param');
const NO_ALCH_MESSAGE = noAlchParamGate[1];

const hardObjIds = new Map();
for (const c of HARD_OBJ_CASES) {
    const id = objPack.byName.get(c.obj);
    if (id === undefined) die(`is_alchable names obj '${c.obj}' which is not in obj.pack`);
    hardObjIds.set(id, c.reason);
}
const conditionalObjIds = new Map();
for (const c of CONDITIONAL_CASES) {
    const id = objPack.byName.get(c.obj);
    if (id === undefined) die(`is_alchable names obj '${c.obj}' which is not in obj.pack`);
    conditionalObjIds.set(id, c.reason);
}
const blockedCategoryIds = new Map(BLOCKED_CATEGORIES.map(c => [c.id, c]));

// ⛔ THE SWITCH ARMS WIN OVER THE DEFAULT ARM. switch_obj($item) routes an explicitly-cased obj to its own
// arm; the category + no_alchemy checks live in `case default`, so a cased obj never reaches them.
const ALCH_BLOCKED = [];
for (const o of objs) {
    let blocked = null;
    if (hardObjIds.has(o.id)) blocked = { kind: 'obj', reason: hardObjIds.get(o.id) };
    else if (conditionalObjIds.has(o.id)) blocked = null;                       // conditional, not a property
    else if (blockedCategoryIds.has(o.category)) blocked = { kind: 'category', reason: blockedCategoryIds.get(o.category).reason };
    else if (o.params?.get(P_NO_ALCHEMY) === 1) blocked = { kind: 'param', reason: NO_ALCH_MESSAGE };
    o.alchable = blocked === null;
    if (blocked) ALCH_BLOCKED.push({ id: o.id, debugname: o.debugname, kind: blocked.kind, reason: blocked.reason });
}
const ALCH_CONDITIONAL = [...conditionalObjIds].map(([id, reason]) => ({ id, debugname: objs[id].debugname, reason }))
    .sort((a, b) => a.id - b.id);

// =================================================================================================
// DEATH — destroy_death / destroy_drop, the params that decide whether a carried item is even droppable
// =================================================================================================
const deathSrc = rs('player/scripts/death.rs2');
if (!/oc_param\(\$currentitem, destroy_drop\) = \^true \| oc_param\(\$currentitem, destroy_death\) = \^true/.test(deathSrc)) {
    die('death.rs2 no longer gates the drop on destroy_drop/destroy_death — recheck the destroyOnDeath field');
}
if (!/inv_dropall\(inv, coord, \^lootdrop_duration\);/.test(deathSrc)) die('death.rs2 no longer inv_dropall()s the backpack on a PvE death');
if (!/inv_dropall\(worn, coord, \^lootdrop_duration\);/.test(deathSrc)) die('death.rs2 no longer inv_dropall()s the worn inv on a PvE death');
const priciestCalls = (deathSrc.match(/~move_priciest_item_on_hero_to_death;/g) ?? []).length;
if (priciestCalls < 4) die(`death.rs2 makes ${priciestCalls} ~move_priciest_item_on_hero_to_death calls, expected >= 4 (3 unskulled + 1 protect item)`);
if (!/if \(oc_cost\(\$currentitem\) > \$biggest_price\) \{/.test(deathSrc)) die('~move_priciest_item_on_hero_to_death no longer ranks by oc_cost');
for (const o of objs) {
    o.destroyOnDeath = o.params?.get(P_DESTROY_DEATH) === 1 || o.params?.get(P_DESTROY_DROP) === 1;
}

// =================================================================================================
// SANITY GATES — a table that quietly emitted zeroes would be worse than no table
// =================================================================================================
if (objs.some(o => !o.debugname)) die('an obj has no debugname — cannot key the table');
if (new Set(objs.map(o => o.debugname)).size !== objs.length) die('duplicate debugnames in obj.pack');
const COINS = objPack.byName.get('coins');
if (COINS === undefined) die("obj.pack has no 'coins'");
if (!objs[COINS].stackable) die('coins decoded as non-stackable — the client half did not load');
if (!objs.some(o => o.cost > 1000)) die('no obj costs more than 1000gp — the client half did not load');
const namedCount = objs.filter(o => o.name !== null).length;
if (namedCount < OBJ_COUNT * 0.9) die(`only ${namedCount}/${OBJ_COUNT} objs decoded a name — the client half did not load`);

// =================================================================================================
// EMIT
// =================================================================================================
const ts = (v) => JSON.stringify(v);
const L = [];
const push = (s) => L.push(s);

push(`export interface ItemValue {`);
push(`    /** obj id. ⛔ NOT the wire value — see OBJ_WIRE_OFFSET. */`);
push(`    readonly id: number;`);
push(`    /** content name, e.g. 'rune_scimitar'. Unique; this is what obj.pack keys on. */`);
push(`    readonly debugname: string;`);
push(`    /** display name as the client shows it, e.g. 'Rune scimitar'. null for the ${OBJ_COUNT - namedCount} objs`);
push(`     *  that declare neither a name nor a model (the packer only auto-fills a name when a model exists,`);
push(`     *  ObjConfig.ts:238-241). A NOTE carries its BASE's name verbatim — 'Shark', not 'Shark (noted)'. */`);
push(`    readonly name: string | null;`);
push(`    /** ObjType.cost — the single number the whole economy is scaled off (alchemy, shop prices, and`);
push(`     *  the death keep-order). Defaults to 1 when the obj config omits \`cost\`, so 1 means "unpriced",`);
push(`     *  NOT "worth one coin": ${objs.filter(o => o.cost === 1).length} of ${OBJ_COUNT} objs sit at 1, including coins itself. */`);
push(`    readonly cost: number;`);
push(`    /** max(trunc(cost * ${HIGH.num} / ${HIGH.den}), ${ALCH_FLOOR}) — alchemy.rs2:25. Meaningful only when \`alchable\`. */`);
push(`    readonly highAlch: number;`);
push(`    /** max(trunc(cost * ${LOW.num} / ${LOW.den}), ${ALCH_FLOOR}) — alchemy.rs2:61. Meaningful only when \`alchable\`. */`);
push(`    readonly lowAlch: number;`);
push(`    /** false when [proc,is_alchable] refuses this obj unconditionally. See ALCH_BLOCKED for why.`);
push(`     *  Items refused only on a RUNTIME condition (rune stock) stay true — see ALCH_CONDITIONAL. */`);
push(`    readonly alchable: boolean;`);
push(`    /** one inventory slot holds any quantity. Every note is stackable (toCertificate forces it). */`);
push(`    readonly stackable: boolean;`);
push(`    /** can be offered in a trade / sold. Forced false for dummy objs, and — on an F2P node only —`);
push(`     *  for every members obj (see MEMBERS_WORLD). */`);
push(`    readonly tradeable: boolean;`);
push(`    readonly members: boolean;`);
push(`    /** interface-only obj (dummyitem != 0): it exists to be drawn in a dummy inv and can never be`);
push(`     *  held. The coins_2..coins_10000 stack graphics are these. Never value one as carried wealth. */`);
push(`    readonly dummy: boolean;`);
push(`    /** destroy_drop or destroy_death is set: on death this obj is DELETED, not dropped — it never`);
push(`     *  reaches the ground pile, so it is unrecoverable rather than merely at risk (death.rs2). */`);
push(`    readonly destroyOnDeath: boolean;`);
push(`    /** id of this item's NOTE, or -1. Mirrors OC_CERT (ObjConfigOps.ts:67-75). */`);
push(`    readonly notedId: number;`);
push(`    /** the item this NOTE is of, or -1 if this is not a note. Mirrors OC_UNCERT (ObjConfigOps.ts:77-85). */`);
push(`    readonly unnotedId: number;`);
push(`}`);
push(``);
push(`/** A row as generated: only the fields that DIFFER from ITEM_DEFAULTS are written out. Spelled out`);
push(` *  rather than built from Pick/Partial so tsc has one flat shape to check ${OBJ_COUNT} literals against. */`);
push(`interface ItemRow {`);
push(`    readonly id: number;`);
push(`    readonly debugname: string;`);
push(`    readonly name: string | null;`);
push(`    readonly cost: number;`);
push(`    readonly alchable?: boolean;`);
push(`    readonly stackable?: boolean;`);
push(`    readonly tradeable?: boolean;`);
push(`    readonly members?: boolean;`);
push(`    readonly dummy?: boolean;`);
push(`    readonly destroyOnDeath?: boolean;`);
push(`    readonly notedId?: number;`);
push(`    readonly unnotedId?: number;`);
push(`}`);
push(``);
push(`/** The value every omitted field in ROWS takes. These are ObjType's own field defaults.`);
push(` *  (ObjType.ts:147-181 — stackable false, tradeable true, members false, dummyitem 0, certlink -1.) */`);
push(`export const ITEM_DEFAULTS = {`);
push(`    alchable: true, stackable: false, tradeable: true, members: false,`);
push(`    dummy: false, destroyOnDeath: false, notedId: -1, unnotedId: -1,`);
push(`} as const;`);
push(``);
push(`/** Number of obj records in the runtime table. Ids run 0..${OBJ_COUNT - 1}; ITEM_VALUES is dense and index === id. */`);
push(`export const OBJ_COUNT = ${OBJ_COUNT};`);
push(``);
push(`/** ⛔ THE WIRE SENDS obj.id + 1, WITH 0 MEANING "EMPTY SLOT".`);
push(` *  UPDATE_INV_FULL / UPDATE_INV_PARTIAL carry \`g2() = id + 1\`; a decoder that forgets the -1 reads`);
push(` *  coins (995) as 996 = coins_2, a DUMMY obj — i.e. it silently values a whole cash stack`);
push(` *  as an interface graphic. leanbot.ts:1274 already subtracts it; use objFromWire/objToWire here. */`);
push(`export const OBJ_WIRE_OFFSET = 1;`);
push(`/** wire value -> obj id. Returns -1 for an empty slot. */`);
push(`export const objFromWire = (wire: number): number => wire - OBJ_WIRE_OFFSET;`);
push(`/** obj id -> wire value. */`);
push(`export const objToWire = (id: number): number => id + OBJ_WIRE_OFFSET;`);
push(``);
push(`/** Alchemy multipliers, parsed from skill_magic/scripts/spells/alchemy.rs2 at generation time. */`);
push(`export const ALCH = {`);
push(`    /** high alch numerator (alchemy.rs2:25 — \`scale(${HIGH.num}, ${HIGH.den}, oc_cost($item))\`) */`);
push(`    HIGH_NUM: ${HIGH.num},`);
push(`    /** low alch numerator (alchemy.rs2:61 — \`scale(${LOW.num}, ${LOW.den}, oc_cost($item))\`) */`);
push(`    LOW_NUM: ${LOW.num},`);
push(`    DEN: ${HIGH.den},`);
push(`    /** \`max(..., ${ALCH_FLOOR})\` — the payout can never be 0, so even a cost-0 obj alchs for ${ALCH_FLOOR}gp. */`);
push(`    FLOOR: ${ALCH_FLOOR},`);
push(`} as const;`);
push(``);
push(`/** The engine's SCALE op: \`toInt32((a * c) / b)\` (NumberOps.ts:124-127, Numbers.ts:7-9).`);
push(` *  TRUNCATION TOWARD ZERO, not a round — 6*499/10 = 299.4 pays 299. */`);
push(`export const alchValue = (cost: number, num: number): number =>`);
push(`    Math.max(((num * cost) / ALCH.DEN) | 0, ALCH.FLOOR);`);
push(`export const highAlchValue = (cost: number): number => alchValue(cost, ALCH.HIGH_NUM);`);
push(`export const lowAlchValue = (cost: number): number => alchValue(cost, ALCH.LOW_NUM);`);
push(``);
push(`/** The one obj every note is templated off (certtemplate). */`);
push(`export const CERT_TEMPLATE_OBJ = ${CERT_TEMPLATE};`);
push(`/** coins. The unit of account, and the id most often hard-coded wrong (see OBJ_WIRE_OFFSET). */`);
push(`export const COINS_OBJ = ${COINS};`);
push(``);
push(`function materialize(r: ItemRow): ItemValue {`);
push(`    return {`);
push(`        id: r.id, debugname: r.debugname, name: r.name, cost: r.cost,`);
push(`        highAlch: highAlchValue(r.cost),`);
push(`        lowAlch: lowAlchValue(r.cost),`);
push(`        alchable: r.alchable ?? ITEM_DEFAULTS.alchable,`);
push(`        stackable: r.stackable ?? ITEM_DEFAULTS.stackable,`);
push(`        tradeable: r.tradeable ?? ITEM_DEFAULTS.tradeable,`);
push(`        members: r.members ?? ITEM_DEFAULTS.members,`);
push(`        dummy: r.dummy ?? ITEM_DEFAULTS.dummy,`);
push(`        destroyOnDeath: r.destroyOnDeath ?? ITEM_DEFAULTS.destroyOnDeath,`);
push(`        notedId: r.notedId ?? ITEM_DEFAULTS.notedId,`);
push(`        unnotedId: r.unnotedId ?? ITEM_DEFAULTS.unnotedId,`);
push(`    };`);
push(`}`);
push(``);
push(`// One row per obj, in id order. Fields equal to ITEM_DEFAULTS are omitted; \`cost\` and \`name\` are`);
push(`// always written so the table stays greppable by either. highAlch/lowAlch are NOT stored: they are`);
push(`// pure functions of cost, and storing ${OBJ_COUNT} pre-multiplied pairs would hide the formula above.`);
push(`//`);
push(`// ⛔ EVERY ROW IS WRAPPED IN materialize() RATHER THAN COLLECTED INTO A \`const ROWS: ItemRow[]\`.`);
push(`// A bare array literal of ${OBJ_COUNT} distinct object shapes makes tsc infer a ${OBJ_COUNT}-member union for the`);
push(`// element type and bail out with TS2590 ("union type that is too complex to represent") — an error in`);
push(`// a GENERATED file, which nobody can fix by editing it. Passing each literal through a function gives`);
push(`// it a contextual parameter type instead, so the array's element type is uniformly ItemValue.`);
push(``);
push(`/** Every obj, dense and indexed by id (ITEM_VALUES[${COINS}] is coins). */`);
push(`export const ITEM_VALUES: readonly ItemValue[] = [`);
const DEFAULTS = { alchable: true, stackable: false, tradeable: true, members: false, dummy: false, destroyOnDeath: false, notedId: -1, unnotedId: -1 };
for (const o of objs) {
    const isNote = o.certtemplate !== -1;
    const row = {
        alchable: o.alchable,
        stackable: o.stackable,
        tradeable: o.tradeable,
        members: o.members,
        dummy: o.dummyitem !== 0,
        destroyOnDeath: o.destroyOnDeath,
        notedId: isNote ? -1 : (o.certlink >= 0 ? o.certlink : -1),
        unnotedId: isNote ? o.certlink : -1,
    };
    const parts = [`id: ${o.id}`, `debugname: ${ts(o.debugname)}`, `name: ${o.name === null ? 'null' : ts(o.name)}`, `cost: ${o.cost}`];
    for (const [k, v] of Object.entries(row)) {
        if (v === DEFAULTS[k]) continue;
        parts.push(`${k}: ${typeof v === 'boolean' ? String(v) : v}`);
    }
    push(`    materialize({ ${parts.join(', ')} }),`);
}
push(`];`);
push(``);
push(`/** debugname -> entry. The stable key: display names are NOT unique (every note shares its base's). */`);
push(`export const ITEM_BY_NAME: ReadonlyMap<string, ItemValue> =`);
push(`    new Map(ITEM_VALUES.map(v => [v.debugname, v]));`);
push(``);
push(`/** Entry for an obj id, or null for an id outside the table (e.g. an empty inventory slot at -1). */`);
push(`export function itemValue(id: number): ItemValue | null {`);
push(`    return ITEM_VALUES[id] ?? null;`);
push(`}`);
push(``);
push(`/** Entry by content name, or null. */`);
push(`export function itemByName(debugname: string): ItemValue | null {`);
push(`    return ITEM_BY_NAME.get(debugname) ?? null;`);
push(`}`);
push(``);
push(`/** cost * count for one inventory slot, 0 for an unknown id. The building block of a carried-risk`);
push(` *  model: a PvE death drops the WHOLE backpack and worn set (death.rs2 inv_dropall x2). */`);
push(`export function stackValue(id: number, count: number): number {`);
push(`    const v = ITEM_VALUES[id];`);
push(`    return v ? v.cost * count : 0;`);
push(`}`);
push(``);
push(`/** The note of this obj, or the obj itself when it has none. Mirrors OC_CERT exactly. */`);
push(`export function notedForm(id: number): number {`);
push(`    const v = ITEM_VALUES[id];`);
push(`    return v && v.notedId >= 0 ? v.notedId : id;`);
push(`}`);
push(`/** The item this note is of, or the obj itself when it is not a note. Mirrors OC_UNCERT exactly. */`);
push(`export function unnotedForm(id: number): number {`);
push(`    const v = ITEM_VALUES[id];`);
push(`    return v && v.unnotedId >= 0 ? v.unnotedId : id;`);
push(`}`);
push(``);
push(`export interface AlchRefusal {`);
push(`    readonly id: number;`);
push(`    readonly debugname: string;`);
push(`    /** 'obj' = its own switch_obj arm, 'category' = oc_category, 'param' = the no_alchemy param */`);
push(`    readonly kind: 'obj' | 'category' | 'param';`);
push(`    /** the refusal the server actually prints */`);
push(`    readonly reason: string;`);
push(`}`);
push(``);
push(`/** Every obj [proc,is_alchable] refuses UNCONDITIONALLY (alchemy.rs2:71-113). ${ALCH_BLOCKED.length} of ${OBJ_COUNT}. */`);
push(`export const ALCH_BLOCKED: readonly AlchRefusal[] = [`);
for (const b of ALCH_BLOCKED) {
    push(`    { id: ${b.id}, debugname: ${ts(b.debugname)}, kind: ${ts(b.kind)}, reason: ${ts(b.reason)} },`);
}
push(`];`);
push(``);
push(`/** Refused only on a RUNTIME condition — you may alch these, but not your last one, because the spell`);
push(` *  needs the rune it is being cast on. They are \`alchable: true\` in the table on purpose. */`);
push(`export const ALCH_CONDITIONAL: readonly AlchRefusal[] = [`);
for (const c of ALCH_CONDITIONAL) {
    push(`    { id: ${c.id}, debugname: ${ts(c.debugname)}, kind: "obj", reason: ${ts(c.reason)} },`);
}
push(`];`);
push(``);
push(`/** The node's members flag as this table was generated. On a members=false node ObjType.parse()`);
push(` *  (ObjType.ts:59-73) additionally forces tradeable=false on every members obj (${f2pWouldClamp} of them here),`);
push(` *  clears their category, and deletes their autodisable params — so \`tradeable\` and \`alchable\` below`);
push(` *  would BOTH shift. Regenerate against that node before trusting this table there. */`);
push(`export const MEMBERS_WORLD = {`);
push(`    members: ${MEMBERS_WORLD.members},`);
push(`    source: ${ts(MEMBERS_WORLD.source)},`);
push(`    /** items that would become untradeable on an F2P node */`);
push(`    f2pWouldClamp: ${f2pWouldClamp},`);
push(`} as const;`);
push(``);
push(`/** Counts, so a regression in the extractor is visible without re-reading ${OBJ_COUNT} rows. */`);
push(`export const ITEM_TABLE_STATS = {`);
push(`    objs: ${OBJ_COUNT},`);
push(`    named: ${namedCount},`);
push(`    notes: ${notedCount},`);
push(`    stackable: ${objs.filter(o => o.stackable).length},`);
push(`    tradeable: ${objs.filter(o => o.tradeable).length},`);
push(`    members: ${objs.filter(o => o.members).length},`);
push(`    dummy: ${dummyClamped},`);
push(`    alchBlocked: ${ALCH_BLOCKED.length},`);
push(`    destroyOnDeath: ${objs.filter(o => o.destroyOnDeath).length},`);
push(`    costAboveDefault: ${objs.filter(o => o.cost !== 1).length},`);
push(`} as const;`);
push(``);

// ---- header LAST, so its counters cover every lookup above ---------------------------------------
const H = [];
H.push(`// GENERATED by headless/data/extract-item-values.mjs — DO NOT EDIT BY HAND.`);
H.push(`// Regenerate: bun server/webclient/headless/data/extract-item-values.mjs`);
H.push(`//`);
H.push(`// WHAT AN ITEM IS WORTH AND HOW IT BEHAVES — the per-obj economic table. Nothing in the SDK or the`);
H.push(`// headless stack modelled this before, which is why a death in transit could cost 20.4M without any`);
H.push(`// code being able to say so beforehand.`);
H.push(`//`);
H.push(`// PROVENANCE (nothing below was typed in):`);
H.push(`//   server/content/pack/obj.pack                    frozen obj id=name; the file the RuneScript`);
H.push(`//                                                   compiler resolves against (Compiler.ts:181)`);
H.push(`//   server/content/pack/{param,category}.pack       param + category id=name`);
H.push(`//   server/engine/data/pack/server/obj.dat          runtime SERVER half: tradeable(15) category(94)`);
H.push(`//                                                   dummyitem(96) certlink->note(97) params(249)`);
H.push(`//                                                   debugname(250)`);
H.push(`//   server/engine/data/pack/client/config -> obj.dat  runtime CLIENT half (bzip2 jagfile):`);
H.push(`//                                                   name(2) stackable(11) cost(12) members(16)`);
H.push(`//                                                   certlink->base(97) certtemplate(98)`);
H.push(`//   server/engine/data/pack/server/param.dat        runtime param table (id -> debugname)`);
H.push(`//   engine/src/cache/config/ObjType.ts:185-321      the field codes + toCertificate() + parse()`);
H.push(`//                                                   post-processing, replicated in load order`);
H.push(`//   engine/tools/pack/config/ObjConfig.ts:206-496   which half each field is written to`);
H.push(`//   skill_magic/scripts/spells/alchemy.rs2:25,61,71 the alch multipliers and every refusal`);
H.push(`//   player/scripts/death.rs2                        inv_dropall + destroy_drop/destroy_death`);
H.push(`//   engine/src/util/WorldConfig.ts:100,302          node.members (the F2P clamp switch)`);
H.push(`//`);
H.push(`// CROSS-CHECK, at generation time:`);
H.push(`//   * all ${OBJ_COUNT} obj ids agreed between obj.pack and the runtime server obj.dat debugname table`);
H.push(`//     (0 disagreements — the generator refuses to emit on even one)`);
H.push(`//   * the two halves of the obj table declared the same record count (${OBJ_COUNT})`);
H.push(`//   * ${paramLookups.length} param ids resolved from param.pack and verified against the runtime param.dat`);
H.push(`//   * note linkage is symmetric: ${notedCount} notes <-> ${notedCount} bases, every base points back, and 0 objs`);
H.push(`//     carry a certlink in BOTH halves (the OC_CERT/OC_UNCERT disambiguation is unambiguous)`);
H.push(`//`);
H.push(`// ⛔ data/symbols/*.sym IS NOT AUTHORITATIVE AND IS NOT USED HERE. It is a stale build OUTPUT; the`);
H.push(`// compiler reads pack/*.pack (Compiler.ts:181) and the engine loads data/pack/*. For this package the`);
H.push(`// difference is not academic — param.sym would have made every obj lookup read the wrong field:`);
if (paramSym.loaded) {
    H.push(`//   param.sym: ${paramSym.agree} of ${paramPack.byId.size} ids agree, ${paramSym.divergent} DIVERGE, ${paramSym.absent} absent.`);
    for (const p of paramLookups) {
        const symName = p.sym === null ? 'ABSENT' : `${p.sym} (= ${paramPack.byId.get(p.sym) ?? '?'})`;
        H.push(`//     ${p.name}: pack+runtime=${p.id}  sym=${symName}`);
    }
}
if (objSym.loaded) {
    H.push(`//   obj.sym:   ${objSym.agree} of ${objPack.byId.size} ids agree, ${objSym.divergent} diverge, ${objSym.absent} absent.`);
}
H.push(`//`);
H.push(`// ⛔ COST IS NOT A MARKET PRICE. It is ObjType.cost, and it is the ONLY number the engine scales the`);
H.push(`// economy off: alchemy (alchemy.rs2:25/61), shop buy+sell (shop.rs2:140/151 -> ~calc_shop_value with`);
H.push(`// the live %shop_haggle/%shop_buy/%shop_sell varps, which this table deliberately does NOT model),`);
H.push(`// and the PvP death keep-order (death.rs2 ~move_priciest_item_on_hero_to_death ranks by oc_cost).`);
H.push(`// It defaults to 1 when a config omits it, so cost===1 means "unpriced" far more often than it means`);
H.push(`// "one coin" — coins itself and blue_partyhat both sit at 1.`);
H.push(`//`);
H.push(`// ⛔ WHAT A DEATH ACTUALLY COSTS (player/scripts/death.rs2), for the carried-risk model:`);
H.push(`//   PvE  death_lose_items:      inv_dropall(inv) + inv_dropall(worn). NOTHING is kept. The entire`);
H.push(`//                               carried stack hits the ground for ^lootdrop_duration (200 ticks).`);
H.push(`//   PvP  pvp_death_lose_items:  ~move_priciest_item_on_hero_to_death x3 (0 if skulled) + 1 more with`);
H.push(`//                               Protect Item, ranked by oc_cost — i.e. \`cost\` IS the keep-order key.`);
H.push(`//   Either way, an obj with destroy_drop/destroy_death set is inv_delslot'd instead of dropped: it is`);
H.push(`//   DESTROYED, not lost to the floor, so it can never be picked back up. That is \`destroyOnDeath\`.`);
H.push(``);

const text = H.concat(L).join('\n');
if (STDOUT_ONLY) {
    process.stdout.write(text);
} else {
    fs.writeFileSync(OUT, text, 'utf8');
    console.log(`[item-extract] wrote ${path.relative(ROOT, OUT)} (${text.length} bytes)`);
    console.log(`[item-extract] ${OBJ_COUNT} objs; ${notedCount} notes; ${objs.filter(o => o.stackable).length} stackable; ` +
        `${objs.filter(o => !o.tradeable).length} untradeable; ${dummyClamped} dummy; ${ALCH_BLOCKED.length} alch-blocked`);
    console.log(`[item-extract] alch: high=${HIGH.num}/${HIGH.den} low=${LOW.num}/${LOW.den} floor=${ALCH_FLOOR} (parsed from alchemy.rs2)`);
    console.log(`[item-extract] obj.pack vs runtime obj.dat: ${OBJ_COUNT} ids checked, 0 disagreements`);
    if (paramSym.loaded) {
        console.log(`[item-extract] param.sym (ADVISORY, unused): ${paramSym.agree} agree / ${paramSym.divergent} divergent / ${paramSym.absent} absent`);
        for (const p of paramLookups) console.log(`[item-extract]   ${p.name}: pack+runtime=${p.id} sym=${p.sym ?? 'ABSENT'}`);
    }
    if (objSym.loaded) {
        console.log(`[item-extract] obj.sym (ADVISORY, unused): ${objSym.agree} agree / ${objSym.divergent} divergent / ${objSym.absent} absent`);
    }
    console.log(`[item-extract] members world: ${MEMBERS_WORLD.members} (${MEMBERS_WORLD.source}); ${f2pWouldClamp} items would clamp on F2P`);
}
