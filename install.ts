#!/usr/bin/env bun
// install.ts: put rs-sdk-stun-toolkit into an rs-sdk checkout.
//
//   bun install.ts <path/to/rs-sdk> [--dry-run] [--no-bun-install] [--force]
//
// - Checks the checkout's commit against the base the toolkit was built for (2012ab67f) and warns when it differs.
// - Copies every file of overlay/ to the same path in the checkout (new files).
// - Upstream files the toolkit changes ("patched" in MANIFEST.json) are replaced whole ONLY when the checkout's copy is
//   still the pristine base version. Otherwise it tries `git apply patches/<file>.diff`; if that fails it stops with a
//   clear error for that file and leaves it untouched (--force replaces it anyway, after a backup).
// - Idempotent: files that already match are skipped. Any file it overwrites that is not pristine upstream is first
//   copied to <checkout>/.stun-toolkit/backup-<time>/. A record of the install goes to <checkout>/.stun-toolkit/installed.json.
// - Runs `bun install` in the checkout root, server/webclient and server/engine (skip with --no-bun-install).
import { spawnSync } from 'child_process';
import { createHash } from 'crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'fs';
import { dirname, join, resolve } from 'path';

const HERE = import.meta.dir;
const args = process.argv.slice(2);
const flag = (f: string) => args.includes(f);
const target = args.find(a => !a.startsWith('--'));
const DRY = flag('--dry-run'), FORCE = flag('--force'), NO_BUN = flag('--no-bun-install');
if (!target) { console.error('usage: bun install.ts <path/to/rs-sdk> [--dry-run] [--no-bun-install] [--force]'); process.exit(2); }
const T = resolve(target);
if (!existsSync(join(T, 'sdk')) || !existsSync(join(T, 'server', 'webclient')) || !existsSync(join(T, 'server', 'engine'))) {
    console.error(`${T} does not look like an rs-sdk checkout (no sdk/, server/webclient/ or server/engine/)`); process.exit(2);
}
const M = JSON.parse(readFileSync(join(HERE, 'MANIFEST.json'), 'utf8')) as {
    name: string; upstream: { base: string };
    files: { path: string; component: string; kind: 'new' | 'patched'; sha256: string; upstreamBlob?: string; patch?: string }[];
};
const BASE = M.upstream.base;
const sha256 = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const gitBlobId = (b: Buffer) => createHash('sha1').update(`blob ${b.length}\0`).update(b).digest('hex');
const git = (a: string[]) => spawnSync('git', ['-C', T, ...a], { encoding: 'utf8' });

// ---------------------------------------------------------------- 1. base commit check
const head = git(['rev-parse', 'HEAD']);
const HEAD = head.status === 0 ? head.stdout.trim() : '';
console.log(`${M.name} -> ${T}`);
if (!HEAD) console.log(`! ${T} is not a git checkout: cannot verify the upstream base (expected ${BASE.slice(0, 9)}). Patched files are still checked file by file.`);
else if (HEAD.startsWith(BASE) || BASE.startsWith(HEAD)) console.log(`upstream base OK: ${BASE.slice(0, 9)}`);
else {
    const hasBase = git(['cat-file', '-e', BASE + '^{commit}']).status === 0;
    console.log(`! WARNING: this checkout is at ${HEAD.slice(0, 9)}, the toolkit was built and tested on ${BASE.slice(0, 9)}.`);
    if (hasBase) {
        const ahead = git(['rev-list', '--count', `${BASE}..${HEAD}`]).stdout.trim();
        const ours = M.files.filter(f => f.kind === 'patched').map(f => f.path);
        const changed = git(['diff', '--name-only', BASE, HEAD, '--', ...ours]).stdout.trim().split('\n').filter(Boolean);
        const touched = git(['diff', '--name-only', BASE, HEAD, '--', 'server/webclient/src', 'server/engine/src', 'sdk']).stdout.trim().split('\n').filter(Boolean);
        console.log(`  ${ahead || '?'} commit(s) after the base. Upstream changed ${changed.length} of the ${ours.length} files the toolkit patches${changed.length ? ': ' + changed.join(', ') : ''}.`);
        console.log(`  ${touched.length} upstream source file(s) under sdk/, server/webclient/src, server/engine/src changed; what can break:`);
        console.log('  - patched files are merged with `git apply` instead of replaced, and fail loudly if upstream rewrote the same lines;');
        console.log('  - the headless client decodes the server protocol byte by byte: a protocol change upstream breaks login or packet decode;');
        console.log('  - the lockstep engine files replace World.ts and friends: an engine refactor upstream can break the sim engine.');
        console.log(`  For a known-good install: git -C "${T}" checkout ${BASE.slice(0, 9)}`);
    } else console.log(`  (the base commit is not in this clone; fetch it to see what changed: git -C "${T}" fetch origin ${BASE})`);
}

