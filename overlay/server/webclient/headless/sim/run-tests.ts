// =====================================================================================================
// run-tests.ts — THE SIM GATE. Run this instead of `bun test headless/sim`.
// =====================================================================================================
//
//   cd server/webclient && bun headless/sim/run-tests.ts
//   bun headless/sim/run-tests.ts --batch=4          # smaller batches (default 6, see THE THRESHOLD)
//   bun headless/sim/run-tests.ts --filter=skill     # only files whose path matches
//   bun headless/sim/run-tests.ts --solo             # one file per process (slowest, best attribution)
//   bun headless/sim/run-tests.ts --json=gate.json   # machine-readable summary as well as the table
//
// -----------------------------------------------------------------------------------------------------
// ⛔ WHY THIS EXISTS: `bun test headless/sim` DOES NOT RUN. It is not flaky and it is not this repo's
// bug — Bun 1.3.9 aborts the whole run before a single test body executes:
//
//     panic(main thread): Internal assertion failure
//
// ~37ms in, exit code 3, zero tests run. Reproduced 6+ times by three independent agents, including on
// a fully idle machine (so it is not a concurrency artefact), with a corrupted path in the error text
// and a segfault variant at ~1.4GB RSS. It is a runner-process problem that scales with how many test
// FILES one `bun test` invocation loads, not a failing assertion in any of them.
//
// ⭐⭐ THE ACTUAL TRIGGER IS THE **CWD**, NOT THE FILE COUNT — measured here, 3/3 each way:
//
//     cwd=server/webclient          76 files -> panic(main thread): Internal assertion failure, exit 3
//     cwd=server/webclient          19 files -> PASS
//     cwd=.../headless/sim          76 files -> PASS, 1921 tests, 23s
//     cwd=.../headless/sim   `bun test .`    -> PASS
//
// Same files, same Bun, same machine; the ONLY difference is the directory `bun test` is invoked from.
// From `server/webclient` Bun resolves that package's tsconfig + `imports` map (the crash dump names
// `tsconfig(2) tsconfig_paths`) and dies once enough files are loaded through it. That is why the
// file-count evidence looked like a threshold: everyone measuring it was standing in `server/webclient`.
//
// ⭐ SO THIS RUNNER SPAWNS EVERY BATCH WITH `cwd: SIM_DIR`. That alone is sufficient today. The
// BATCHING IS KEPT ANYWAY, and deliberately: it is the thing that still works if Bun's next version
// moves the trigger, it caps peak RSS (the segfault variant landed at ~1.4GB), and it is what makes the
// per-file attribution table possible at all. Belt AND braces, because the failure mode of getting this
// wrong is a green gate that tested nothing.
//
// Batch-size evidence, from `server/webclient` where the bug is reachable:
//     76 -> PANIC   19 -> PANIC (3 of 4 chunks)   6 -> PASS   1 -> PASS
// The default is **6**: the only safe reading of "somewhere between 6 and 19" is 6.
//
// Nothing here patches, wraps or works around Bun's own test machinery: every file is executed by a
// stock `bun test`, and the only additions are (a) the cwd, (b) how many files each process gets,
// (c) a deadline, (d) the attribution table, and (e) the four-state classification below.
//
// ⛔ ONE THING BATCHING COSTS YOU, AND IT IS NOT FREE: a batched gate CANNOT SEE CROSS-FILE
// INTERFERENCE. Running all 76 in one process found a real defect this runner had been hiding —
// `planner.test.ts:12` / `autopilot.test.ts:8` set `process.env.LC_HOST` at module scope and
// `travel-preference.test.ts` then compared a module-load constant against the mutated env (1920/1).
// Fixed at the assertion (it is now hermetic). If you change test-file module-scope state, run the
// one-process form once: `cd headless/sim && bun test $(ls *.test.ts)`.
//
// -----------------------------------------------------------------------------------------------------
// ⛔ THE ABSENCE-READS-AS-SUCCESS TRAP, WHICH IS THE WHOLE REASON THIS FILE IS CAREFUL
// -----------------------------------------------------------------------------------------------------
// A panicking batch exits 3 having run ZERO tests. A naive aggregator adds `0 pass, 0 fail` and reports
// GREEN. That is the exact shape of this project's most expensive class of bug (learnings rule 2:
// absence must never look like zero). So a batch is classified into FOUR distinct states, each with its
// own message and its own row in the table:
//
//   OK       every file in the batch reported, zero failures
//   FAIL     files reported and at least one test failed          -> the normal red
//   PANIC    exited non-zero having produced NO parsable summary  -> Bun died; nothing was tested
//   TIMEOUT  the deadline fired and the process was killed        -> a hung suite, NOT a crash
//
// PANIC and TIMEOUT are hard errors that force a non-zero exit even when every test that did run passed.
// A file that never reported prints as PANIC/TIMEOUT in the per-file table, never as 0/0/ok.
//
// ⛔ A PANICKED BATCH IS SPLIT IN HALF AND RE-RUN, AND THE SPLIT IS ANNOUNCED. That turns "batch 4 died"
// into "batch 4 died, and it was tutorial-island.test.ts". A silent retry that turns red into green
// would be worse than the crash, so every split prints a `SPLIT` line and the final report lists them.
// `--no-recover` disables it. Recursion bottoms out at one file per process: a single file that still
// panics is reported as PANIC against that file and nothing else.
//
// ⛔ EVERY WAIT IS RACED AGAINST A DEADLINE. A hung `bun test` spins a core forever and this gate is
// meant to be safe to run unattended. `--timeout-ms` (default 900000 = 15min) is per BATCH; on expiry
// the process is killed, the batch is marked TIMEOUT, and the run CONTINUES so the rest of the table is
// still produced. It is generous on purpose — one 19-file chunk containing loc-scene + navgrid +
// p1-rollout blew a 1200s budget, and a timeout misreported as a failure sends you hunting a bug that
// does not exist.
//
// EXIT CODE: 0 only when every file reported and reported zero failures.
// =====================================================================================================
import { readdirSync, writeFileSync, mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import { tmpdir } from 'node:os';

const SIM_DIR = import.meta.dir;

/** The four states a batch (or a single file) can end in. `ok` is the only green one. */
type RunState = 'ok' | 'FAIL' | 'PANIC' | 'TIMEOUT';

interface FileResult {
    file: string;
    tests: number;
    failures: number;
    skipped: number;
    state: RunState;
    /** the group label the file was finally executed in, e.g. `b3` or `b3.1.0` after two splits */
    group: string;
    ms: number;
}

interface ProcOutcome {
    exitCode: number | null;
    timedOut: boolean;
    output: string;
    ms: number;
}

// -----------------------------------------------------------------------------------------------------
// ARGS
// -----------------------------------------------------------------------------------------------------
function arg(name: string, dflt: string): string {
    const hit = process.argv.find(a => a.startsWith(`--${name}=`));
    return hit ? hit.slice(name.length + 3) : dflt;
}
const flag = (name: string): boolean => process.argv.includes(`--${name}`);

/** ⛔ 6, NOT 8. See THE THRESHOLD above — 19 panics, 8 is one lucky observation above a known-bad size. */
const BATCH_SIZE = flag('solo') ? 1 : Math.max(1, parseInt(arg('batch', process.env.SIM_BATCH ?? '6'), 10));
const BATCH_TIMEOUT_MS = Math.max(10_000, parseInt(arg('timeout-ms', process.env.SIM_BATCH_TIMEOUT_MS ?? '900000'), 10));
const FILTER = arg('filter', '');
const RECOVER = !flag('no-recover');
const JSON_OUT = arg('json', '');

// -----------------------------------------------------------------------------------------------------
// DISCOVERY — sorted, so batch membership is deterministic and a panic is reproducible by batch
// -----------------------------------------------------------------------------------------------------
const files = readdirSync(SIM_DIR)
    .filter(f => f.endsWith('.test.ts'))
    .filter(f => !FILTER || f.includes(FILTER))
    .sort();

/**
 * ⛔ NORMALISE THE PATH BUN ECHOES. The junit reporter emits the path it was GIVEN, with the host
 * separator (`headless\sim\foo.test.ts` on Windows). Comparing that to a forward-slash path we built
 * ourselves is a silent no-match that would render every file as PANIC. Key on the basename, which is
 * unique inside one directory and separator-free.
 */
const keyOf = (p: string): string => basename(p.replace(/\\/g, '/'));

// -----------------------------------------------------------------------------------------------------
// ONE `bun test` PROCESS
// -----------------------------------------------------------------------------------------------------
async function spawnBunTest(batch: string[], xmlPath: string): Promise<ProcOutcome> {
    const t0 = Date.now();
    const proc = Bun.spawn(
        ['bun', 'test', '--reporter=junit', `--reporter-outfile=${xmlPath}`, ...batch.map(f => join(SIM_DIR, f))],
        { cwd: SIM_DIR, stdout: 'pipe', stderr: 'pipe', env: { ...process.env, FORCE_COLOR: '0' } },
    );

    // ⛔ RACE THE WAIT. `proc.exited` alone can never resolve for a wedged test process.
    let timer: ReturnType<typeof setTimeout> | undefined;
    let timedOut = false;
    const deadline = new Promise<'timeout'>(res => {
        timer = setTimeout(() => { timedOut = true; res('timeout'); }, BATCH_TIMEOUT_MS);
    });
    const which = await Promise.race([proc.exited.then(() => 'exited' as const), deadline]);
    if (timer) clearTimeout(timer);
    if (which === 'timeout') {
        proc.kill();
        // Give the kill a bounded moment to land; never await it unconditionally.
        await Promise.race([proc.exited, new Promise(r => setTimeout(r, 5_000))]);
    }

    const [out, err] = await Promise.all([
        new Response(proc.stdout).text().catch(() => ''),
        new Response(proc.stderr).text().catch(() => ''),
    ]);
    return { exitCode: timedOut ? null : proc.exitCode, timedOut, output: `${err}\n${out}`, ms: Date.now() - t0 };
}

/**
 * Pull the FILE-level testsuites out of a junit report.
 *
 * Bun nests a `<testsuite>` per describe-block inside the per-file one, and every element carries the
 * same `file=` attribute — so "count all testsuites" double-counts wildly. The file-level element is
 * the one whose `name` EQUALS its `file`; the describe-level ones are named after the describe.
 */
function parseJunit(xml: string): Map<string, { tests: number; failures: number; skipped: number }> {
    const out = new Map<string, { tests: number; failures: number; skipped: number }>();
    const re = /<testsuite\s+name="([^"]*)"\s+file="([^"]*)"\s+tests="(\d+)"\s+assertions="\d+"\s+failures="(\d+)"\s+skipped="(\d+)"/g;
    for (const m of xml.matchAll(re)) {
        const [, name, file, tests, failures, skipped] = m;
        if (name !== file) continue;                       // a describe block, not the file
        const k = keyOf(file!);
        const prev = out.get(k) ?? { tests: 0, failures: 0, skipped: 0 };
        out.set(k, {
            tests: prev.tests + Number(tests), failures: prev.failures + Number(failures),
            skipped: prev.skipped + Number(skipped),
        });
    }
    return out;
}

/** The Bun-crash signature, so the report can quote WHY a batch produced nothing. */
function panicNote(out: string): string {
    const m = /panic\([^)]*\)[^\n]*|Internal assertion failure|Segmentation fault[^\n]*|oh no: Bun has crashed[^\n]*/i.exec(out);
    return m ? m[0].trim().slice(0, 160) : '';
}

