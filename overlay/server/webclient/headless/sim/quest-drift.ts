// QUEST FIXTURE DRIFT-CHECKER — extracts each quest's observable ITEM contract from the REAL RS2 npc
// scripts and diffs it against the runner's hand-transcribed fixture (quest-runner.ts QUESTS). This
// attacks the sim's documented honesty limit head-on: a quest fixture is a hand-transcription that can
// DRIFT from the script, and only a live smoke used to catch it (Rune Mysteries' live run found 3 such
// bugs). Now a fixture claim unbacked by the script fails OFFLINE.
//
// For each fixture step it verifies, against the npc's OWN script:
//   - expectItem  -> that npc's script must inv_add it   (the step claims the npc HANDS this item)
//   - consumeItem -> that npc's script must inv_del it   (the step claims the npc TAKES this item)
//   - the npcType must be handled by some script at all
// npc scripts are matched to type ids by their [opnpc*,<name>] handlers -> npc.sym (script FILE names
// differ from npc names, e.g. duke_horacio.rs2 handles npc `duke_of_lumbridge` = 741).
//
// It CANNOT prove quest COMPLETION (varp branching, dialog gating, order) — that residue still needs the
// one live smoke. It closes the biggest, most common drift: a wrong item/npc in the fixture.
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

const REPO = join(import.meta.dir, '../../../..');
const SCRIPTS = join(REPO, 'server/content/scripts');
const NPC_SYM = join(REPO, 'server/engine/data/symbols/npc.sym');
const OBJ_SYM = join(REPO, 'server/engine/data/symbols/obj.sym');

function loadSym(path: string): Map<string, number> {
    const m = new Map<string, number>();
    for (const line of readFileSync(path, 'utf8').split('\n')) {
        const t = line.indexOf('\t');
        if (t > 0) m.set(line.slice(t + 1).trim(), Number(line.slice(0, t)));
    }
    return m;
}

function walk(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p, out);
        else if (p.endsWith('.rs2')) out.push(p);
    }
    return out;
}

export interface NpcContract { adds: Set<number>; dels: Set<number>; names: Set<string> }

