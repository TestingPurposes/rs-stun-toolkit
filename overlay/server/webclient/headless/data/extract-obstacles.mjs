#!/usr/bin/env bun
// =====================================================================================================
// OBSTACLE-TABLE EXTRACTOR — "what does it take to get THROUGH this loc?"
// =====================================================================================================
// Emits `headless/data/obstacles.json`: for every OPERABLE loc type in the game, the list of
// REQUIREMENTS its op-handler imposes before it lets a player through, derived from the engine's own
// content scripts. Nothing here is a field note; every rule cites the file:line it came from.
//
// Run:  cd server/webclient && bun headless/data/extract-obstacles.mjs [--report]
//
// -----------------------------------------------------------------------------------------------------
// WHY THIS EXISTS
// -----------------------------------------------------------------------------------------------------
// Bots can sit on the Al Kharid toll gate's operable tile (3268,3227) indefinitely while their connection
// status reads healthy. `navgrid` masks that gate as an ordinary door, so it plans a route straight
// THROUGH a toll the bot then declines over and over, even while holding enough coins for the 10 gp
// fare. The router can answer "is there a path?"; nothing could answer "can THIS BOT walk
// it?". This table is the data half of that second answer (see headless/route-feasibility.ts).
//
// -----------------------------------------------------------------------------------------------------
// SOURCES (cite these; they are the authority)
// -----------------------------------------------------------------------------------------------------
//  loc id -> internal name   server/content/pack/loc.pack        ("<id>=<internal>")
//  obj id -> internal name   server/content/pack/obj.pack
//  loc type fields           server/content/scripts/**/*.loc     (4671 sections: name/category/opN/
//                            blockwalk/active/width/length/param)
//  op handlers               server/content/scripts/**/*.rs2     `[oplocN,<subject>]`, where subject is
//                            either an internal loc name or `_<category>` (leading underscore = a
//                            CATEGORY binding, e.g. `[oploc1,_locked_gate]` covers every loc whose
//                            config says `category=locked_gate`).
//  quest vars                server/content/scripts/quests/**/configs/*.varp  — a `%var` declared under
//                            quests/ is a QUEST var; the containing `quest_<name>` dir names the quest.
//  quest stage constants     server/content/scripts/quests/**/configs/*.constant  (`^prince_saved = 100`)
//  collision gating          server/engine/src/engine/GameMap.ts:280 — a loc only paints collision at
//                            all `if (type.blockwalk)`. So `blockwalk=no` locs can never be obstacles.
//
// -----------------------------------------------------------------------------------------------------
// HOW A HANDLER IS CLASSIFIED
// -----------------------------------------------------------------------------------------------------
// The handler body is INLINED first: `@label` jumps and `~proc` calls are substituted (depth 4, with
// positional argument substitution) because the gate is routinely one hop away from the op —
// `[oploc1,pip_underground_door1] ~check_priest_peril_gate(^priestperil_find_drezel_key);` puts the
// entire quest test inside a shared proc, and border_gate.rs2 needs TWO label hops to reach its
// `inv_del(inv, coins, 10)`.
//
// Then requirement markers are matched against the inlined text:
//   payment   inv_del(inv, coins, N)          areas/area_alkharid/scripts/border_gate.rs2:53
//   item      inv_total(inv|worn, <obj>)      areas/area_ardougne_west/scripts/doors.rs2:2 (doctor_gown)
//   key       last_useitem = <obj> in the [oplocu] handler of a door whose [oploc] only says "locked"
//                                             quests/quest_dragon/scripts/melzars_maze.rs2:13 (melzarkey)
//   level     stat(<skill>) < N               skill_agility/scripts/shortcuts.rs2:17 (agility 5)
//   quest     %<questvar> [>=|=|<] ^<stage>   areas/area_mausoleum/scripts/gates.rs2:6 (%priestperil)
//             ⛔ POLARITY-CORRECTED — the comparison emitted is the one the BOT must satisfy, which is the
//             opposite of the text whenever the test guards a refusal. See CONTROL-FLOW POLARITY below.
//   progress  the same shape on a non-quest progress varp (%tutorial)
//                                             tutorial/scripts/tut_doors_and_gates.rs2:22
//   puzzle    testbit(%var, N) — a lever/latch combination nothing can supply, so the loc is UNKNOWN
//                                             quests/quest_haunted/scripts/quest_haunted.rs2:167
//   members   map_members = ^false            areas/area_varrock/scripts/east_gate.rs2:4
//   locked    a mes()/mesbox()/~chatnpc() saying so AND no pass primitive anywhere in the body
//                                             general_use/scripts/locked_doors.rs2 (loc_1591)
//   deadclick a `switch_coord (loc_coord)` whose default arm is @unhandled_stairs/@unhandled_ladder —
//             a content-author sentinel that prints a debug line and MOVES NOBODY
//                                             ladders+stairs/scripts/stairs.rs2:493
//
// ⛔ THE DEFAULT IS `unknown`, NEVER `passable`. A handler is only called PASSABLE when it contains a
// recognised pass primitive AND no gate marker at all. Under-reporting a blocker is the exact failure
// this package exists to prevent, so an unrecognised handler must say so out loud.
//
// -----------------------------------------------------------------------------------------------------
// ⛔ COORD-SCOPED HANDLERS — WHY A LOC TYPE IS NOT THE UNIT OF TRUTH
// -----------------------------------------------------------------------------------------------------
// `[oploc1,loc_1747]` (the generic "Ladder / Climb-up", 147 placements including one in Ardougne
// ladder) is:
//
//     switch_coord (loc_coord) {
//         case 0_40_53_10_49 : @ladder_to_dwarf_remains;   // ONE placement, and it is quest-gated
//         case default       : ~climb_ladder(...);          // the other 146, unconditionally
//     }
//
// A whole-body text match attributed the Dwarf Cannon quest test to the TYPE, so the table said every
// one of those ladders was NEEDS_QUEST — a false blocker on some of the most-walked routes in the game.
// The same construct fails the other way for the generic staircases (loc_1722/1723/1738/1740/...): their
// default arm is `@unhandled_stairs`, i.e. a WHITELIST — the type is only usable at the coords the script
// enumerates, and a placement that is not on the list is a SILENT dead click. A whole-body match called
// those `passable`, which is the dangerous direction.
//
// So a `switch_coord (loc_coord)` handler is split into per-COORD cases plus a default path
// (prefix + `case default` body + any code after the switch), each classified independently, and emitted
// as `op.coordCases[]` / `op.coordDefault`. `route-feasibility.ts` has the PLACED loc's coords and picks
// the arm that actually runs. `op.reqs` stays the whole-handler UNION so existing consumers
// (`extract-quests.mjs` reads `ops[].reqs[]`) see exactly what they saw before.
//
// -----------------------------------------------------------------------------------------------------
// WAIVERS
// -----------------------------------------------------------------------------------------------------
// border_gate.rs2:28 tests `%princequest >= ^prince_saved` and, if true, passes for FREE before the fare
// is ever mentioned. A quest test that (a) precedes a payment in the inlined body and (b) has a pass
// primitive inside its own braces is recorded as `waivedBy` on that payment, so a bot that finished the
// quest is not told it needs coins it does not need.
// =====================================================================================================

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../../..');          // <old checkout>
const CONTENT = path.join(ROOT, 'server', 'content');
const PACK_DIR = path.join(CONTENT, 'pack');
const SCRIPTS_DIR = path.join(CONTENT, 'scripts');
/**
 * `OBSTACLES_OUT=<path>` redirects the emitted table.
 *
 * The reproducibility test uses it to regenerate into a TEMP file and diff, instead of overwriting the
 * checked-in one while `extract-quests.mjs` (which READS obstacles.json) may be running in a sibling
 * test file. Same generator, same inputs, no shared mutable file.
 */
const OUT_FILE = process.env.OBSTACLES_OUT
    ? path.resolve(process.env.OBSTACLES_OUT)
    : path.join(HERE, 'obstacles.json');

// -----------------------------------------------------------------------------------------------------
// generic file walking
// -----------------------------------------------------------------------------------------------------

/** Every file under `dir` ending in `ext`, in a stable (sorted) order so builds are reproducible. */
function collect(dir, ext, out = []) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name < b.name ? -1 : 1)) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) collect(p, ext, out);
        else if (e.name.endsWith(ext)) out.push(p);
    }
    return out;
}

/** `<id>=<internal name>` per line. Same format for loc/npc/obj. */
function loadPack(file) {
    const byId = new Map();
    const byName = new Map();
    for (const line of fs.readFileSync(path.join(PACK_DIR, file), 'ascii').split('\n')) {
        const eq = line.indexOf('=');
        if (eq === -1) continue;
        const id = parseInt(line.slice(0, eq));
        if (!Number.isFinite(id)) continue;
        const name = line.slice(eq + 1).trim();
        byId.set(id, name);
        if (!byName.has(name)) byName.set(name, id);
    }
    return { byId, byName };
}

// -----------------------------------------------------------------------------------------------------
// .loc configs
// -----------------------------------------------------------------------------------------------------

/**
 * internal name -> { name, category, ops[5], blockwalk, active, width, length, params }.
 * Merged across all 128 .loc files with LAST-WINS, matching headless/loc-scene.ts's loadConfigs so the
 * two modules can never disagree about what a loc is.
 */
function loadLocConfigs() {
    const out = new Map();
    for (const file of collect(SCRIPTS_DIR, '.loc')) {
        let cur = null;
        for (const raw of fs.readFileSync(file, 'utf8').split('\n')) {
            const line = raw.trim();
            if (!line || line.startsWith('//')) continue;
            if (line.startsWith('[') && line.endsWith(']')) {
                cur = {
                    internal: line.slice(1, -1),
                    name: '', category: '', ops: [null, null, null, null, null],
                    blockwalk: true, active: -1, width: 1, length: 1, params: {},
                };
                out.set(cur.internal, cur);
                continue;
            }
            if (!cur) continue;
            const eq = line.indexOf('=');
            if (eq === -1) continue;
            const k = line.slice(0, eq).trim();
            const v = line.slice(eq + 1).trim();
            if (k === 'name') cur.name = v;
            else if (k === 'category') cur.category = v;
            else if (k === 'blockwalk') cur.blockwalk = v !== 'no';
            else if (k === 'active') cur.active = v === 'yes' ? 1 : v === 'no' ? 0 : parseInt(v);
            else if (k === 'width') cur.width = parseInt(v) || 1;
            else if (k === 'length') cur.length = parseInt(v) || 1;
            else if (/^op[1-5]$/.test(k)) cur.ops[+k[2] - 1] = v;
            else if (k === 'param') {
                const c = v.indexOf(',');
                if (c > 0) cur.params[v.slice(0, c).trim()] = v.slice(c + 1).trim();
            }
        }
    }
    return out;
}

