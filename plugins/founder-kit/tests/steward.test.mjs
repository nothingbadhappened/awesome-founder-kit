// Steward: ledger, sweep, provider catalog, budget plan/check, session note throttling, founder actions. No network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { takeSnapshot, writeJson, readSnapshot } from '../hooks/lib.mjs';
import { fingerprint } from '../bin/cmd/steward/lib.mjs';
import { alive } from '../bin/cmd/steward/proc.mjs';

process.env.FK_HOME ||= fs.mkdtempSync(path.join(os.tmpdir(), 'fk-home-')); // kit state stays out of the real home

const KIT = path.join(import.meta.dirname, '..');
const FK = path.join(KIT, 'bin', 'fk.mjs');
const CATALOG = path.join(KIT, 'catalog', 'providers');
const PROVIDERS = ['aws', 'gcp', 'azure', 'vercel', 'netlify', 'cloudflare', 'railway', 'render', 'fly', 'supabase', 'neon', 'firebase',
  'openai', 'anthropic', 'openrouter', 'replicate', 'fal', 'stripe'];
const OTHER_FP = 'ffffffffffff';

// Fake CLIs on PATH: docker (state in a JSON file, calls logged) and aws (fixed answers).
const FAKE = `import fs from 'node:fs';
const [tool, ...a] = process.argv.slice(2);
fs.appendFileSync(process.env.FAKE_LOG, tool + ' ' + a.join(' ') + '\\n');
if (tool === 'aws') {
  const j = a.join(' ');
  if (j.startsWith('sts get-caller-identity')) process.stdout.write('123456789012\\n');
  else if (j.startsWith('budgets describe-budgets')) process.stdout.write(JSON.stringify({ Budgets: [{ BudgetName: 'b', BudgetLimit: { Amount: '50.0', Unit: 'USD' } }] }));
  else if (j.startsWith('budgets describe-budget-actions-for-account')) process.stdout.write(JSON.stringify({ Actions: [{ ActionId: 'x' }] }));
  process.exit(0);
}
const st = JSON.parse(fs.readFileSync(process.env.FAKE_DOCKER_STATE, 'utf8'));
const save = () => fs.writeFileSync(process.env.FAKE_DOCKER_STATE, JSON.stringify(st));
const label = (a[a.indexOf('--filter') + 1] || '').replace(/^label=/, '');
const has = (o) => !label || (o.labels || []).includes(label);
if (a[0] === 'ps') process.stdout.write(st.containers.filter(has).map((c) => c.id + ':' + c.name).join('\\n'));
else if (a[0] === 'volume' && a[1] === 'ls') process.stdout.write(st.volumes.filter(has).map((v) => v.name).join('\\n'));
else if (a[0] === 'rm') { st.containers = st.containers.filter((c) => c.id !== a.at(-1) && c.name !== a.at(-1)); save(); }
else if (a[0] === 'volume' && a[1] === 'rm') { st.volumes = st.volumes.filter((v) => v.name !== a.at(-1)); save(); }
`;

function fakeBin(dir) {
  const bin = path.join(dir, 'fakebin');
  fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(path.join(bin, 'fake.mjs'), FAKE);
  for (const t of ['docker', 'aws']) {
    fs.writeFileSync(path.join(bin, `${t}.cmd`), `@"${process.execPath}" "%~dp0fake.mjs" ${t} %*\r\n`);
    fs.writeFileSync(path.join(bin, t), `#!/bin/sh\nexec "${process.execPath}" "$(dirname "$0")/fake.mjs" ${t} "$@"\n`, { mode: 0o755 });
  }
  return bin;
}

function envWith(bin, extra = {}) {
  const env = { ...process.env, ...extra };
  const key = Object.keys(env).find((k) => k.toUpperCase() === 'PATH') || 'PATH';
  env[key] = bin + path.delimiter + env[key];
  return env;
}