// CRLF checkouts (git's core.autocrlf=true, the Git for Windows default) break the engine's cache build
// (".loc checksum mismatch!") on the first start. Upstream has no .gitattributes, so catch it here.
const probe = join(T, 'server', 'content', 'scripts', 'doors', 'configs', 'doors.loc');
if (existsSync(probe) && readFileSync(probe).includes('\r\n')) {
    console.log(`! WARNING: this checkout has CRLF line endings (core.autocrlf). The local engine will refuse to build its cache`);
    console.log(`  (".loc checksum mismatch!"), so the lockstep sim and quest --sim runs will not start. Re-clone with:`);
    console.log(`    git clone -c core.autocrlf=input https://github.com/MaxBittker/rs-sdk`);
    console.log('  (the offline brain-sim tests do not need the engine and work either way)');
}

// ---------------------------------------------------------------- 2. files
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const BACKUP = join(T, '.stun-toolkit', `backup-${stamp}`);
// what an earlier install wrote (path -> sha256), so an upgrade can replace our own older files safely
const RECORD = join(T, '.stun-toolkit', 'installed.json');
const prev: Record<string, string> = existsSync(RECORD) ? (JSON.parse(readFileSync(RECORD, 'utf8')).files ?? {}) : {};
const counts = { added: 0, replaced: 0, patched: 0, merged: 0, unchanged: 0, failed: 0, backedUp: 0 };
const lines: string[] = [];
const errors: string[] = [];
function backup(rel: string) {
    if (DRY) return;
    mkdirSync(dirname(join(BACKUP, rel)), { recursive: true });
    copyFileSync(join(T, rel), join(BACKUP, rel));
    counts.backedUp++;
}
function put(rel: string) {
    if (DRY) return;
    mkdirSync(dirname(join(T, rel)), { recursive: true });
    copyFileSync(join(HERE, 'overlay', rel), join(T, rel));
}
for (const f of M.files) {
    const dst = join(T, f.path);
    const cur = existsSync(dst) ? readFileSync(dst) : null;
    if (cur && sha256(cur) === f.sha256) { counts.unchanged++; continue; }
    // a file an earlier toolkit install wrote (and nobody edited since): an upgrade, replace it
    if (cur && prev[f.path] === sha256(cur)) { backup(f.path); put(f.path); counts.replaced++; lines.push(`updated (earlier toolkit version, backup kept) ${f.path}`); continue; }
    if (f.kind === 'new') {
        if (cur) { backup(f.path); put(f.path); counts.replaced++; lines.push(`replaced (backup kept)  ${f.path}`); }
        else { put(f.path); counts.added++; }
        continue;
    }
    // patched upstream file
    // pristine = the base blob, also when git checked it out with CRLF line endings (core.autocrlf on Windows)
    const pristine = cur && (gitBlobId(cur) === f.upstreamBlob || gitBlobId(Buffer.from(cur.toString('latin1').replace(/\r\n/g, '\n'), 'latin1')) === f.upstreamBlob);
    if (pristine) { put(f.path); counts.patched++; lines.push(`patched (whole file)    ${f.path}`); continue; }
    if (!cur) { put(f.path); counts.added++; lines.push(`added (missing upstream) ${f.path}`); continue; }
    const diff = join(HERE, f.patch!);
    if (spawnSync('git', ['-C', T, 'apply', '--reverse', '--check', '--ignore-whitespace', diff]).status === 0) { counts.unchanged++; continue; }   // our change is already in (an earlier git apply)
    if (FORCE) { backup(f.path); put(f.path); counts.replaced++; lines.push(`replaced --force (backup kept) ${f.path}`); continue; }
    const check = spawnSync('git', ['-C', T, 'apply', '--check', '--whitespace=nowarn', diff], { encoding: 'utf8' });
    if (check.status === 0) {
        if (!DRY) { backup(f.path); const r = spawnSync('git', ['-C', T, 'apply', '--whitespace=nowarn', diff], { encoding: 'utf8' }); if (r.status !== 0) { errors.push(`${f.path}: git apply failed after a clean check: ${r.stderr.trim()}`); counts.failed++; continue; } }
        counts.merged++; lines.push(`patched (git apply)     ${f.path}`);
    } else {
        counts.failed++;
        errors.push(`${f.path}: differs from upstream ${BASE.slice(0, 9)} (local edits or a newer upstream) and ${f.patch} does not apply:\n      ${check.stderr.trim().split('\n').slice(0, 3).join('\n      ')}\n    Left untouched. Merge ${f.patch} by hand, or re-run with --force to replace it (a backup is kept).`);
    }
}
for (const l of lines) console.log('  ' + l);
console.log(`files: ${counts.added} added, ${counts.patched + counts.merged} upstream files patched (${counts.patched} whole-file, ${counts.merged} git apply), ${counts.replaced} replaced, ${counts.unchanged} already up to date, ${counts.failed} failed${counts.backedUp ? `; ${counts.backedUp} backup(s) in ${BACKUP}` : ''}${DRY ? '  (dry run: nothing written)' : ''}`);
for (const e of errors) console.error('ERROR ' + e);
if (!DRY) {
    mkdirSync(join(T, '.stun-toolkit'), { recursive: true });
    const failed = new Set(errors.map(e => e.split(':')[0]));
    const files: Record<string, string> = { ...prev };
    for (const f of M.files) if (!failed.has(f.path) && existsSync(join(T, f.path))) files[f.path] = sha256(readFileSync(join(T, f.path)));
    writeFileSync(RECORD, JSON.stringify({ name: M.name, base: BASE, checkout: HEAD || null, at: new Date().toISOString(), counts, failed: [...failed], files }, null, 1) + '\n');
    // keep the record and backups out of `git status`
    const ex = join(T, '.git', 'info', 'exclude');
    if (existsSync(dirname(ex)) && !(existsSync(ex) && readFileSync(ex, 'utf8').includes('.stun-toolkit/'))) appendFileSync(ex, '\n.stun-toolkit/\n');
}