// -----------------------------------------------------------------------------------------------------
// .rs2 blocks
// -----------------------------------------------------------------------------------------------------

/**
 * Drop a `//` line comment, but ONLY outside a string literal.
 *
 * ⛔ LOAD-BEARING. Without it `melzardoor` reports PASSABLE: its handler prints "The door is securely
 * locked." and then carries a COMMENTED-OUT `// ~open_and_close_door(poordoor, $entering, false);`
 * (quests/quest_dragon/scripts/melzars_maze.rs2:11) which satisfies PASS_PRIMITIVE. A dead line of text
 * was unlocking a locked door — exactly the under-reported-blocker failure this package exists to stop.
 *
 * The string check is not paranoia either: the content routinely parks a `// https://...` citation at
 * the end of a line, and several `mes(...)` strings contain `/`.
 */
function stripLineComment(line) {
    let inStr = false;
    for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (c === '\\') { i++; continue; }
        if (c === '"') { inStr = !inStr; continue; }
        if (!inStr && c === '/' && line[i + 1] === '/') return line.slice(0, i);
    }
    return line;
}

/**
 * Split every .rs2 into `[<trigger>,<subject>]` blocks. A block runs from its header to the next line
 * that starts with `[`; an inline body on the header line itself (`[oploc1,x] @foo;`) is kept.
 *
 * Comments are stripped FIRST (see stripLineComment) so no matcher below can ever fire on dead text.
 */
function loadScripts() {
    const blocks = [];
    for (const file of collect(SCRIPTS_DIR, '.rs2')) {
        const rel = path.relative(ROOT, file).replace(/\\/g, '/');
        const lines = fs.readFileSync(file, 'utf8').split('\n').map(stripLineComment);
        let cur = null;
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const m = /^\[([a-z_0-9]+),([^\]]+)\]/.exec(line);
            if (m) {
                if (cur) blocks.push(cur);
                // A proc/label may declare params: `[proc,foo](int $a, coord $b)(int)`.
                const after = line.slice(m[0].length);
                const params = [];
                const pm = /^\(([^)]*)\)/.exec(after);
                if (pm) for (const p of pm[1].split(',')) {
                    const v = /\$([a-z_0-9]+)/i.exec(p);
                    if (v) params.push('$' + v[1]);
                }
                cur = {
                    trigger: m[1], subject: m[2].trim(), file: rel, line: i + 1,
                    params, body: pm ? after.slice(pm[0].length) : after,
                };
                continue;
            }
            if (cur) cur.body += '\n' + line;
        }
        if (cur) blocks.push(cur);
    }
    return blocks;
}

// -----------------------------------------------------------------------------------------------------
// inlining
// -----------------------------------------------------------------------------------------------------

/**
 * Procs whose bodies are pure presentation. Inlining them adds tens of KB of dialogue per handler and
 * can only produce false matches (a `~chatnpc("...locked...")` inside a shop script is not a gate).
 */
// `open_and_close*` is on this list for a different reason than the rest: its bodies hold no gate at all
// (doors/scripts/open_and_close_doors.rs2:9 is an unconditional teleport-and-swap-the-loc), and NOT
// inlining them leaves the PROC NAME in the text — which is the only unambiguous "a door just opened"
// token there is. Inlined, all that survives is a bare `loc_change`, and `loc_change` is also what a
// script writes when it CLOSES something behind you (quest_zombiequeen.rs2:182 puts the trees back).
// `agility_exactmove` is here for the same reason as `open_and_close`: inlined, all that survives is a
// bare `p_exactmove`, and `p_exactmove` is ALSO what a knockback uses — ikov_dungeon.rs2:214 is the fire
// warrior blasting the player one tile BACKWARDS. Keeping the wrapper's name is the difference between
// "squeezed through the railing" and "got hit".
//
// The `set_tutorial_progress` / `tutorial_step` / `send_quest_progress` / `update_questlist` /
// `count_questpoints` family is JOURNAL PAINT. `[proc,count_questpoints]` (general/scripts/quests.rs2:61)
// reads EVERY quest varp in the game to add up quest points; inlining it into a tutorial door dropped
// 57 unrelated quest comparisons into that door's requirement list, so `newbie_door2` claimed to need
// Shield of Arrav. They write interface state and never move anybody.
const NOISE = /^(chat|mes|p_choice|obj_|sound|anim|update_bas|bas_set|set_readywalk|coord_tostring|loc_shape_debug|random|total_distance|check_axis|door_open|door_close|movecoord|open_and_close|agility_exactmove|set_tutorial_progress|tutorial_step|send_quest_progress|update_questlist|count_questpoints|initalltabs)/;

/**
 * Inlining budget, in characters.
 *
 * ⛔ IT WAS 24_000 AND THAT SILENTLY TRUNCATED EIGHT TUTORIAL HANDLERS. `[oploc1,_tutorial_gate]`
 * (tutorial/scripts/tut_doors_and_gates.rs2:21) pulls in `~tut_island_survial_gate` and
 * `~set_tutorial_progress`, blows the budget, and the `p_teleport` at the END of the handler — the only
 * pass primitive it has — was cut off. Six tutorial gates and two tutorial ladders therefore read
 * `unknown` because the generator stopped reading, not because the content was unreadable.
 *
 * Truncation is also DANGEROUS for the control-flow polarity pass below: a chopped body loses the
 * continuation a branch falls through into, which turns a pass branch into a refusal. So the limit is
 * raised AND a truncated body now says so out loud (`TRUNCATION_MARK`) instead of being classified as if
 * it were complete.
 */
const MAX_INLINE = 400_000;

/** Appended by `inline()` when it gave up. `classify` degrades a truncated body to UNKNOWN. */
const TRUNCATION_MARK = '\n/*!inline-truncated*/\n';
const wasTruncated = (text) => text.includes('/*!inline-truncated*/');

/** Substitute a proc/label's positional arguments into its body: `$required_progress` -> `^stage`. */
function substitute(body, params, argText) {
    if (!params.length || !argText) return body;
    const args = splitArgs(argText);
    let out = body;
    for (let i = 0; i < params.length && i < args.length; i++) {
        out = out.split(params[i]).join(args[i].trim());
    }
    return out;
}

/** Split a call's argument text on top-level commas (so `movecoord(a, 1, 0)` stays one argument). */
function splitArgs(text) {
    const out = [];
    let depth = 0, start = 0;
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (c === '(') depth++;
        else if (c === ')') depth--;
        else if (c === ',' && depth === 0) { out.push(text.slice(start, i)); start = i + 1; }
    }
    out.push(text.slice(start));
    return out;
}

/** Read the parenthesised argument text starting at `open` (the index of the `(`). */
function readCall(text, open) {
    let depth = 0;
    for (let i = open; i < text.length; i++) {
        if (text[i] === '(') depth++;
        else if (text[i] === ')') { depth--; if (depth === 0) return { args: text.slice(open + 1, i), end: i + 1 }; }
    }
    return null;
}

/**
 * Expand `@label` / `~proc` references in place. Depth-limited and cycle-guarded; the resolved text is
 * what every requirement matcher below runs against.
 *
 * Kept TEXTUAL on purpose: a real interpreter for RuneScript is a much larger thing than this problem
 * needs, and the failure mode of a textual pass is "I do not recognise this" (-> unknown), which is the
 * outcome we want anyway. A partial interpreter's failure mode would be a confident wrong answer.
 */
function inline(text, byLabel, byProc, depth = 0, seen = new Set()) {
    if (depth >= 4) return text;
    if (text.length > MAX_INLINE) return text + TRUNCATION_MARK;
    // `jump(<label>)` is a CONTROL TRANSFER, not a call: the label's body replaces the rest of the
    // script. Treating it as `@<label>` is what lets the dialogue-driven gates (the `~multiN` helpers
    // hand their chosen label to `jump`) reach the pass primitive that actually opens the thing.
    text = text.replace(/\bjump\s*\(\s*([a-z_0-9]+)\s*\)/g, '@$1');
    let out = '';
    let i = 0;
    while (i < text.length) {
        const c = text[i];
        if (c !== '@' && c !== '~') { out += c; i++; continue; }
        const m = /^[@~]([a-z_0-9]+)/i.exec(text.slice(i));
        if (!m) { out += c; i++; continue; }
        const name = m[1];
        let argText = '', end = i + m[0].length;
        if (text[end] === '(') {
            const call = readCall(text, end);
            if (call) { argText = call.args; end = call.end; }
        }
        const target = c === '@' ? byLabel.get(name) : byProc.get(name);
        if (!target || seen.has(c + name) || NOISE.test(name)) { out += text.slice(i, end); i = end; continue; }
        const next = new Set(seen); next.add(c + name);
        out += '\n/*<' + name + '>*/\n'
            + inline(substitute(target.body, target.params, argText), byLabel, byProc, depth + 1, next)
            + '\n/*</' + name + '>*/\n';
        i = end;
        if (out.length > MAX_INLINE) return out + TRUNCATION_MARK;
    }
    return out;
}

// -----------------------------------------------------------------------------------------------------
// requirement matchers
// -----------------------------------------------------------------------------------------------------

/**
 * A body that does one of these things can actually move a player through something.
 *
 * `p_exactmove` IS ON THIS LIST AND ITS ABSENCE WAS A REAL DEFECT. `~agility_exactmove` is a PROC, so
 * `inline()` REPLACES the call text with the proc's body (skill_agility/scripts/agility.rs2:94) — the
 * literal `~agility_exactmove` no longer exists in the text a matcher sees, and the primitive the body
 * actually uses is `p_exactmove`. Both loose-railing squeezes (mcgrubors_wood.rs2:12,
 * gnomevillage_fence.rs2:1) read `unknown` purely because the pass primitive was named by its wrapper.
 */
const PASS_PRIMITIVE =
    /~open_and_close_\w+|p_teleport|p_telejump|~forcemove|~forcewalk\w*|~agility_exactmove|loc_add|loc_change|loc_del|~climb|@enter_|@pass_|@climb|@open_/;