function project() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fk-steward-'));
  spawnSync('git', ['init', '-q'], { cwd: dir });
  const r = spawnSync(process.execPath, [FK, 'init'], { cwd: dir, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const bin = fakeBin(dir);
  const state = path.join(dir, 'docker-state.json');
  const log = path.join(dir, 'fake.log');
  fs.writeFileSync(log, '');
  fs.writeFileSync(state, JSON.stringify({ containers: [], volumes: [] }));
  const env = (extra) => envWith(bin, { FAKE_DOCKER_STATE: state, FAKE_LOG: log, ...extra });
  const fk = (args, extra) => spawnSync(process.execPath, [FK, ...args], { cwd: dir, encoding: 'utf8', env: env(extra) });
  return { dir, fk, state, log, fp: fingerprint(dir), calls: () => fs.readFileSync(log, 'utf8') };
}
const cleanup = (dir) => fs.rmSync(dir, { recursive: true, force: true });
const sleeper = () => spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
const isAlive = (pid) => alive(pid); // the kit's check: zombies (exited, unreaped) count as gone
const ledgerRows = (dir) => fs.readFileSync(path.join(dir, '.fk', 'ledger.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const waitGone = (pid) => { const until = Date.now() + 5000; while (isAlive(pid) && Date.now() < until) spawnSync(process.execPath, ['-e', 'setTimeout(()=>{},100)']); return !isAlive(pid); };

test('ledger add + sweep: dry run touches nothing; sweep stops only our entries and labelled containers; data needs --include-data', () => {
  const p = project();
  const child = sleeper(), other = sleeper();
  try {
    fs.writeFileSync(p.state, JSON.stringify({
      containers: [
        { id: 'aaaaaaaaaaaa', name: 'ours', labels: [`fk.fingerprint=${p.fp}`] },
        { id: 'bbbbbbbbbbbb', name: 'theirs', labels: [`fk.fingerprint=${OTHER_FP}`] },
        { id: 'cccccccccccc', name: 'keepme', labels: [`fk.fingerprint=${p.fp}`] },
      ],
      volumes: [{ name: 'ourdata', labels: [`fk.fingerprint=${p.fp}`] }, { name: 'theirdata', labels: [`fk.fingerprint=${OTHER_FP}`] }],
    }));
    let r = p.fk(['ledger', 'add', 'dev-server', 'web', '--pid', String(child.pid), '--port', '3000']);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.equal(p.fk(['ledger', 'add', 'process', 'ghost', '--pid', '999999']).status, 0);
    assert.equal(p.fk(['ledger', 'add', 'process', 'reused', '--pid', String(other.pid), '--cmd', 'python']).status, 0);
    assert.equal(p.fk(['ledger', 'add', 'container', 'keepme', '--pre-existing']).status, 0);
    const rows = ledgerRows(p.dir);
    assert.equal(rows[0].cmd, 'node');
    assert.ok(rows.every((e) => e.fp === p.fp && !JSON.stringify(e).includes(p.dir.replace(/\\/g, '\\\\'))), 'no raw project path in the ledger');

    r = p.fk(['sweep', '--dry-run']);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /would stop\s+dev-server web/);
    assert.match(r.stdout, /would remove container ours/);
    assert.match(r.stdout, /kept\s+container keepme: marked pre-existing/);
    assert.match(r.stdout, /volume ourdata \(labelled\): holds data/);
    assert.doesNotMatch(r.stdout, /theirs|theirdata/);
    assert.match(r.stdout, /Nothing was changed/);
    assert.doesNotMatch(p.calls(), /^docker (rm|volume rm)/m);
    assert.ok(isAlive(child.pid));

    r = p.fk(['sweep']);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.ok(waitGone(child.pid), 'our dev server was stopped');
    assert.ok(isAlive(other.pid), 'a process whose name no longer matches is left alone');
    const calls = p.calls();
    assert.match(calls, /^docker rm -f aaaaaaaaaaaa$/m);
    assert.doesNotMatch(calls, /^docker rm .*(bbbbbbbbbbbb|cccccccccccc|keepme)/m);
    assert.doesNotMatch(calls, /^docker volume rm/m);
    const left = ledgerRows(p.dir).map((e) => e.id);
    assert.deepEqual(left.sort(), ['keepme'], 'stopped, gone and reused entries cleared; pre-existing kept');

    r = p.fk(['sweep', '--include-data']);
    assert.match(p.calls(), /^docker volume rm ourdata$/m);
    assert.doesNotMatch(p.calls(), /volume rm theirdata/);
  } finally { child.kill(); other.kill(); cleanup(p.dir); }
});

test('sweep never touches another checkout\'s entries or pre-existing items', () => {
  const p = project();
  const proc = sleeper();
  const theirTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fk-their-'));
  const preTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fk-pre-'));
  const ourTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fk-our-'));
  try {
    fs.appendFileSync(path.join(p.dir, '.fk', 'ledger.jsonl'),
      JSON.stringify({ ts: new Date().toISOString(), fp: OTHER_FP, kind: 'tmpdir', id: theirTmp }) + '\n'
      + JSON.stringify({ ts: new Date().toISOString(), fp: OTHER_FP, kind: 'dev-server', id: 'x', pid: proc.pid, cmd: 'node' }) + '\n');
    assert.equal(p.fk(['ledger', 'add', 'tmpdir', preTmp, '--pre-existing']).status, 0);
    assert.equal(p.fk(['ledger', 'add', 'tmpdir', ourTmp]).status, 0);
    const r = p.fk(['sweep']);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.ok(!fs.existsSync(ourTmp), 'our temp folder removed');
    assert.ok(fs.existsSync(theirTmp), 'other checkout\'s temp folder untouched');
    assert.ok(fs.existsSync(preTmp), 'pre-existing temp folder untouched');
    assert.ok(isAlive(proc.pid), 'other checkout\'s process untouched');
    const fps = ledgerRows(p.dir).map((e) => e.fp);
    assert.equal(fps.filter((f) => f === OTHER_FP).length, 2, 'other entries stay in the ledger');
  } finally { proc.kill(); for (const d of [p.dir, theirTmp, preTmp, ourTmp]) cleanup(d); }
});

test('sweep keeps entries within their TTL and reminds nothing until expired', () => {
  const p = project();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fk-ttl-'));
  try {
    assert.equal(p.fk(['ledger', 'add', 'tmpdir', tmp, '--ttl', '2h']).status, 0);
    const r = p.fk(['sweep']);
    assert.match(r.stdout, /still within its time limit/);
    assert.ok(fs.existsSync(tmp));
    assert.equal(p.fk(['ledger', 'add', 'tmpdir', tmp, '--ttl', 'soon']).status, 1);
  } finally { cleanup(p.dir); cleanup(tmp); }
});

test('provider catalog: every provider present with the required fields', () => {
  const files = fs.readdirSync(CATALOG).filter((f) => f.endsWith('.json'));
  assert.deepEqual(files.map((f) => f.replace(/\.json$/, '')).sort(), [...PROVIDERS].sort());
  for (const p of PROVIDERS) {
    const c = JSON.parse(fs.readFileSync(path.join(CATALOG, `${p}.json`), 'utf8'));
    assert.equal(c.provider, p);
    assert.ok(['yes', 'no', 'partial'].includes(c.hard_cap), `${p} hard_cap`);
    assert.ok(Array.isArray(c.how_to_set) && c.how_to_set.length && c.how_to_set.every((s) => typeof s === 'string' && s.length), `${p} how_to_set`);
    assert.ok(typeof c.kill_switch === 'string' && c.kill_switch.length, `${p} kill_switch`);
    assert.ok(Array.isArray(c.traps) && c.traps.length, `${p} traps`);
    assert.ok(Number.isInteger(c.billing_safety_score) && c.billing_safety_score >= 0 && c.billing_safety_score <= 10, `${p} score`);
    assert.equal(c.verified, '2026-10-14');
    assert.ok(Array.isArray(c.sources) && c.sources.length && c.sources.every((u) => /^https:\/\//.test(u)), `${p} sources`);
    assert.ok(Array.isArray(c.unverified), `${p} unverified list`);
    assert.ok(/^https:\/\//.test(c.signup) && /^https:\/\//.test(c.billing_url), `${p} links`);
    assert.ok(Array.isArray(c.env_keys), `${p} env_keys`);
  }
  const hard = PROVIDERS.filter((p) => JSON.parse(fs.readFileSync(path.join(CATALOG, `${p}.json`), 'utf8')).hard_cap === 'yes');
  for (const p of ['vercel', 'netlify', 'railway', 'openai', 'anthropic', 'openrouter']) assert.ok(hard.includes(p), `${p} has a hard cap (design 9.3)`);
  for (const p of ['aws', 'gcp', 'neon', 'fly']) assert.ok(!hard.includes(p), `${p} is alert-only (design 9.3)`);
});

test('budget plan writes budget-as-code for aws, gcp and vercel, never overwrites, applies nothing', () => {
  const p = project();
  try {
    let r = p.fk(['budget', 'plan', 'aws', '50']);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    for (const f of ['budget.tf', 'deny-policy.json', 'budget.json', 'notifications.json', 'README.md']) assert.ok(fs.existsSync(path.join(p.dir, 'infra', 'budgets', 'aws', f)), f);
    const tf = fs.readFileSync(path.join(p.dir, 'infra', 'budgets', 'aws', 'budget.tf'), 'utf8');
    assert.match(tf, /limit_amount = "50"/);
    assert.match(tf, /aws_budgets_budget_action/);
    assert.doesNotMatch(tf, /\{\{/);
    assert.match(r.stdout, /fk-approve budget aws 50$/m);
    assert.doesNotMatch(p.calls(), /aws /, 'nothing applied');

    r = p.fk(['budget', 'plan', 'gcp', '30']);
    assert.equal(r.status, 0);
    for (const f of ['main.tf', 'README.md', 'function/main.py', 'function/requirements.txt']) assert.ok(fs.existsSync(path.join(p.dir, 'infra', 'budgets', 'gcp', f)), f);
    const main = fs.readFileSync(path.join(p.dir, 'infra', 'budgets', 'gcp', 'main.tf'), 'utf8');
    assert.match(main, /units\s+= "30"/);
    assert.match(main, /pubsub_topic/);
    assert.match(fs.readFileSync(path.join(p.dir, 'infra', 'budgets', 'gcp', 'function', 'main.py'), 'utf8'), /DRY_RUN/);

    r = p.fk(['budget', 'plan', 'vercel', '$20']);
    assert.equal(r.status, 0);
    const steps = fs.readFileSync(path.join(p.dir, 'infra', 'budgets', 'vercel', 'STEPS.md'), 'utf8');
    assert.match(steps, /Spend Management/);
    assert.match(r.stdout, /fk-approve budget vercel 20 hard-cap/);

    fs.writeFileSync(path.join(p.dir, 'infra', 'budgets', 'vercel', 'STEPS.md'), 'edited');
    r = p.fk(['budget', 'plan', 'vercel', '99']);
    assert.match(r.stdout, /kept\s+infra\/budgets\/vercel\/STEPS.md/);
    assert.equal(fs.readFileSync(path.join(p.dir, 'infra', 'budgets', 'vercel', 'STEPS.md'), 'utf8'), 'edited');

    assert.equal(p.fk(['budget', 'plan', 'nimbus', '10']).status, 1);
    assert.equal(p.fk(['budget', 'plan', 'aws', 'lots']).status, 1);
  } finally { cleanup(p.dir); }
});

test('budget check reads a cap back through a (fake) provider CLI and says unverified where it cannot', () => {
  const p = project();
  try {
    writeJson(path.join(p.dir, '.fk', 'budgets.json'), { providers: { aws: { monthly_usd: 50, hard_cap: false }, vercel: { monthly_usd: 20, hard_cap: true } } });
    takeSnapshot(p.dir);
    const r = p.fk(['budget', 'check']);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /^verified\s+aws .*\$50.*budget action/m);
    assert.match(r.stdout, /^unverified\s+vercel/m);
  } finally { cleanup(p.dir); }
});

test('budget usage runs ccusage only when approved', () => {
  const p = project();
  try {
    const r = p.fk(['budget', 'usage']);
    assert.match(r.stdout, /not approved/);
    assert.match(r.stdout, /\/usage/);
  } finally { cleanup(p.dir); }
});

test('session note: baseline silent, one note at a time, throttled', async () => {
  const p = project();
  try {
    const { default: steward } = await import(pathToFileURL(path.join(KIT, 'hooks', 'session', '20-steward.mjs')).href);
    const t0 = Date.now();
    const H = 3600e3, D = 24 * H;
    assert.equal(steward({ root: p.dir, now: t0 }), undefined, 'first session sets the baseline');
    fs.appendFileSync(path.join(p.dir, '.fk', 'ledger.jsonl'), JSON.stringify({ fp: p.fp, kind: 'dev-server', id: 'web', pid: 1, ttl_until: new Date(t0 - H).toISOString() }) + '\n');
    assert.match(steward({ root: p.dir, now: t0 + 60e3 }), /past their time limit/);
    assert.equal(steward({ root: p.dir, now: t0 + 120e3 }), undefined, 'throttled for 12 h');
    assert.match(steward({ root: p.dir, now: t0 + 13 * H }), /past their time limit/);
    fs.writeFileSync(path.join(p.dir, '.fk', 'ledger.jsonl'), '');
    const weekly = steward({ root: p.dir, now: t0 + 8 * D });
    assert.match(weekly, /weekly upkeep/);
    assert.equal(weekly.split('\n').length, 1, 'one note only');
    assert.equal(steward({ root: p.dir, now: t0 + 8 * D + H }), undefined);
    const old = new Date(t0 - 100 * D);
    fs.utimesSync(path.join(p.dir, '.fk', 'toolchain.json'), old, old);
    assert.match(steward({ root: p.dir, now: t0 + 8 * D + 2 * H }), /over 90 days/);
    assert.equal(steward({ root: p.dir, now: t0 + 8 * D + 3 * H }), undefined);
    // the state write is sanctioned: no gate tamper on the next tool call
    const snap = readSnapshot(p.dir);
    assert.ok(snap.files['.fk/steward.json']);
    // a recent sweep resets the weekly clock
    assert.equal(p.fk(['sweep']).status, 0);
    assert.equal(steward({ root: p.dir, now: Date.now() + 2 * D }), undefined);
  } finally { cleanup(p.dir); }
});

test('session hook runs inside the dispatcher without breaking SessionStart', async () => {
  const p = project();
  try {
    const { runHook } = await import('../hooks/selftest.mjs');
    const r = runHook(p.dir, 'SessionStart', { source: 'startup' });
    assert.equal(r.code, 0, r.stderr);
    assert.ok(fs.existsSync(path.join(p.dir, '.fk', 'steward.json')));
  } finally { cleanup(p.dir); }
});

test('fk actions writes one checklist, key names only, keeps ticks and reasons; verify ticks what it can check', () => {
  const p = project();
  try {
    fs.writeFileSync(path.join(p.dir, 'package.json'), JSON.stringify({ dependencies: { '@supabase/supabase-js': '2.45.0', stripe: '16.0.0' } }));
    fs.writeFileSync(path.join(p.dir, 'vercel.json'), '{}');
    fs.writeFileSync(path.join(p.dir, '.env.example'), 'SUPABASE_URL=\nSTRIPE_SECRET_KEY=\n');
    fs.writeFileSync(path.join(p.dir, '.env'), 'SUPABASE_URL=https://example.invalid\nSTRIPE_SECRET_KEY=\n');
    writeJson(path.join(p.dir, '.fk', 'budgets.json'), { providers: { vercel: { monthly_usd: 20, hard_cap: true } } });
    takeSnapshot(p.dir);
    const noKey = { ANTHROPIC_API_KEY: '' };
    let r = p.fk(['actions'], noKey);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const file = path.join(p.dir, 'docs', 'process', 'founder-actions.md');
    let md = fs.readFileSync(file, 'utf8');
    for (const id of ['account:vercel', 'account:supabase', 'account:stripe', 'env:SUPABASE_URL', 'env:STRIPE_SECRET_KEY', 'cap:vercel', 'cap:supabase', 'accept:supabase', 'claude:billing', 'approve:deploy'])
      assert.match(md, new RegExp(`<!-- fk:${id} -->`), id);
    assert.doesNotMatch(md, /example\.invalid/, 'never a value');
    assert.doesNotMatch(md, /accept:vercel/, 'hard-cap provider needs no written reason');
    assert.doesNotMatch(md, /accept:stripe/, 'fee-only provider needs no cap reason');
    assert.match(md, /- \[x\] Put `SUPABASE_URL`/);
    assert.match(md, /- \[ \] Put `STRIPE_SECRET_KEY`/);

    md = md.replace(/- \[ \] (Create a Supabase account)/, '- [x] $1').replace(/(fk:accept:supabase -->)/, '$1').replace(/Reason: ____ (\(Kit check: ticked when you write a reason\.\) <!-- fk:accept:supabase -->)/, 'Reason: compute is small and fixed $1');
    fs.writeFileSync(file, md);
    r = p.fk(['actions', 'verify'], noKey);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    md = fs.readFileSync(file, 'utf8');
    assert.match(md, /- \[x\] Create a Supabase account/, 'manual tick kept');
    assert.match(md, /- \[x\] .*Reason: compute is small and fixed .*fk:accept:supabase/, 'reason kept and ticked');
    assert.match(md, /- \[x\] Claude Code uses your subscription/);
    assert.match(md, /- \[ \] .*fk:cap:vercel/, 'vercel cap cannot be read back, so the founder ticks it');
    assert.match(r.stdout, /vercel: unverified/);

    r = p.fk(['actions'], { ANTHROPIC_API_KEY: 'sk-ant-test' });
    md = fs.readFileSync(file, 'utf8');
    assert.match(md, /workspace with a monthly spend limit/);
    assert.doesNotMatch(md, /sk-ant-test/);
  } finally { cleanup(p.dir); }
});