// ---------------------------------------------------------------- 3. bun install
if (!NO_BUN && !DRY) {
    for (const d of ['.', 'server/webclient', 'server/engine']) {
        if (!existsSync(join(T, d, 'package.json'))) continue;
        console.log(`bun install in ${d === '.' ? 'the checkout root' : d} ...`);
        const r = spawnSync('bun', ['install'], { cwd: join(T, d), stdio: ['ignore', 'ignore', 'inherit'] });
        if (r.status !== 0) { console.error(`ERROR bun install failed in ${d}`); errors.push(`bun install ${d}`); }
    }
}

// ---------------------------------------------------------------- 4. next steps
const q = (s: string) => (/\s/.test(s) ? `"${s}"` : s);
console.log(`
${errors.length ? 'Install finished WITH ERRORS (see above).' : 'Installed.'} Next steps (see README.md and GUIDE.md):

  # terminal 1: a local lockstep engine (the first start builds the game cache; wait for "World ready")
  cd ${q(T)} && bun tools/lockstep/sim-engine.ts

  # terminal 2: tests (offline; a few read the engine's cache), then a quest against the engine
  cd ${q(join(T, 'server', 'webclient'))}
  bun headless/sim/run-tests.ts                      # brain-sim + navgrid test suite
  bun headless/sim/run-tests.ts --filter=nav         # navgrid tests only (also --filter=door, portal, levels)
  bun ../../tools/lockstep/run-sim.ts headless/speedrun/legs/qp/f2p-a/run-restless-ghost.ts

  # lockstep batches with seeds and every chaos switch on: see GUIDE.md "Lockstep sim"
  bun ${q(join(T, 'tools', 'lockstep', 'quest-batch.ts'))} --help
`);
process.exit(errors.length ? 1 : 0);