/**
 * ⛔ THE STRICTER EVIDENCE THE POLARITY PASS USES, AND WHY IT IS NOT `PASS_PRIMITIVE`.
 *
 * `loc_add` / `loc_change` / `loc_del` are in `PASS_PRIMITIVE` because a door opening IS a loc change,
 * and for a whole-handler verdict "this body changes a loc" is decent evidence that it lets you through.
 * They are USELESS as branch evidence, because content writes exactly the same three commands to shut
 * something: `[label,enter_rash_tomb]` (quest_zombiequeen.rs2:181) answers "you have not unlocked the
 * tomb" with `loc_change(zq_doorblock_jungle1, ...)` — the jungle trees springing BACK over the doors.
 * Counting that as "this branch passes" made the refusal look like a free pass and dropped the quest
 * requirement, i.e. a false PASSABLE on a door that is shut.
 *
 * So a BRANCH only counts as passing on evidence that the player moved, or that a door/gate proc ran by
 * name (which is why `open_and_close*` is not inlined — see NOISE). Anything weaker leaves the gate
 * recorded, which is the safe direction: an over-strict requirement is a probe, a dropped one is a wall.
 */
const STRONG_PASS =
    /~open_and_close_\w+|p_teleport|p_telejump|~forcemove|~forcewalk\w*|~agility_exactmove|~climb\w*|@enter_|@pass_|@climb|@open_/;

/** Ambiguous evidence: a loc changed. It might have been a door opening, or a door closing behind you. */
const WEAK_PASS = /loc_add|loc_change|loc_del/;

/**
 * How sure are we that taking this path gets the player through?
 *
 *   yes    a STRONG_PASS runs UNCONDITIONALLY on this path (at the path's own brace depth 0)
 *   maybe  a STRONG_PASS is in there, but only inside a nested `if` this table cannot evaluate
 *   no     nothing that moves a player is on this path at all
 *
 * ⛔ THE MIDDLE ONE IS THE WHOLE POINT. `[label,open_legends_gate]` (quest_legends/legends_gate.rs2:17)
 * answers "quest not started" with a door-opening call — but nested inside `if ($entering = false)`, so
 * it opens the gate for someone LEAVING and refuses someone entering. A two-state yes/no read called
 * that branch "passes", concluded the quest test decided nothing, and dropped it: the Legends Guild gate
 * came back PASSABLE for an account that had never heard of the quest. With three states the same gate
 * lands on "having STARTED the quest is SUFFICIENT; not having started is UNKNOWN", which is exactly what
 * the script says.
 */
function passLevel(text) {
    // ⛔ `loc_*` ALONE IS NEVER `yes`, AND NEVER `no` EITHER. `[label,open_rash_tombdoor]`
    // (quest_zombiequeen.rs2:194) opens the Rashiliyia tomb with nothing but two `loc_change` calls and
    // a "the doors creak open" message — no teleport, the player just walks through the replaced loc. So
    // treating a bare loc change as "did not pass" INVERTS that gate (it recorded "you may pass only
    // BEFORE unlocking the tomb"). Treating it as "did pass" is the zombiequeen trees-spring-back bug in
    // the other direction. `maybe` is the honest reading of an ambiguous primitive: it is enough to stop
    // a NECESSITY claim from inverting, and not enough to DROP a requirement.
    if (!STRONG_PASS.test(text)) return WEAK_PASS.test(text) ? 'maybe' : 'no';
    let out = '', d = 0;
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (c === '{') { d++; continue; }
        if (c === '}') { if (d > 0) d--; continue; }
        if (d === 0) out += c;
    }
    return STRONG_PASS.test(out) ? 'yes' : 'maybe';
}

/**
 * Wording the content uses when a loc is simply never going to open.
 *
 * The list is WIDER than the obvious "is locked" because the content authors phrase the same fact a
 * dozen ways, and the ONLY consequence of missing one is an `unknown` where an `impassable` was provable
 * — plus, since `impassable` needs `!PASS_PRIMITIVE`, widening this can never manufacture a PASSABLE.
 * `~chatnpc`/`~chatplayer` are accepted as carriers too: `[oploc1,_mcgrubor_gate]` refuses through the
 * forester's mouth (`"Hey! You can't come through here!"`), not through `mes()`.
 */
const LOCKED_MES = new RegExp(
    '(?:mes|mesbox|~mesbox|~chatnpc|~chatnpc_specific|~chatplayer|~objbox)\\s*\\([^"]*"[^"]*(?:' + [
        'is locked', 'seems? to be (?:pretty )?locked', 'appears? to be locked', 'locked tight',
        'locked shut', 'locked securely', 'securely locked', 'is securely', 'doesn\'t seem to open',
        'does not seem to open', 'won\'t open', 'will not open', 'won\'t budge', 'will not budge',
        'can\'t open', 'cannot open', 'is stuck', 'jammed', 'is broken, i can\'t',
        'can\'t come through', 'cannot come through', 'can only enter under',
        'cannot pass', 'can\'t pass', 'shall not pass', 'will not pass',
        'cannot enter', 'can\'t enter', 'no one enters', 'no-one enters',
        'need to (?:talk|speak) to', 'needs? to find another way', 'find another way in',
        'restricted area', 'you are not allowed', 'you\'re not allowed', 'not allowed to proceed',
    ].join('|') + ')', 'i');

const SKILLS = 'attack|defence|strength|hitpoints|ranged|prayer|magic|cooking|woodcutting|fletching|fishing|firemaking|crafting|smithing|mining|herblore|agility|thieving|runecraft';

// =====================================================================================================
// ⛔ CONTROL-FLOW POLARITY — "is this recorded condition the REQUIREMENT, or the REFUSAL?"
// =====================================================================================================
// A recorded test says NOTHING on its own about what a bot must do. These two doors are six lines apart
// in the SAME FILE and their conditions are exact opposites of each other while meaning the same thing:
//
//   quests/quest_mcannon/scripts/locs/mcannon_doors.rs2:3
//       if (%mcannon <  ^mcannon_tasked_with_speaking_to_nulodion) { mes("The door is locked."); }
//       else { @open_dwarf_cannon_door; }                       -> the bot must reach the stage: `>=`
//   quests/quest_mcannon/scripts/locs/mcannon_doors.rs2:11
//       if (%mcannon >= ^mcannon_tasked_with_fixing_cannon) { @open_dwarf_cannon_door; }
//       else { mes("The door is locked."); }                    -> the bot must reach the stage: `>=`
//
// Recording the comparison as written and reading it as "the condition the bot must MEET" gets the FIRST
// one exactly backwards: it says a bot passes while its progress is BELOW the threshold, i.e. it tells a
// fresh account the locked door is open and a finished account that it is shut. That is a false PASSABLE
// on every refusal-shaped gate, which is the dangerous direction.
//
// So a condition is classified by WHICH BRANCH IT GUARDS, from the engine's own control flow:
//
//   * the if/else-if/else CHAIN around the condition is parsed out of the (inlined, string-blanked) text;
//   * each branch's OUTCOME is its body plus — unless the body `return`s at its own top level — the code
//     that runs after the chain (`continuationText`, which skips sibling `else` arms it cannot reach);
//   * a branch PASSES when its outcome contains a `PASS_PRIMITIVE`.
//
// From `passes(mine)`, `passes(prior branches)` and `passes(later branches + fall-through)` the four
// facts below follow directly, and they are the only things this file claims:
//
//     Cm necessary   <=>  mine passes  &&  no prior passes  &&  no later passes
//     Cm sufficient  <=>  mine passes  &&  every prior passes
//     !Cm necessary  <=>  mine does NOT pass  &&  no prior passes
//     !Cm sufficient <=>  every prior passes  &&  every later (incl. fall-through) passes
//
// and are then transferred from the whole condition Cm to the individual comparison A by A's ROLE inside
// the boolean expression (`atomRole`), because `A & B` and `A | B` do not distribute the same way:
//
//     A necessary   <=  Cm necessary   and role in {sole, and}      (A & B  =>  A)
//     A sufficient  <=  Cm sufficient  and role in {sole, or}       (A      =>  A | B)
//     !A necessary  <=  !Cm necessary  and role in {sole, or}       (!(A|B) =>  !A)
//     !A sufficient <=  !Cm sufficient and role in {sole, and}      (!A     =>  !(A & B))
//
// The emitted requirement therefore carries THREE fields instead of one comparison:
//     op        the comparison THE BOT MUST SATISFY (already negated where the gate is a refusal)
//     rawOp     what the script literally wrote, so the row can be checked against its file:line
//     polarity  satisfy | negated | inert | unknown
//     strength  exact | required | sufficient | unknown
//
// `inert` is not a cop-out, it is a finding: when BOTH branches pass, the condition does not decide
// whether you get through at all. `mcannon_cave.rs2:6` only advances the quest var on the way past, and
// `border_gate.rs2:28` is the Al Kharid toll WAIVER — free passage on one side, paid passage on the
// other. Both were being reported as requirements to walk through a door that opens either way.
//
// `unknown` degrades the loc to UNKNOWN and never to PASSABLE. It is what an unreadable chain, a mixed
// `A & (B | C)` expression, or a branch structure this parser cannot resolve produces.
// =====================================================================================================

/**
 * Blank the CONTENTS of every string literal, preserving length so every index still lines up with the
 * original text.
 *
 * ⛔ LOAD-BEARING for every structural scan below. Chat lines routinely contain unbalanced brackets
 * (`"@dbl@(cough"`, `":)"`), and one of them inside a `mes()` would derail brace matching and silently
 * hand back the wrong branch. It also stops a pass primitive being "found" inside dialogue text.
 */
function blankStrings(text) {
    const a = text.split('');
    let inStr = false;
    for (let i = 0; i < a.length; i++) {
        const c = a[i];
        if (c === '\n') { inStr = false; continue; }
        if (!inStr) { if (c === '"') inStr = true; continue; }
        if (c === '\\') { a[i] = ' '; if (i + 1 < a.length && a[i + 1] !== '\n') { a[i + 1] = ' '; i++; } continue; }
        if (c === '"') { inStr = false; continue; }
        a[i] = ' ';
    }
    return a.join('');
}

const WORD = /[A-Za-z0-9_]/;

function matchFwd(s, open, oc, cc) {
    let d = 0;
    for (let i = open; i < s.length; i++) {
        if (s[i] === oc) d++;
        else if (s[i] === cc) { d--; if (d === 0) return i; }
    }
    return -1;
}
function matchBack(s, close, oc, cc) {
    let d = 0;
    for (let i = close; i >= 0; i--) {
        if (s[i] === cc) d++;
        else if (s[i] === oc) { d--; if (d === 0) return i; }
    }
    return -1;
}
const parenFwd = (s, i) => matchFwd(s, i, '(', ')');
const braceFwd = (s, i) => matchFwd(s, i, '{', '}');
const braceBack = (s, i) => matchBack(s, i, '{', '}');
const parenBack = (s, i) => matchBack(s, i, '(', ')');