// Aggregate, per npc type id, the obj ids that npc's scripts inv_add / inv_del anywhere. A file is
// attributed to every npc it has an [opnpc*] handler for (RM's npc files each handle exactly one).
export function npcItemContract(): Map<number, NpcContract> {
    const npcId = loadSym(NPC_SYM), objId = loadSym(OBJ_SYM);
    const out = new Map<number, NpcContract>();
    for (const file of walk(SCRIPTS)) {
        const txt = readFileSync(file, 'utf8');
        const names = new Set([...txt.matchAll(/\[opnpc[0-9u]+,\s*([a-z0-9_]+)\s*\]/g)].map(m => m[1]!));
        if (!names.size) continue;
        const ids = [...names].map(n => npcId.get(n)).filter((v): v is number => v !== undefined);
        if (!ids.length) continue;
        const adds = new Set<number>(), dels = new Set<number>();
        for (const m of txt.matchAll(/inv_add\(\s*\w+\s*,\s*([a-z0-9_]+)/g)) { const id = objId.get(m[1]!); if (id !== undefined) adds.add(id); }
        for (const m of txt.matchAll(/inv_del\(\s*\w+\s*,\s*([a-z0-9_]+)/g)) { const id = objId.get(m[1]!); if (id !== undefined) dels.add(id); }
        for (const id of ids) {
            const e = out.get(id) ?? { adds: new Set<number>(), dels: new Set<number>(), names: new Set<string>() };
            for (const a of adds) e.adds.add(a);
            for (const d of dels) e.dels.add(d);
            for (const n of names) e.names.add(n);
            out.set(id, e);
        }
    }
    return out;
}

// ---- LOC CONTRACT (`[oplocu,<loc>]` / `[oploc<n>,<loc>]`) ------------------------------------------
// The npc contract above cannot see a step whose target is a LOC — the Cauldron of Thunder swaps four
// items and is not an npc at all. Same shape, keyed by loc id.
//
// ⛔ IDS COME FROM `pack/loc.pack`, NOT `symbols/loc.sym`. quest-state.ts audited the sym files and
// found them mostly-right for varps and 0-of-245 right for params; the compiler reads pack/*.pack.
// (npc.sym/obj.sym above predate that audit; they agree on everything this file looks up today.)
export interface LocContract { adds: Set<number>; dels: Set<number>; names: Set<string>; ops: Set<string> }
export function locItemContract(): Map<number, LocContract> {
    const objId = loadSym(OBJ_SYM);
    const locId = new Map<string, number>();
    for (const line of readFileSync(join(REPO, 'server/content/pack/loc.pack'), 'utf8').split('\n')) {
        const m = line.match(/^(\d+)=(\S+)/);
        if (m) locId.set(m[2]!, Number(m[1]!));
    }
    const out = new Map<number, LocContract>();
    for (const file of walk(SCRIPTS)) {
        const txt = readFileSync(file, 'utf8');
        const handlers = [...txt.matchAll(/\[(oploc[0-9u]+),\s*([a-z0-9_]+)\s*\]/g)];
        if (!handlers.length) continue;
        const adds = new Set<number>(), dels = new Set<number>();
        for (const m of txt.matchAll(/inv_add\(\s*\w+\s*,\s*([a-z0-9_]+)/g)) { const id = objId.get(m[1]!); if (id !== undefined) adds.add(id); }
        for (const m of txt.matchAll(/inv_del\(\s*\w+\s*,\s*([a-z0-9_]+)/g)) { const id = objId.get(m[1]!); if (id !== undefined) dels.add(id); }
        for (const [, op, name] of handlers) {
            const id = locId.get(name!); if (id === undefined) continue;
            const e = out.get(id) ?? { adds: new Set<number>(), dels: new Set<number>(), names: new Set<string>(), ops: new Set<string>() };
            for (const a of adds) e.adds.add(a);
            for (const d of dels) e.dels.add(d);
            e.names.add(name!); e.ops.add(op!);
            out.set(id, e);
        }
    }
    return out;
}

// ---- KILL CONTRACT (drop tables are bound by CATEGORY, not by npc name) ----------------------------
// `[ai_queue3,_cow]` is bound to the CATEGORY `cow`, which the npc config declares (`category=cow` in
// scripts/_unpack/*/all.npc). So proving "npc 81 drops raw_beef" is a two-hop join: npc id -> category
// -> the ai_queue3 script for that category -> its `obj_add(npc_coord, <obj>, ...)` lines. Only
// UNCONDITIONAL obj_adds are collected — a drop behind an `if`/`random` roll is NOT a guarantee and a
// fixture that treats it as one would hang forever on a bad-luck streak.
export function npcDropContract(): Map<number, { objs: Set<number>; category: string }> {
    const npcId = loadSym(NPC_SYM), objId = loadSym(OBJ_SYM);
    // npc debugname -> category, from every .npc config in the tree
    const catOf = new Map<string, string>();
    (function walkNpc(dir: string) {
        for (const name of readdirSync(dir)) {
            const p = join(dir, name);
            if (statSync(p).isDirectory()) { walkNpc(p); continue; }
            if (!p.endsWith('.npc')) continue;
            let cur: string | null = null;
            for (const line of readFileSync(p, 'utf8').split('\n')) {
                const b = line.match(/^\[(\S+)\]/); if (b) { cur = b[1]!; continue; }
                const c = line.match(/^category=(\S+)/); if (c && cur) catOf.set(cur, c[1]!);
            }
        }
    })(SCRIPTS);
    // category -> unconditionally dropped objs, from the `[ai_queue3,_<category>]` death script
    const dropsOf = new Map<string, Set<number>>();
    for (const file of walk(SCRIPTS)) {
        const txt = readFileSync(file, 'utf8');
        for (const m of txt.matchAll(/\[ai_queue3,\s*_([a-z0-9_]+)\s*\]([\s\S]*?)(?=\n\[|$)/g)) {
            const cat = m[1]!, body = m[2]!;
            const set = dropsOf.get(cat) ?? new Set<number>();
            for (const line of body.split('\n')) {
                if (/^\s*(if|else|while|})/.test(line)) continue;          // conditional -> not a guarantee
                const d = line.match(/obj_add\(\s*npc_coord\s*,\s*([a-z0-9_]+)/);
                if (d) { const id = objId.get(d[1]!); if (id !== undefined) set.add(id); }
            }
            dropsOf.set(cat, set);
        }
    }
    const out = new Map<number, { objs: Set<number>; category: string }>();
    for (const [name, cat] of catOf) {
        const id = npcId.get(name); const objs = dropsOf.get(cat);
        if (id === undefined || !objs) continue;
        out.set(id, { objs, category: cat });
    }
    return out;
}

export interface FixtureStep {
    npcType?: number; npcTypes?: number[]; op?: string;
    loc?: { x: number; z: number; id: number; op?: number };
    expectItem?: number; consumeItem?: number; useItem?: number; label?: string;
}
export type DriftKind = 'no-npc-script' | 'missing-add' | 'missing-del' | 'no-loc-script' | 'no-drop-table' | 'missing-drop' | 'malformed-step';
export interface DriftIssue { step: string; npc: number; kind: DriftKind; item?: number; detail: string }

export function checkFixture(steps: FixtureStep[], contract = npcItemContract(),
    locs?: Map<number, LocContract>, drops?: Map<number, { objs: Set<number>; category: string }>): DriftIssue[] {
    const issues: DriftIssue[] = [];
    for (const s of steps) {
        const label = s.label ?? `npc ${s.npcType} ${s.op ?? ''}`.trim();

        // LOC steps: the target is a loc id, and its script must exist (and, for a use-item step, must
        // actually swap the items the fixture claims).
        if (s.op === 'useloc' || s.op === 'oploc') {
            if (!s.loc) { issues.push({ step: label, npc: -1, kind: 'malformed-step', detail: `op '${s.op}' with no loc` }); continue; }
            const lc = (locs ??= locItemContract()).get(s.loc.id);
            if (!lc) { issues.push({ step: label, npc: -1, kind: 'no-loc-script', detail: `no RS2 script handles loc ${s.loc.id}` }); continue; }
            if (s.op === 'useloc' && !lc.ops.has('oplocu'))
                issues.push({ step: label, npc: -1, kind: 'no-loc-script', detail: `loc ${s.loc.id} [${[...lc.names]}] has no [oplocu,...] handler — a use-item step cannot work` });
            if (s.expectItem !== undefined && !lc.adds.has(s.expectItem))
                issues.push({ step: label, npc: -1, kind: 'missing-add', item: s.expectItem, detail: `fixture EXPECTS item ${s.expectItem} from loc ${s.loc.id} [${[...lc.names]}], but its script never inv_adds it` });
            if (s.useItem !== undefined && !lc.dels.has(s.useItem))
                issues.push({ step: label, npc: -1, kind: 'missing-del', item: s.useItem, detail: `fixture USES item ${s.useItem} on loc ${s.loc.id} [${[...lc.names]}], but its script never inv_dels it` });
            continue;
        }

        // KILL steps: every listed npc type must have a drop table that GUARANTEES the expected item.
        if (s.op === 'kill') {
            const types = s.npcTypes ?? (s.npcType !== undefined ? [s.npcType] : []);
            if (!types.length) { issues.push({ step: label, npc: -1, kind: 'malformed-step', detail: `op 'kill' with no npc types` }); continue; }
            drops ??= npcDropContract();
            for (const t of types) {
                const d = drops.get(t);
                if (!d) { issues.push({ step: label, npc: t, kind: 'no-drop-table', detail: `npc ${t} has no category-bound [ai_queue3,_<category>] drop table` }); continue; }
                if (s.expectItem !== undefined && !d.objs.has(s.expectItem))
                    issues.push({ step: label, npc: t, kind: 'missing-drop', item: s.expectItem, detail: `fixture expects obj ${s.expectItem} off npc ${t} (category '${d.category}'), but that table never unconditionally obj_adds it` });
            }
            continue;
        }

        // NPC talk/use steps (the original contract).
        if (s.npcType === undefined) { issues.push({ step: label, npc: -1, kind: 'malformed-step', detail: `op '${s.op ?? 'talk'}' with no npcType` }); continue; }
        const c = contract.get(s.npcType);
        if (!c) { issues.push({ step: label, npc: s.npcType, kind: 'no-npc-script', detail: `no RS2 script handles npc ${s.npcType}` }); continue; }
        if (s.expectItem !== undefined && !c.adds.has(s.expectItem))
            issues.push({ step: label, npc: s.npcType, kind: 'missing-add', item: s.expectItem, detail: `fixture EXPECTS item ${s.expectItem} from npc ${s.npcType} [${[...c.names]}], but its script never inv_adds it` });
        if (s.consumeItem !== undefined && !c.dels.has(s.consumeItem))
            issues.push({ step: label, npc: s.npcType, kind: 'missing-del', item: s.consumeItem, detail: `fixture CONSUMES item ${s.consumeItem} at npc ${s.npcType} [${[...c.names]}], but its script never inv_dels it` });
    }
    return issues;
}

// ---- CLI: check every known quest fixture ----------------------------------------------------------
if (import.meta.main) {
    const { QUESTS } = await import('../quest-runner.ts');
    const contract = npcItemContract();
    let total = 0;
    for (const [name, steps] of Object.entries(QUESTS)) {
        const issues = checkFixture(steps as FixtureStep[], contract);
        total += issues.length;
        console.log(`\n${name}: ${issues.length ? `⚠ ${issues.length} DRIFT` : '✅ no drift'} (${(steps as unknown[]).length} steps)`);
        for (const i of issues) console.log(`  [${i.kind}] ${i.step} — ${i.detail}`);
    }
    console.log(total ? `\n⚠ ${total} fixture claim(s) not backed by a script — a quest transcription has DRIFTED.` : '\nAll quest fixtures match their RS2 scripts.');
    process.exit(total ? 1 : 0);
}
