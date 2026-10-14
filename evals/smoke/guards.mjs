#!/usr/bin/env node
// Smoke: one planted PreToolUse event per guard is piped into hooks/dispatch.mjs of an installed kit and must be
// denied; its clean twin must not be. Runs in a throwaway git repo after `fk init`, with its own FK_HOME.
//   node evals/smoke/guards.mjs <founder-kit plugin dir>
// No Claude login or network needed. Prints every payload and the dispatcher's reply on failure.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const kit = path.resolve(process.argv[2] || '');
const dispatch = path.join(kit, 'hooks', 'dispatch.mjs');
const cli = path.join(kit, 'bin', 'fk.mjs');
if (!fs.existsSync(dispatch) || !fs.existsSync(cli)) {
  console.log(`guards: no founder-kit plugin at "${kit}" (expected hooks/dispatch.mjs and bin/fk.mjs)`);
  process.exit(2);
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fk-smoke-'));
const env = { ...process.env, FK_HOME: path.join(tmp, 'fk-home'), FK_OMC_LATEST: 'none', CLAUDE_PLUGIN_ROOT: kit };
const repo = path.join(tmp, 'repo');
fs.mkdirSync(repo);
const sh = (cmd, args, opts = {}) => spawnSync(cmd, args, { cwd: repo, env, encoding: 'utf8', ...opts });
sh('git', ['init', '-q']);
// Install guard in enforce mode, as after the founder's first approval (otherwise it only logs "would-deny").
fs.mkdirSync(path.join(repo, '.fk'));
fs.writeFileSync(path.join(repo, '.fk', 'toolchain.json'), JSON.stringify({ approved: ['eslint@9.12.0'], enforce: true }, null, 2) + '\n');
const init = sh(process.execPath, [cli, 'init']);
if (init.status !== 0) { console.log(`guards: fk init failed (exit ${init.status})\n${init.stdout}${init.stderr}`); process.exit(1); }

// The fake key is assembled at run time so secret scanners never see it in this file.
const fakeKey = 'AKIA' + 'Q7WERTYUIOPASDF2';
const CASES = [
  ['secret written into source', 'deny', 'Write', { file_path: path.join(repo, 'src', 'a.js'), content: `const k = "${fakeKey}";\n` }],
  ['clean twin: key read from the environment', 'allow', 'Write', { file_path: path.join(repo, 'src', 'a.js'), content: 'const k = process.env.AWS_KEY;\n' }],
  ['git commit --no-verify', 'deny', 'Bash', { command: 'git commit --no-verify -m "wip"' }],
  ['clean twin: git commit', 'allow', 'Bash', { command: 'git commit -m "wip"' }],
  ['global install of x@latest', 'deny', 'Bash', { command: 'npm i -g x@latest' }],
  ['clean twin: approved pinned tool', 'allow', 'Bash', { command: 'npm i -g eslint@9.12.0' }],
];

let failed = 0;
for (const [name, want, tool_name, tool_input] of CASES) {
  const payload = { hook_event_name: 'PreToolUse', cwd: repo, session_id: 'smoke', tool_name, tool_input };
  const r = spawnSync(process.execPath, [dispatch, 'PreToolUse'], { input: JSON.stringify(payload), env, encoding: 'utf8' });
  let decision = 'allow';
  try { decision = (r.stdout ? JSON.parse(r.stdout) : {})?.hookSpecificOutput?.permissionDecision || 'allow'; } catch { decision = 'unreadable output'; }
  const ok = r.status === 0 && (want === 'deny' ? decision === 'deny' : decision !== 'deny');
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}: expected ${want}, got ${decision}`);
  if (!ok) {
    failed++;
    console.log(`      payload: ${JSON.stringify(payload)}`);
    console.log(`      exit ${r.status}; stdout: ${r.stdout || '(empty)'}; stderr: ${(r.stderr || '(empty)').trim()}`);
  }
}
fs.rmSync(tmp, { recursive: true, force: true });
console.log(failed ? `guards: ${failed} of ${CASES.length} checks failed` : `guards: all ${CASES.length} checks passed`);
process.exit(failed ? 1 : 0);