const skipWs = (s, i, dir = 1) => { while (i >= 0 && i < s.length && /\s/.test(s[i])) i += dir; return i; };
const isWordAt = (s, i, w) => s.startsWith(w, i) && !WORD.test(s[i - 1] ?? '') && !WORD.test(s[i + w.length] ?? '');

/** End of a brace-less single-statement branch body: the next `;` outside any bracket. */
function statementEnd(s, from) {
    let p = 0, b = 0;
    for (let i = from; i < s.length; i++) {
        const c = s[i];
        if (c === '(') p++; else if (c === ')') p--;
        else if (c === '{') b++; else if (c === '}') { if (b === 0) return -1; b--; }
        else if (c === ';' && p === 0 && b === 0) return i;
    }
    return -1;
}

/** Does this branch body `return` unconditionally (at its own top level)? */
function topLevelReturn(body) {
    let p = 0, b = 0;
    for (let i = 0; i < body.length; i++) {
        const c = body[i];
        if (c === '(') p++; else if (c === ')') p--;
        else if (c === '{') b++; else if (c === '}') b--;
        else if (p === 0 && b === 0 && isWordAt(body, i, 'return')) return true;
    }
    return false;
}

/**
 * The `if (` whose CONDITION contains `at`, or null. Walks outward through grouping parens; refuses (as
 * `null`) as soon as the enclosing bracket turns out to be a call's argument list, a `while`, or a block
 * boundary — in each of those cases the comparison is not an if-condition and must not be read as one.
 */
function enclosingIf(s, at) {
    let depth = 0;
    for (let i = at - 1; i >= 0; i--) {
        const c = s[i];
        if (c === ')') { depth++; continue; }
        if (c === '{' || c === '}') { if (depth === 0) return null; continue; }
        if (c !== '(') continue;
        if (depth > 0) { depth--; continue; }
        let j = skipWs(s, i - 1, -1);
        let k = j;
        while (k >= 0 && WORD.test(s[k])) k--;
        const word = s.slice(k + 1, j + 1);
        if (word === 'if') return { kw: k + 1, open: i };
        if (word === '') continue;                            // a grouping paren: keep walking outward
        return null;                                          // call argument / while / switch — not readable
    }
    return null;
}

/**
 * Walk from an `if` back to the FIRST `if` of its else-chain, so the branches BEFORE ours are visible.
 * Returns null when a link cannot be resolved — a chain we half-read would let a passing prior branch go
 * unseen, which is exactly how a "necessary" claim turns into a false blocker.
 */
function chainStartOf(s, kw) {
    for (let guard = 0; guard < 64; guard++) {
        const j = skipWs(s, kw - 1, -1);
        if (j < 3 || s.slice(j - 3, j + 1) !== 'else' || WORD.test(s[j - 4] ?? '')) return kw;
        const k = skipWs(s, j - 4, -1);
        if (s[k] !== '}') return null;                        // brace-less prior branch: do not guess
        const open = braceBack(s, k);
        if (open < 0) return null;
        const q = skipWs(s, open - 1, -1);
        if (s[q] !== ')') return null;
        const p = parenBack(s, q);
        if (p < 0) return null;
        const r = skipWs(s, p - 1, -1);
        if (r < 1 || !isWordAt(s, r - 1, 'if')) return null;
        kw = r - 1;
    }
    return null;
}

/** Parse `if (..) {..} else if (..) {..} else {..}` from its first `if`. Brace-less bodies included. */
function parseIfChain(s, kw) {
    const branches = [];
    let i = kw;
    for (let guard = 0; guard < 64; guard++) {
        const p = skipWs(s, i + 2);
        if (s[p] !== '(') return null;
        const close = parenFwd(s, p);
        if (close < 0) return null;
        const j = skipWs(s, close + 1);
        let bs, be, after;
        if (s[j] === '{') { const cb = braceFwd(s, j); if (cb < 0) return null; bs = j + 1; be = cb; after = cb + 1; }
        else { const semi = statementEnd(s, j); if (semi < 0) return null; bs = j; be = semi; after = semi + 1; }
        branches.push({ kind: 'if', condStart: p + 1, condEnd: close, bodyStart: bs, bodyEnd: be });

        const k = skipWs(s, after);
        if (!isWordAt(s, k, 'else')) return { branches, end: after, hasElse: false };
        const m = skipWs(s, k + 4);
        if (isWordAt(s, m, 'if')) { i = m; continue; }
        let ebs, ebe, eafter;
        if (s[m] === '{') { const cb = braceFwd(s, m); if (cb < 0) return null; ebs = m + 1; ebe = cb; eafter = cb + 1; }
        else { const semi = statementEnd(s, m); if (semi < 0) return null; ebs = m; ebe = semi; eafter = semi + 1; }
        branches.push({ kind: 'else', condStart: -1, condEnd: -1, bodyStart: ebs, bodyEnd: ebe });
        return { branches, end: eafter, hasElse: true };
    }
    return null;
}

/**
 * The text that runs AFTER an if-chain, on every enclosing block level, minus the `else` arms that a
 * fall-through can never reach. Without the else-skipping, `if (A) { ... } else { ~climb_ladder(...) }`
 * would credit A's branch with the ladder in the arm it did NOT take.
 */
function continuationText(s, from) {
    let out = '';
    let i = from, depth = 0;
    while (i < s.length) {
        const c = s[i];
        // ⛔ `switch` ARMS DO NOT FALL THROUGH. Hitting a `case ... :` at our own depth means the next
        // arm of an enclosing switch starts here — it is NOT reachable from where we are, so skip to the
        // end of the switch and resume with the code that follows it. Without this, `[oploc1,loc_1747]`
        // (`switch_coord { case 0_40_53_10_49 : @ladder_to_dwarf_remains;  case default : ~climb_ladder }`)
        // credited the Dwarf-Cannon-gated arm with the OTHER arm's ladder, concluded the quest test
        // decided nothing, and dropped it — the exact false PASSABLE the coord split exists to prevent.
        if (depth === 0 && (isWordAt(s, i, 'case') || isWordAt(s, i, 'default'))) {
            let j = i, d = 0;
            while (j < s.length) {
                if (s[j] === '{') d++;
                else if (s[j] === '}') { if (d === 0) break; d--; }
                j++;
            }
            i = j;
            continue;
        }
        if (c === '{') { depth++; out += c; i++; continue; }
        if (c === '}') {
            if (depth > 0) { depth--; out += c; i++; continue; }
            let j = skipWs(s, i + 1);
            for (let guard = 0; guard < 64 && isWordAt(s, j, 'else'); guard++) {
                let m = skipWs(s, j + 4);
                if (isWordAt(s, m, 'if')) {
                    const op = s.indexOf('(', m);
                    const cp = op < 0 ? -1 : parenFwd(s, op);
                    if (cp < 0) return out;
                    m = skipWs(s, cp + 1);
                }
                if (s[m] === '{') { const cb = braceFwd(s, m); if (cb < 0) return out; j = skipWs(s, cb + 1); }
                else { const semi = statementEnd(s, m); if (semi < 0) return out; j = skipWs(s, semi + 1); }
            }
            i = j;
            continue;
        }
        out += c; i++;
    }
    return out;
}

let _bmKey = null, _bmVal = null;
/** open-brace index -> matching close-brace index, computed once per body. */
function braceMatches(s) {
    if (_bmKey === s) return _bmVal;
    const m = new Map();
    const stack = [];
    for (let i = 0; i < s.length; i++) {
        if (s[i] === '{') stack.push(i);
        else if (s[i] === '}') { const o = stack.pop(); if (o !== undefined) m.set(o, i); }
    }
    _bmKey = s; _bmVal = m;
    return m;
}

/**
 * Everything that DEFINITELY ran before control reached `at`: the statements that dominate it. Sibling
 * `{...}` blocks that close before `at` are dropped (they may not have run); blocks that ENCLOSE `at` are
 * descended into (reaching `at` proves they ran).
 *
 * ⛔ WITHOUT THIS, A DOOR THAT IS ALREADY OPEN LOOKS LOCKED. `[oploc1,newbie_door2]`
 * (tutorial/scripts/tut_doors_and_gates.rs2:53) calls `~open_and_close_door(...)` FIRST and only then
 * tests `%tutorial` to bump the tutorial step. Reading the branch and its continuation alone finds no
 * pass primitive on either side of that test and concludes the door needs a tutorial stage — a false
 * blocker on a door that opened two lines earlier, for everyone.
 */
function dominatingPrefix(s, at) {
    const match = braceMatches(s);
    let out = '', i = 0;
    while (i < at) {
        const c = s[i];
        // ⛔ A `switch` ARM IS NOT A DOMINATOR OF THE ARMS AFTER IT. The braces of a switch DO enclose
        // `at`, so the brace rule below descends into them — and then happily collects the EARLIER
        // `case` arms, which did not run. `[oploc1,fightarena_door1]` (quest_arena.rs2:42) is the shape:
        // two earlier arms call @arena_enter, so the `case default` arm's refusal looked like it had
        // already passed, and `%arenaquest < ^arena_obtained_armour` — a refusal — came out as a
        // requirement to stay BELOW that stage. Skip sibling arms; descend only into the one holding `at`.
        if (isWordAt(s, i, 'case') || isWordAt(s, i, 'default')) {
            let j = i + 4, d = 0;
            while (j < s.length) {
                const ch = s[j];
                if (ch === '{') { d++; j++; continue; }
                if (ch === '}') { if (d === 0) break; d--; j++; continue; }
                if (d === 0 && (isWordAt(s, j, 'case') || isWordAt(s, j, 'default'))) break;
                j++;
            }
            if (at < j) {                                     // our own arm: step past its `case ... :`
                const colon = s.indexOf(':', i);
                i = colon >= 0 && colon < at ? colon + 1 : i + 4;
                continue;
            }
            i = j;                                            // a sibling arm: it did not run
            continue;
        }
        if (c === '{') {
            const close = match.get(i);
            if (close !== undefined && close < at) { i = close + 1; continue; }
            i++; continue;
        }
        if (c === '}') { i++; continue; }
        out += c; i++;
    }
    return out;
}

/**
 * Where one comparison sits inside a boolean expression: `sole`, a top-level `and` conjunct, a top-level
 * `or` disjunct, or `mixed` (nested the other way round — `A & (B | C)` — which distributes neither way
 * and is therefore reported as unreadable rather than guessed at).
 */