// -----------------------------------------------------------------------------------------------------
// THE RECURSIVE GROUP RUNNER — run, classify, and on a PANIC split in half and say so
// -----------------------------------------------------------------------------------------------------
const results = new Map<string, FileResult>();
const events: string[] = [];
const splits: string[] = [];
let tmpSeq = 0;

async function runGroup(batch: string[], label: string, tmp: string): Promise<void> {
    const xmlPath = join(tmp, `g${tmpSeq++}.xml`);
    const outcome = await spawnBunTest(batch, xmlPath);
    const xml = existsSync(xmlPath) ? readFileSync(xmlPath, 'utf8') : '';
    const reported = parseJunit(xml);
    const missing = batch.filter(f => !reported.has(keyOf(f)));
    const failures = batch.reduce((n, f) => n + (reported.get(keyOf(f))?.failures ?? 0), 0);
    const passes = batch.reduce((n, f) => { const r = reported.get(keyOf(f)); return n + (r ? r.tests - r.failures : 0); }, 0);
    const note = panicNote(outcome.output);

    // ---- CLASSIFY. Four states, and the ORDER matters: a timeout is not a panic, and a batch that
    // exited non-zero having reported NOTHING is not "0 fail".
    let state: RunState;
    if (outcome.timedOut) state = 'TIMEOUT';
    else if (reported.size === 0 && outcome.exitCode !== 0) state = 'PANIC';
    else if (missing.length > 0) state = 'PANIC';        // partial: some files never got to run
    else if (failures > 0) state = 'FAIL';
    else state = 'ok';

    const head = `[gate] ${label.padEnd(7)} ${String(batch.length).padStart(2)} file(s) ` +
        `exit=${outcome.timedOut ? 'KILLED' : outcome.exitCode} ${(outcome.ms / 1000).toFixed(1)}s`;
    if (state === 'ok') {
        console.log(`${head} pass=${passes} fail=0`);
    } else if (state === 'FAIL') {
        console.log(`${head} pass=${passes} ⛔ fail=${failures}`);
    } else if (state === 'TIMEOUT') {
        console.error(`${head} ⛔ TIMEOUT after ${(BATCH_TIMEOUT_MS / 1000).toFixed(0)}s — the process was KILLED. ` +
            `${missing.length} file(s) never reported. A hung suite, NOT a crash.`);
    } else {
        console.error(`${head} ⛔ PANIC — Bun died with ${missing.length} of ${batch.length} file(s) unreported ` +
            `(${passes} test(s) did run and are NOT a green result)${note ? `: ${note}` : ''}`);
    }
    if (note) events.push(`${label}: ${note}`);

    // ---- RECORD the files that DID report, whatever the batch state.
    for (const f of batch) {
        const r = reported.get(keyOf(f));
        if (!r) continue;
        results.set(keyOf(f), {
            file: f, ...r, group: label, ms: outcome.ms,
            state: r.failures > 0 ? 'FAIL' : 'ok',
        });
    }
    if (missing.length === 0) return;

    // ---- RECOVER: split in half and ANNOUNCE it. A silent retry that turns red green is worse than
    // the crash it hides. Bottoms out at one file per process.
    if (RECOVER && missing.length > 1) {
        const half = Math.ceil(missing.length / 2);
        const parts = [missing.slice(0, half), missing.slice(half)];
        const line = `${label} ${state} -> SPLIT into ${parts[0]!.length}+${parts[1]!.length} ` +
            `(${missing.length} unreported file(s) re-run in smaller processes)`;
        splits.push(line);
        console.error(`[gate] ⛔ ${line}`);
        for (let i = 0; i < parts.length; i++) await runGroup(parts[i]!, `${label}.${i}`, tmp);
        return;
    }
    if (RECOVER && missing.length === 1 && batch.length > 1) {
        const line = `${label} ${state} -> ISOLATING ${missing[0]}`;
        splits.push(line);
        console.error(`[gate] ⛔ ${line}`);
        await runGroup(missing, `${label}.0`, tmp);
        return;
    }

    // ---- BOTTOM: a single file that still did not report. It gets the batch's state, never 0/0/ok.
    for (const f of missing) {
        results.set(keyOf(f), {
            file: f, tests: 0, failures: 0, skipped: 0, group: label, ms: outcome.ms,
            state: state === 'ok' ? 'PANIC' : state,
        });
    }
}