function atomRole(expr, pos, s = 0, e = expr.length) {
    s = skipWs(expr, s);
    while (e > s && /\s/.test(expr[e - 1])) e--;
    if (expr[s] === '(') {
        const m = parenFwd(expr, s);
        if (m === e - 1) return atomRole(expr, pos, s + 1, e - 1);
    }
    const parts = [];
    const ops = [];
    let d = 0, start = s;
    for (let i = s; i < e; i++) {
        const c = expr[i];
        if (c === '(') d++;
        else if (c === ')') d--;
        else if (d === 0 && (c === '&' || c === '|')) {
            parts.push([start, i]); ops.push(c);
            if (expr[i + 1] === c) i++;                       // tolerate `&&` / `||`
            start = i + 1;
        }
    }
    parts.push([start, e]);
    if (parts.length === 1) return (pos >= s && pos < e) ? 'sole' : 'mixed';
    if (new Set(ops).size > 1) return 'mixed';
    const idx = parts.findIndex(([a, b]) => pos >= a && pos < b);
    if (idx < 0) return 'mixed';
    const sub = atomRole(expr, pos, parts[idx][0], parts[idx][1]);
    const conn = ops[0] === '&' ? 'and' : 'or';
    return (sub === 'sole' || sub === conn) ? conn : 'mixed';
}

/**
 * ⛔ THE ANSWER: what does the comparison at `at` require of a bot?
 *
 * Returns `{ polarity, strength, role, shape }`, or `{ polarity: 'assignment' }` when the match is a
 * WRITE (`%mcannon = ^next_stage;` at statement position) rather than a test — those are not gates at
 * all and recording one as a requirement was a false blocker on every loc that advances a quest var on
 * the way past.
 */
function conditionPolarity(text, sane, at) {
    // A statement-position `%var = ^const` is an assignment, not a test.
    const prev = sane[skipWs(sane, at - 1, -1)] ?? '';
    if (prev !== '(' && prev !== '&' && prev !== '|') {
        if (prev === ';' || prev === '{' || prev === '}' || prev === ':' || prev === '' || prev === '/') {
            return { polarity: 'assignment', strength: 'unknown', role: 'none', shape: 'assignment' };
        }
        return { polarity: 'unknown', strength: 'unknown', role: 'none', shape: 'unreadable-context' };
    }

    const enc = enclosingIf(sane, at);
    if (!enc) return { polarity: 'unknown', strength: 'unknown', role: 'none', shape: 'no-enclosing-if' };
    const start = chainStartOf(sane, enc.kw);
    if (start === null) return { polarity: 'unknown', strength: 'unknown', role: 'none', shape: 'unresolved-else-chain' };
    const chain = parseIfChain(sane, start);
    if (!chain) return { polarity: 'unknown', strength: 'unknown', role: 'none', shape: 'unparsable-chain' };
    const mi = chain.branches.findIndex(b => b.condStart >= 0 && at >= b.condStart && at < b.condEnd);
    if (mi < 0) return { polarity: 'unknown', strength: 'unknown', role: 'none', shape: 'atom-outside-chain' };

    const cont = continuationText(sane, chain.end);
    const pre = dominatingPrefix(sane, start) + '\n';
    const passes = chain.branches.map(b => {
        const body = sane.slice(b.bodyStart, b.bodyEnd);
        return passLevel(pre + (topLevelReturn(body) ? body : body + '\n' + cont));
    });
    const prior = passes.slice(0, mi);
    const later = passes.slice(mi + 1);
    if (!chain.hasElse) later.push(passLevel(pre + cont));

    const mine = passes[mi];
    const none = (a) => a.every(p => p === 'no');
    const all = (a) => a.every(p => p === 'yes');

    // "pass => Cm" needs every OTHER arm to be a dead end; "Cm => pass" needs my arm (and every arm a
    // true Cm could land in instead) to be a certain pass. A `maybe` satisfies neither, on purpose.
    const cNec = mine !== 'no' && none(prior) && none(later);
    const cSuf = mine === 'yes' && all(prior);
    const nNec = mine === 'no' && none(prior);
    const nSuf = all(prior) && all(later);

    const role = atomRole(sane.slice(chain.branches[mi].condStart, chain.branches[mi].condEnd),
        at - chain.branches[mi].condStart);
    const keepsNec = role === 'sole' || role === 'and';        // A & B => A
    const keepsSuf = role === 'sole' || role === 'or';         // A => A | B
    const aNec = cNec && keepsNec, aSuf = cSuf && keepsSuf;
    const nAtomNec = nNec && keepsSuf, nAtomSuf = nSuf && keepsNec;

    const shape = `${mine === 'yes' ? 'pass' : mine === 'maybe' ? 'may-pass' : 'refuse'}:${role}`
        + `${chain.branches.length > 1 ? ':chain' + chain.branches.length : ''}`;

    // ⛔ NOTHING ON THIS CHAIN PASSES — so the comparison does not gate passage and must not be reported
    // as a requirement. `[oploc1,regicide_tent_door]` (quest_regicide.rs2:608) is the whole shape: the
    // guard turns you away above a quest stage and turns you away below it too, and the handler ends.
    // Emitting "%regicide_quest <= ^stage" there would promise that a fresh account walks in.
    if (mine === 'no' && none(prior) && none(later)) {
        return { polarity: 'moot', strength: 'unknown', role, shape: shape + ':nothing-passes' };
    }
    if (aSuf && nAtomSuf) return { polarity: 'inert', strength: 'exact', role, shape };
    if (aNec) return { polarity: 'satisfy', strength: aSuf ? 'exact' : 'required', role, shape };
    if (nAtomNec) return { polarity: 'negated', strength: nAtomSuf ? 'exact' : 'required', role, shape };
    if (aSuf) return { polarity: 'satisfy', strength: 'sufficient', role, shape };
    if (nAtomSuf) return { polarity: 'negated', strength: 'sufficient', role, shape };
    return { polarity: 'unknown', strength: 'unknown', role, shape };
}

/** `<` and `>=` are each other's refusal. Used only when `polarity === 'negated'`. */
const NEGATE_OP = { '<': '>=', '>=': '<', '<=': '>', '>': '<=', '=': '!', '!': '=' };

/**
 * Requirements imposed by an inlined handler body, in the order they appear (route order matters to a
 * caller deciding what to fix first).
 */
function extractReqs(body, ctx) {
    const reqs = [];
    const sane = blankStrings(body);
    /**
     * ⛔ THE DEDUPE SIGNATURE IS PER *GATE*, NOT PER VARIABLE, FOR QUEST/PROGRESS ROWS.
     *
     * It used to be `kind + key` (i.e. the varp name), so a handler that tests the SAME variable twice
     * kept only the first test. `[oploc1,vt_mazeladdertopentrance]` (viking_hallifred.rs2:102) is
     * `if (%viking = ^viking_complete) { ...; return; }` followed by
     * `if (%viking = ^viking_not_started) { ...; return; }` — the second one, the one that actually stops
     * a fresh account, was being thrown away, and the loc came back PASSABLE for exactly the bot it
     * blocks. Item/level/payment rows still collapse by key: two `inv_total(inv, X)` reads ARE one
     * requirement.
     */
    const sigOf = (r) => (r.kind === 'quest' || r.kind === 'progress')
        ? `${r.kind}:${r.key}:${r.rawOp}:${r.stage}`
        : `${r.kind}:${r.key}`;
    const push = (r) => {
        const s = sigOf(r);
        if (!reqs.some(x => sigOf(x) === s)) reqs.push(r);
    };

    // ---- payment: a flat coin debit. `inv_del(inv, coins, 10)` is the fare being taken.
    for (const m of body.matchAll(/inv_del\s*\(\s*inv\s*,\s*coins\s*,\s*(\d+)\s*\)/g)) {
        push({ kind: 'payment', key: 'coins', amount: +m[1], objId: ctx.objByName.get('coins') ?? 995, objName: 'coins', at: m.index });
    }
    // a `inv_total(inv, coins) < N` affordability test with no matching debit still prices the gate
    if (!reqs.some(r => r.kind === 'payment')) {
        for (const m of body.matchAll(/inv_total\s*\(\s*inv\s*,\s*coins\s*\)\s*<\s*(\d+)/g)) {
            push({ kind: 'payment', key: 'coins', amount: +m[1], objId: ctx.objByName.get('coins') ?? 995, objName: 'coins', at: m.index });
        }
    }

    // ---- item: a non-coin obj that must be held or worn. Covers both the "give it up" toll (the Lost
    // City doorman takes a diamond) and the pure "show it" gate (the mourner door wants a worn gown).
    for (const m of body.matchAll(/inv_(?:total|del)\s*\(\s*(inv|worn)\s*,\s*([a-z_0-9]+)\s*(?:,\s*(\d+)\s*)?\)/g)) {
        const objName = m[2];
        if (objName === 'coins') continue;
        const objId = ctx.objByName.get(objName);
        if (objId === undefined) continue;
        push({ kind: 'item', key: objName, objIds: [objId], objName, worn: m[1] === 'worn', count: m[3] ? +m[3] : 1, at: m.index });
    }

    // ---- level: `if (stat(agility) < 5)` is the only shape the shortcut scripts use. A
    // `loc_param(agil_level_req)` variant exists (_monkeybars) and is resolved per-loc by the caller.
    for (const m of body.matchAll(new RegExp(`stat\\s*\\(\\s*(${SKILLS})\\s*\\)\\s*<\\s*(\\d+)`, 'g'))) {
        push({ kind: 'level', key: m[1], skill: m[1], level: +m[2], at: m.index });
    }
    for (const m of body.matchAll(new RegExp(`stat\\s*\\(\\s*(${SKILLS})\\s*\\)\\s*<\\s*loc_param\\s*\\(\\s*([a-z_0-9]+)\\s*\\)`, 'g'))) {
        push({ kind: 'level', key: m[1], skill: m[1], level: null, levelParam: m[2], at: m.index });
    }

    // ---- key doors: `[oplocu,<loc>]` bodies test the item the player just used. `last_useitem = <obj>`
    // is the same "carry this" requirement as inv_total, phrased for a use-on-loc interaction.
    for (const m of sane.matchAll(/last_useitem\s*=\s*([a-z_0-9]+)/g)) {
        const objName = m[1];
        const objId = ctx.objByName.get(objName);
        if (objId === undefined) continue;
        const pol = conditionPolarity(body, sane, m.index);
        if (pol.polarity === 'assignment') continue;
        push({
            kind: 'item', key: objName, objIds: [objId], objName, worn: false, count: 1, useItem: true,
            polarity: pol.polarity, strength: pol.strength, shape: pol.shape, at: m.index,
        });
    }

    // ---- quest: only vars DECLARED under scripts/quests/ count. `%option_run` and `%elenaquest` are
    // both `%vars`; only one of them is a quest.
    //
    // ⛔ THE COMPARISON IS NOT THE REQUIREMENT. See the CONTROL-FLOW POLARITY block above: `%mcannon <
    // ^stage` guards a `mes("The door is locked.")`, so what the BOT needs is `>=`. Every quest row now
    // carries the polarity-corrected `op` plus the `rawOp` the script wrote.
    for (const m of body.matchAll(/%([a-z_0-9]+)\s*(>=|>|<=|<|=|!)\s*\^([a-z_0-9]+)/g)) {
        const q = ctx.questVars.get(m[1]);
        const isProgress = !q && ctx.progressVars.has(m[1]);
        if (!q && !isProgress) continue;
        const pol = conditionPolarity(body, sane, m.index);
        if (pol.polarity === 'assignment') continue;           // a WRITE, not a gate
        const stage = ctx.constants.get(m[3]);
        const op = pol.polarity === 'negated' ? (NEGATE_OP[m[2]] ?? m[2]) : m[2];
        push({
            kind: q ? 'quest' : 'progress', key: m[1], varp: m[1], quest: q ?? null,
            op, rawOp: m[2], polarity: pol.polarity, strength: pol.strength, shape: pol.shape,
            stage: m[3], stageValue: stage ?? null, at: m.index,
        });
    }
    // `switch_int(%elenaquest) { case ^stage, ^stage : ... }` — the switch form of the same gate. The
    // stage set is readable but which arm PASSES is not, so this stays deliberately unresolved.
    for (const m of body.matchAll(/switch_int\s*\(\s*%([a-z_0-9]+)\s*\)/g)) {
        const q = ctx.questVars.get(m[1]);
        if (!q) continue;
        push({
            kind: 'quest', key: m[1], varp: m[1], quest: q, op: 'switch', rawOp: 'switch',
            polarity: 'unknown', strength: 'unknown', shape: 'switch_int', stage: null, stageValue: null, at: m.index,
        });
    }

    // ---- puzzle state: `testbit(%var, N)` is a per-bit lever/latch this table cannot model and no
    // profile can supply. ⛔ RECORDING IT IS THE POINT: `[oploc1,_haunted_door]`
    // (quests/quest_haunted/scripts/quest_haunted.rs2:167) is a nine-way lever combination lock whose
    // pass branch contains `~open_and_close_door2`, so a plain pass-primitive read called all NINE
    // Haunted Mine doors PASSABLE. They are only open on one exact lever pattern.
    for (const m of sane.matchAll(/testbit\s*\(\s*%([a-z_0-9]+)\s*,/g)) {
        push({ kind: 'puzzle', key: m[1], varp: m[1], probe: `read bit state of %${m[1]} (lever/latch puzzle)`, at: m.index });
    }

    // ---- members
    if (/map_members\s*=\s*\^false/.test(body)) {
        push({ kind: 'members', key: 'members', at: body.search(/map_members/) });
    }

    return reqs.sort((a, b) => a.at - b.at);
}

// -----------------------------------------------------------------------------------------------------
// coord-scoped handlers
// -----------------------------------------------------------------------------------------------------

/**
 * The content author's own "I did not wire this placement" sentinel. `@unhandled_stairs` and
 * `@unhandled_ladder` are two labels whose ENTIRE bodies are `mes(...)` debug lines
 * (ladders+stairs/scripts/stairs.rs2:493, ladders.rs2:174) — they print and MOVE NOBODY.
 *
 * So a `switch_coord` whose default arm is one of these is a WHITELIST: the loc type works at the coords
 * the script enumerates and is a silent dead click everywhere else.
 */
const DEAD_DEFAULT = /@unhandled_stairs|@unhandled_ladder|mes\s*\(\s*"[Uu]nhandled/;

/** `0_40_53_10_49` -> level 0, x 40*64+10, z 53*64+49. The engine's coord literal, level_mx_mz_lx_lz. */
function decodeCoord(lit) {
    const p = lit.split('_').map(Number);
    if (p.length !== 5 || p.some(n => !Number.isFinite(n))) return null;
    return { level: p[0], x: p[1] * 64 + p[3], z: p[2] * 64 + p[4] };
}

/**
 * Split `switch_coord (loc_coord) { case <coord>: ... case default: ... }` out of a RAW handler body.
 *
 * ⛔ SPLIT BEFORE INLINING, NOT AFTER. Inlining injects whole proc bodies (with their own braces and,
 * for `_bookcase`, their own `switch_coord`) into the text, so brace-matching an inlined body can land
 * on the wrong `}`. The raw body is unambiguous; each ARM is inlined separately afterwards.
 *
 * Returns null when the handler is not coord-scoped, which is the overwhelmingly common case.
 */
function splitCoordSwitch(rawBody) {
    const m = /switch_coord\s*\(\s*loc_coord[^)]*\)\s*\{/.exec(rawBody);
    if (!m) return null;
    const open = m.index + m[0].length - 1;
    let depth = 0, close = -1;
    for (let i = open; i < rawBody.length; i++) {
        if (rawBody[i] === '{') depth++;
        else if (rawBody[i] === '}') { depth--; if (depth === 0) { close = i; break; } }
    }
    if (close === -1) return null;
    const prefix = rawBody.slice(0, m.index);
    const suffix = rawBody.slice(close + 1);
    const inner = rawBody.slice(open + 1, close);

    const marks = [];
    const caseRe = /case\s+([0-9]+_[0-9]+_[0-9]+_[0-9]+_[0-9]+|default)\s*:/g;
    let cm;
    while ((cm = caseRe.exec(inner))) marks.push({ label: cm[1], at: cm.index, end: cm.index + cm[0].length });
    const arms = marks.map((k, i) => ({
        label: k.label,
        body: inner.slice(k.end, i + 1 < marks.length ? marks[i + 1].at : inner.length),
    }));
    const defaultArm = arms.find(a => a.label === 'default') ?? null;
    return { prefix, suffix, arms: arms.filter(a => a.label !== 'default'), defaultArm };
}

/**
 * Compose the text that ACTUALLY runs for one arm of a coord switch.
 *
 * The code after the switch runs too — unless the arm `return`s. `[oploc1,loc_1749]` is exactly that
 * shape: one special case that returns, then a bare `~climb_ladder(...)` that serves every other
 * placement. Get this wrong and 32 working ladders read as dead clicks.
 */
function armText(split, armBody) {
    const returns = /\breturn\b/.test(armBody);
    return split.prefix + armBody + (returns ? '' : split.suffix);
}

/**
 * Does a quest test WAIVE a later payment? border_gate.rs2:28 is the canonical shape:
 *     if (%princequest >= ^prince_saved) { ...; @pass_toll_gate($loc_coord); }
 *     ...
 *     inv_del(inv, coins, 10);
 * Requires (a) the quest test to precede the payment, and (b) a pass primitive inside the test's own
 * braces — otherwise a quest check that merely changes the DIALOGUE would look like a free pass.
 */
function findWaivers(body, reqs) {
    const payments = reqs.filter(r => r.kind === 'payment');
    const quests = reqs.filter(r => r.kind === 'quest');
    if (!payments.length || !quests.length) return;
    for (const q of quests) {
        const open = body.indexOf('{', q.at);
        if (open === -1) continue;
        let depth = 0, close = -1;
        for (let i = open; i < body.length; i++) {
            if (body[i] === '{') depth++;
            else if (body[i] === '}') { depth--; if (depth === 0) { close = i; break; } }
        }
        if (close === -1) continue;
        const inner = body.slice(open, close);
        if (!PASS_PRIMITIVE.test(inner)) continue;
        for (const p of payments) {
            // ⛔ `rawOp`, not `op`. A waiver is stated from the SCRIPT's point of view — "when this
            // condition holds, the fee is skipped" — so it must not be polarity-flipped the way a
            // requirement is. (In practice a waiver always guards a pass branch and the two agree, but
            // relying on that would make the flip silently wrong if the shape ever changed.)
            if (p.at > q.at) p.waivedBy = { quest: q.quest, varp: q.varp, op: q.rawOp ?? q.op, stage: q.stage, stageValue: q.stageValue };
        }
    }
}

// -----------------------------------------------------------------------------------------------------
// quest var / constant tables
// -----------------------------------------------------------------------------------------------------

function loadQuestVars() {
    const out = new Map();
    for (const file of collect(SCRIPTS_DIR, '.varp')) {
        const rel = file.replace(/\\/g, '/');
        const qm = /\/quests\/(quest_[a-z0-9_]+)\//.exec(rel);
        if (!qm) continue;                                   // not a quest var -> not a quest gate
        const quest = qm[1].replace(/^quest_/, '');
        for (const m of fs.readFileSync(file, 'utf8').matchAll(/^\[([a-z_0-9]+)\]/gm)) out.set(m[1], quest);
    }
    return out;
}

/**
 * Non-quest PROGRESS varps: a `.varp` declared under `scripts/tutorial/` is a tutorial-progress
 * variable, and `[oploc1,_tutorial_gate]` gates on it exactly the way a quest door gates on `%priestperil`
 * (`if (%tutorial < ^newbie_survival_instructor_complete) { ~mesbox("You need to talk to the Survival
 * Guide..."); return; }` — tutorial/scripts/tut_doors_and_gates.rs2:22).
 *
 * DERIVED, not listed: whatever the tutorial config dir declares is what this returns. It is kept
 * separate from `questVars` because `quest-state.ts` inventories real quests and a tutorial variable is
 * not one — it has no questlist row, so no journal colour can ever observe it.
 */
function loadProgressVars() {
    const out = new Set();
    for (const file of collect(SCRIPTS_DIR, '.varp')) {
        if (!/[\\/]tutorial[\\/]/.test(file)) continue;
        for (const m of fs.readFileSync(file, 'utf8').matchAll(/^\[([a-z_0-9]+)\]/gm)) out.add(m[1]);
    }
    return out;
}

function loadConstants() {
    const out = new Map();
    for (const file of collect(SCRIPTS_DIR, '.constant')) {
        for (const m of fs.readFileSync(file, 'utf8').matchAll(/^\^([a-z_0-9]+)\s*=\s*(-?\d+)\s*$/gm)) {
            out.set(m[1], +m[2]);
        }
    }
    return out;
}

// -----------------------------------------------------------------------------------------------------
// main
// -----------------------------------------------------------------------------------------------------

/**
 * Op text that means "this thing is in my way and I want to be on the other side of it".
 *
 * DELIBERATELY EXCLUDES `Search` / `Take` / `Use` / `Steal-from`. Those are container and skilling verbs;
 * including them pulled 200+ drawers, bookcases and crates into the table. They are harmless at runtime
 * (the oracle's obstacle test is GEOMETRIC, and the collision grid never routes a bot onto a chest) but
 * they made the honest per-class inventory unreadable, which is the one number this file owes a reader.
 */
const TRAVERSAL_OP = /^(open|close|pay-?fare|pay|climb|climb-over|climb-up|climb-down|climb-out|climb-into|climb-across|enter|exit|leave|go-?through|pass|cross|squeeze-?through|squeeze-?past|jump|jump-over|swing-?across|swing-on|walk-?across|balance-?across|board|disembark|push|pull|unlock|traverse)\b/i;

/**
 * Names that make a loc a plausible BARRIER (as opposed to a chest that merely happens to say "Open").
 * Reporting-only: the runtime decides by geometry, never by name.
 */
const BARRIER_NAME = /door|gate|wall|barrier|portcullis|fence|railing|stile|bars|entrance|exit|passage|stair|ladder|rope|log|stepping stone|net|pipe|shortcut|crevice|hole|trapdoor|bridge|plank|gangplank|cave|tunnel|vine|obstacle|ledge|rock ?pile|boulder|curtain|portal|grill|hatch|opening|arch|drain|pillar|bank of|steps/i;

/** One sentence per reason an op is UNKNOWN. `why` is the machine-readable half; this is the human one. */
const UNKNOWN_NOTE = {
    'puzzle-state': 'this handler opens only on a testbit() lever/latch pattern. Nothing in a bot profile '
        + 'can supply that, so the outcome is genuinely unknown — and it is NOT passable, which is what a '
        + 'plain pass-primitive read said about all nine Haunted Mine doors.',
    'unreadable-gate': 'a quest/progress/key comparison was found but this extractor could not tell which '
        + 'branch it guards (mixed & / | expression, unresolved else-chain, or a switch_int form), so the '
        + 'direction of the test is unknown — READ IT rather than assume either way.',
    'inline-truncated': 'the inliner hit its budget before the end of this handler, so the text classified '
        + 'here is INCOMPLETE and any pass primitive past the cut is invisible. Not a content finding.',
    default: 'handler found but it matched no requirement marker AND no pass primitive — READ IT',
};

function main() {
    const t0 = Date.now();
    const locPack = loadPack('loc.pack');
    const objPack = loadPack('obj.pack');
    const cfgs = loadLocConfigs();
    const questVars = loadQuestVars();
    const progressVars = loadProgressVars();
    const constants = loadConstants();
    const blocks = loadScripts();

    const byLabel = new Map(), byProc = new Map(), byOp = new Map();
    for (const b of blocks) {
        if (b.trigger === 'label') { if (!byLabel.has(b.subject)) byLabel.set(b.subject, b); }
        else if (b.trigger === 'proc') { if (!byProc.has(b.subject)) byProc.set(b.subject, b); }
        else if (/^oploc([1-5]|u)$/.test(b.trigger)) {
            // one header may list several subjects: `[oploc1,a]` is the norm but `,`-lists appear.
            // `oplocu` is the USE-ITEM-ON-LOC trigger and is indexed the same way — see the key-door
            // block further down.
            for (const s of b.subject.split(',')) {
                const key = b.trigger + ':' + s.trim();
                if (!byOp.has(key)) byOp.set(key, b);
            }
        }
    }

    const ctx = { objByName: objPack.byName, questVars, progressVars, constants };
    const entries = [];

    /**
     * ⛔ EVERY loc id whose type declares `blockwalk=no`, not just the operable ones.
     *
     * GameMap.ts:280 paints collision `if (type.blockwalk)`, so these locs are INVISIBLE to the router
     * and can never be obstacles. Without this list the oracle reported Daisies, Ferns, Heather and
     * Cabbages as IMPASSABLE on real navgrid routes (6 of 8 "obstacles" on the 908-tile Ardougne run) —
     * a false-blocker rate that would have buried the one finding that mattered. Emitted separately from
     * `entries` because most of these locs have no ops at all and so never reach the classifier.
     */
    const nonBlockingLocIds = [];
    for (const [id, internal] of locPack.byId) {
        const c = cfgs.get(internal);
        if (c && c.blockwalk === false) nonBlockingLocIds.push(id);
    }
    nonBlockingLocIds.sort((a, b) => a - b);
    /** Quest/progress/key comparisons the polarity pass proved do not decide passage. Reported, not hidden. */
    let inertDropped = 0;
    const tally ={ passable: 0, payment: 0, item: 0, level: 0, quest: 0, members: 0, impassable: 0, unknown: 0, noHandler: 0 };
    /** Same tally restricted to locs whose NAME reads like a barrier — the population that can be on a route. */
    const tallyBarrier = { passable: 0, payment: 0, item: 0, level: 0, quest: 0, members: 0, impassable: 0, unknown: 0, noHandler: 0 };
    const inlineCache = new Map();

    for (const [id, internal] of [...locPack.byId].sort((a, b) => a[0] - b[0])) {
        const cfg = cfgs.get(internal);
        if (!cfg) continue;
        const ops = cfg.ops;
        if (!ops.some(Boolean)) continue;                    // no op = nothing to classify

        /**
         * Classify one already-inlined chunk of handler text. Shared by the whole-body path, by each arm
         * of a coord switch and by the key-door path, so none of them can drift apart.
         *
         * ⛔ THE GATE FILTER. A recorded quest/progress/key comparison is only a REQUIREMENT when the
         * control-flow analysis could say which way it points (`polarity` satisfy|negated). `inert` means
         * both branches pass — a state bump on the way through, or the Al Kharid toll WAIVER — and must
         * not be reported as something to acquire. `unknown` means the analysis could not read the
         * branch, and that degrades the loc to UNKNOWN rather than to PASSABLE.
         */
        const classify = (text, truncated = false) => {
            let reqs = extractReqs(text, ctx);
            findWaivers(text, reqs);
            // a loc_param level requirement is resolvable from THIS loc's own params
            for (const r of reqs) {
                if (r.kind === 'level' && r.level === null && r.levelParam) {
                    const v = cfg.params[r.levelParam];
                    r.level = v !== undefined ? (parseInt(v) || null) : null;
                }
            }
            // ⛔ `findWaivers` HAS ALREADY RUN, so dropping the inert rows here cannot lose the Al Kharid
            // waiver — it lives on the PAYMENT row as `waivedBy`. What it does drop is every "the door
            // opens either way, this test only bumps a variable on the way past" row, which is not a
            // requirement and reads as one.
            inertDropped += reqs.filter(r => r.polarity === 'inert' || r.polarity === 'moot').length;
            reqs = reqs.filter(r => r.polarity !== 'inert' && r.polarity !== 'moot');
            for (const r of reqs) delete r.at;
            const gate = (r) => r.polarity === undefined || r.polarity === 'satisfy' || r.polarity === 'negated';
            const unreadable = (r) => r.polarity === 'unknown';
            const stateful = (k) => (r) => r.kind === k;
            let cls, why;
            // ⛔ THE ORDER, AND WHAT `cls` DOES AND DOES NOT MEAN.
            //
            // `cls` is the handler's HEADLINE requirement — "what does this door mostly want?" — and it
            // is deliberately NOT the runtime verdict. `route-feasibility.evaluateOp` takes the WORST
            // class across ALL of a handler's requirements, so a handler holding both a coin toll and a
            // `testbit()` puzzle is `payment` here and UNKNOWN in the field. That is intended: the
            // route-level pass (`classifyRouteTiles`, which is what the audit reports per route) is the
            // complete UNKNOWN inventory, and it does include those.
            //
            // Putting the unreadable rows FIRST was tried and reverted: it makes `cls === 'unknown'`
            // mean two different things at once ("I could not read this handler" and "I read it, but one
            // of its inputs is unobservable"), and `route-feasibility-audit.hazardTypes()` — which is the
            // "which handlers does a human still have to READ?" inventory — filters on exactly that
            // field. Merging them took the hazard list from 155 placements to 631 and put 7 locs on the
            // route hazard list that classify perfectly well at their placements. A false blocker
            // buries the real one; that applies to the report as much as to the router.
            if (reqs.some(stateful('payment'))) cls = 'payment';
            else if (reqs.some(r => r.kind === 'item' && gate(r))) cls = 'item';
            else if (reqs.some(stateful('level'))) cls = 'level';
            else if (reqs.some(r => (r.kind === 'quest' || r.kind === 'progress') && gate(r))) cls = 'quest';
            else if (reqs.some(stateful('puzzle'))) { cls = 'unknown'; why = 'puzzle-state'; }
            else if (reqs.some(r => unreadable(r))) { cls = 'unknown'; why = 'unreadable-gate'; }
            else if (truncated && !PASS_PRIMITIVE.test(text)) { cls = 'unknown'; why = 'inline-truncated'; }
            else if (LOCKED_MES.test(text) && !PASS_PRIMITIVE.test(text)) cls = 'impassable';
            else if (reqs.some(stateful('members'))) cls = 'members';
            else if (PASS_PRIMITIVE.test(text)) cls = 'passable';
            else cls = 'unknown';                            // ⛔ the default, on purpose
            return { cls, why, reqs };
        };

        const perOp = [];
        for (let o = 0; o < 5; o++) {
            if (!ops[o]) continue;
            if (!TRAVERSAL_OP.test(ops[o])) continue;        // "Chop down", "Mine" — not a way through
            const trig = `oploc${o + 1}`;
            const handler = byOp.get(`${trig}:${internal}`)
                ?? (cfg.category ? byOp.get(`${trig}:_${cfg.category}`) : undefined);
            if (!handler) {
                // A REAL finding, not a gap in this extractor: with no [oplocN] binding the engine does
                // nothing at all when the option is clicked, so the loc never opens. Reported as
                // `unknown` rather than `impassable` only because a handler could be bound elsewhere.
                perOp.push({ op: o + 1, opText: ops[o], cls: 'unknown', why: 'no-handler', via: null, source: null, reqs: [],
                    note: 'loc advertises this option but no [' + trig + '] handler binds it (by name or by category)' });
                continue;
            }
            const ck = handler.file + ':' + handler.line;
            let body = inlineCache.get(ck);
            if (body === undefined) {
                body = inline(handler.body, byLabel, byProc);
                inlineCache.set(ck, body);
            }

            // ---- the whole-handler UNION. `op.reqs` KEEPS THIS SHAPE FOR BACKWARD COMPATIBILITY:
            // extract-quests.mjs walks `entries[].ops[].reqs[]` looking for `kind === 'quest'`, and a
            // coord-scoped handler must not make a quest gate vanish from that inventory.
            const whole = classify(body, wasTruncated(body));

            // ---- coord scoping. See the header: a loc TYPE is not the unit of truth for these.
            const split = splitCoordSwitch(handler.body);
            let coordCases, coordDefault, effective = whole;
            if (split) {
                coordCases = [];
                for (const arm of split.arms) {
                    const decoded = decodeCoord(arm.label);
                    if (!decoded) continue;
                    const armBody = inline(armText(split, arm.body), byLabel, byProc);
                    const c = classify(armBody, wasTruncated(armBody));
                    coordCases.push({ coord: arm.label, ...decoded, cls: c.cls, ...(c.why ? { why: c.why } : {}), reqs: c.reqs });
                }
                const defaultRaw = armText(split, split.defaultArm ? split.defaultArm.body : '');
                const defaultBody = inline(defaultRaw, byLabel, byProc);
                const dead = DEAD_DEFAULT.test(defaultBody) && !PASS_PRIMITIVE.test(defaultBody);
                const d = classify(defaultBody, wasTruncated(defaultBody));
                coordDefault = dead
                    ? {
                        cls: 'unknown', why: 'unhandled-coord',
                        reqs: [],
                        note: 'this handler is a WHITELIST: `switch_coord (loc_coord)` enumerates '
                            + coordCases.length + ' coord(s) and its default arm is the content authors\' own '
                            + '@unhandled_stairs/@unhandled_ladder sentinel, which only prints a debug line. '
                            + 'At any placement NOT in coordCases the click does NOTHING, silently.',
                    }
                    : { cls: d.cls, ...(d.why ? { why: d.why } : {}), reqs: d.reqs, note: '' };
                effective = coordDefault;
            }

            const cls = effective.cls;
            perOp.push({
                op: o + 1, opText: ops[o], cls,
                why: cls === 'unknown' ? (effective.why ?? 'unrecognised-handler') : undefined,
                via: byOp.get(`${trig}:${internal}`) ? 'name' : 'category',
                source: `${handler.file}:${handler.line}`,
                reqs: whole.reqs,
                ...(split ? { coordScoped: true, coordCases, coordDefault } : {}),
                note: effective.note ? effective.note
                    : cls === 'impassable' ? 'handler only prints a locked message; no pass primitive'
                        : cls === 'unknown' ? UNKNOWN_NOTE[effective.why ?? ''] ?? UNKNOWN_NOTE.default
                            : '',
            });
        }

        // ---- KEY DOORS. A `[oplocu,<loc>]` handler is the USE-ITEM-ON-LOC path, and for a locked door
        // it is the ONLY way through: `[oploc1,melzardoor]` just prints "The door is securely locked."
        // while `[oplocu,melzardoor] if (last_useitem = melzarkey) { ~open_and_close_door(...) }` opens
        // it (quests/quest_dragon/scripts/melzars_maze.rs2:13). Reported as a pseudo-op with `op: 0`,
        // which is NOT an oplocN index — it means "send OPLOCU with this obj", and route-feasibility
        // renders it as `Use <item> on`.
        //
        // ⛔ THE GUARD IS `PASS_PRIMITIVE`, NOT `last_useitem`. `[oplocu,arena_prisondoor]` also tests a
        // key (`khazard_cellkeys`) and then says "The gate is locked, but Jeremy's not in there anyway."
        // — it never opens. Emitting an item requirement for that would invent a way through a door that
        // has none, which is the false-PASSABLE direction. So a key door is only recorded when the
        // handler can actually move the player.
        if (perOp.length) {
            const uh = byOp.get(`oplocu:${internal}`)
                ?? (cfg.category ? byOp.get(`oplocu:_${cfg.category}`) : undefined);
            if (uh) {
                const ubody = inline(uh.body, byLabel, byProc);
                if (PASS_PRIMITIVE.test(ubody)) {
                    const u = classify(ubody, wasTruncated(ubody));
                    const keys = u.reqs.filter(r => r.kind === 'item');
                    if (keys.length && u.cls === 'item') {
                        perOp.push({
                            op: 0, opText: `Use ${keys.map(k => k.objName).join('/')} on`, useItem: true,
                            cls: 'item', via: byOp.get(`oplocu:${internal}`) ? 'name' : 'category',
                            source: `${uh.file}:${uh.line}`, reqs: u.reqs,
                            note: 'key door: the [oploc] option only reports it locked; this is the '
                                + '[oplocu] use-item-on-loc path that actually opens it. `op: 0` is a '
                                + 'sentinel for OPLOCU, not an oplocN index.',
                        });
                    }
                }
            }
        }

        if (!perOp.length) continue;

        // The entry's headline class is the BEST (least demanding) traversal op — a loc with a free
        // "Open" and a paid "Pay-fare" is passable — but every op is kept so a caller can see the cost.
        const rank = { passable: 0, members: 1, level: 2, item: 3, payment: 4, quest: 5, unknown: 6, impassable: 7 };
        const best = perOp.slice().sort((a, b) => rank[a.cls] - rank[b.cls])[0];
        tally[best.cls]++;
        if (perOp.every(p => p.source === null)) tally.noHandler++;
        const barrier = BARRIER_NAME.test(cfg.name);
        if (barrier) {
            tallyBarrier[best.cls]++;
            if (perOp.every(p => p.source === null)) tallyBarrier.noHandler++;
        }

        entries.push({
            locId: id, internal, name: cfg.name, category: cfg.category, barrier,
            blockwalk: cfg.blockwalk, active: cfg.active, width: cfg.width, length: cfg.length,
            cls: best.cls, ops: perOp,
        });
    }

    const out = {
        provenance: {
            generatedBy: 'headless/data/extract-obstacles.mjs',
            generatedAt: new Date().toISOString().slice(0, 10),
            sources: [
                'server/content/pack/loc.pack', 'server/content/pack/obj.pack',
                'server/content/scripts/**/*.loc', 'server/content/scripts/**/*.rs2',
                'server/content/scripts/quests/**/configs/*.varp',
                'server/content/scripts/**/*.constant',
            ],
            locTypes: locPack.byId.size,
            locsWithConfig: cfgs.size,
            rs2Blocks: blocks.length,
            oplocHandlers: byOp.size,
            questVars: questVars.size,
            progressVars: progressVars.size,
            /**
             * Quest/progress/key comparisons the CONTROL-FLOW POLARITY pass proved do not decide
             * passage (both branches reach a pass primitive) and therefore did not emit as a
             * requirement. Counted here rather than dropped in silence: a jump in this number means the
             * pass-primitive set moved, not that the content changed.
             */
            inertGatesDropped: inertDropped,
            // ⛔ NO TIMING FIELD HERE. `buildMs` used to live in this object and made the emitted table
            // differ between two runs of the SAME generator on the SAME inputs, which defeats the one
            // check that catches a stale generated file (regenerate + diff). The cost is printed to the
            // console instead, where it is useful and harmless.
        },
        tally,
        tallyBarrier,
        nonBlockingLocIds,
        entries,
    };
    fs.writeFileSync(OUT_FILE, JSON.stringify(out, null, 1) + '\n');
    console.log(`[obstacles] ${entries.length} traversable loc types -> ${path.relative(ROOT, OUT_FILE)}`);
    console.log(`[obstacles] all      ${JSON.stringify(tally)}  (${Date.now() - t0}ms)`);
    console.log(`[obstacles] barriers ${JSON.stringify(tallyBarrier)}`);
    console.log(`[obstacles] ${nonBlockingLocIds.length} loc types are blockwalk=no (invisible to collision, never obstacles)`);
    console.log(`[obstacles] polarity ${JSON.stringify(polarityTally())}  inert-dropped=${inertDropped}`);

    function polarityTally() {
        const t = {};
        for (const e of entries) {
            for (const o of e.ops) {
                const buckets = [o.reqs, ...(o.coordCases ?? []).map(c => c.reqs), o.coordDefault?.reqs ?? []];
                for (const rs of buckets) for (const r of rs ?? []) {
                    if (r.kind !== 'quest' && r.kind !== 'progress') continue;
                    const k = `${r.rawOp}->${r.op}/${r.polarity}/${r.strength}`;
                    t[k] = (t[k] ?? 0) + 1;
                }
            }
        }
        return Object.fromEntries(Object.entries(t).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)));
    }

    if (process.argv.includes('--polarity')) {
        console.log('\n== QUEST/PROGRESS GATES, one line per (loc, op, comparison) ==');
        console.log('  raw -> effective  polarity/strength  shape                 varp                   source');
        const seen = new Set();
        for (const e of entries) {
            for (const o of e.ops) {
                for (const r of o.reqs ?? []) {
                    if (r.kind !== 'quest' && r.kind !== 'progress') continue;
                    const line = `  ${(r.rawOp + ' -> ' + r.op).padEnd(12)} ${(r.polarity + '/' + r.strength).padEnd(20)} `
                        + `${String(r.shape).padEnd(22)} ${r.varp.padEnd(22)} ${o.source} ^${r.stage}`;
                    if (seen.has(line)) continue;
                    seen.add(line);
                    console.log(line);
                }
            }
        }
    }

    if (process.argv.includes('--report')) {
        for (const cls of ['payment', 'item', 'level', 'quest', 'impassable', 'unknown']) {
            const list = entries.filter(e => e.cls === cls);
            console.log(`\n== ${cls.toUpperCase()} (${list.length}) ==`);
            for (const e of list.slice(0, 40)) {
                const r = e.ops.flatMap(o => o.reqs).map(q => q.kind + ':' + q.key + (q.amount ? '=' + q.amount : '') + (q.level ? '=' + q.level : '')).join(' ');
                console.log(`  ${String(e.locId).padStart(5)} ${e.internal.padEnd(34)} ${(e.name || '-').padEnd(18)} ${r || e.ops[0].note.slice(0, 60)}`);
            }
            if (list.length > 40) console.log(`  ... and ${list.length - 40} more`);
        }
    }
}

main();