// -----------------------------------------------------------------------------------------------------
// MAIN
// -----------------------------------------------------------------------------------------------------
if (files.length === 0) {
    console.error(`[gate] no *.test.ts under ${SIM_DIR}${FILTER ? ` matching "${FILTER}"` : ''}`);
    process.exit(1);
}

const batches: string[][] = [];
for (let i = 0; i < files.length; i += BATCH_SIZE) batches.push(files.slice(i, i + BATCH_SIZE));

console.log(`[gate] ${files.length} test file(s) in ${batches.length} batch(es) of <=${BATCH_SIZE}, ` +
    `${BATCH_TIMEOUT_MS / 1000}s per batch, recover=${RECOVER ? 'split-in-half' : 'OFF'} — bun ${Bun.version}`);

const tmp = mkdtempSync(join(tmpdir(), 'simgate-'));
const t0 = Date.now();
try {
    for (let b = 0; b < batches.length; b++) await runGroup(batches[b]!, `b${b + 1}/${batches.length}`, tmp);
} finally {
    rmSync(tmp, { recursive: true, force: true });
}

// -----------------------------------------------------------------------------------------------------
// THE TABLE
// -----------------------------------------------------------------------------------------------------
const rows = [...results.values()].sort((a, b) => a.file.localeCompare(b.file));
const w = Math.max(4, ...rows.map(r => r.file.length));
console.log('');
console.log(`${'file'.padEnd(w)}  ${'pass'.padStart(5)} ${'fail'.padStart(4)} ${'skip'.padStart(4)}  state`);
console.log('-'.repeat(w + 26));
for (const r of rows) {
    console.log(`${r.file.padEnd(w)}  ${String(r.tests - r.failures).padStart(5)} ${String(r.failures).padStart(4)} ` +
        `${String(r.skipped).padStart(4)}  ${r.state}`);
}

const totalTests = rows.reduce((n, r) => n + r.tests, 0);
const totalFail = rows.reduce((n, r) => n + r.failures, 0);
const totalSkip = rows.reduce((n, r) => n + r.skipped, 0);
const panicked = rows.filter(r => r.state === 'PANIC');
const timedOut = rows.filter(r => r.state === 'TIMEOUT');
console.log('-'.repeat(w + 26));
console.log(`${'TOTAL'.padEnd(w)}  ${String(totalTests - totalFail).padStart(5)} ${String(totalFail).padStart(4)} ` +
    `${String(totalSkip).padStart(4)}  ${rows.length} files, ${((Date.now() - t0) / 1000).toFixed(1)}s`);

for (const s of splits) console.log(`[gate] SPLIT ${s}`);
for (const e of events) console.log(`[gate] ⛔ ${e}`);
if (panicked.length) {
    console.error(`[gate] ⛔ ${panicked.length} file(s) NEVER RAN (Bun panic): ${panicked.map(r => r.file).join(', ')} ` +
        `— this is NOT "0 failures". Re-run those with --solo.`);
}
if (timedOut.length) {
    console.error(`[gate] ⛔ ${timedOut.length} file(s) TIMED OUT: ${timedOut.map(r => r.file).join(', ')} ` +
        `— raise --timeout-ms or find the unbounded await.`);
}
if (rows.length !== files.length) {
    console.error(`[gate] ⛔ ${files.length - rows.length} discovered file(s) produced NO ROW AT ALL — the runner lost them.`);
}

if (JSON_OUT) {
    writeFileSync(JSON_OUT, JSON.stringify({
        bun: Bun.version, batchSize: BATCH_SIZE, discovered: files.length, reported: rows.length,
        pass: totalTests - totalFail, fail: totalFail, skip: totalSkip,
        panicked: panicked.map(r => r.file), timedOut: timedOut.map(r => r.file), splits, events,
        ms: Date.now() - t0, rows,
    }, null, 2));
    console.log(`[gate] wrote ${JSON_OUT}`);
}

const ok = totalFail === 0 && panicked.length === 0 && timedOut.length === 0 && rows.length === files.length;
console.log(`[gate] ${ok ? 'PASS' : 'FAIL'} — ${totalTests - totalFail} pass / ${totalFail} fail across ${rows.length}/${files.length} files` +
    (ok ? '' : ` (${totalFail} failed, ${panicked.length} panicked, ${timedOut.length} timed out)`));
process.exit(ok ? 0 : 1);
