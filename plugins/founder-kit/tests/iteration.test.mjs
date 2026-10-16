import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeFixture, runHook, outcome, PLUGIN_ROOT } from '../hooks/selftest.mjs';
import { readJson, writeJson } from '../hooks/lib.mjs';

const fixtures = [];
const fixture = () => { const d = makeFixture(); fixtures.push(d); return d; };
test.after(() => { for (const d of fixtures) fs.rmSync(d, { recursive: true, force: true }); });

const GEN = { tool_name: 'mcp__studio__generate_image', tool_input: { prompt: 'a poster' } };
const pre = (dir, p = GEN, s = {}) => runHook(dir, 'PreToolUse', { ...p, ...s });
const post = (dir, p = GEN, s = {}) => runHook(dir, 'PostToolUse', { ...p, ...s });
const answer = (dir, s = {}) => post(dir, { tool_name: 'AskUserQuestion', tool_input: { questions: [] }, tool_response: { answers: {} } }, s);
const brief = (dir, s = {}) => { assert.equal(outcome(pre(dir, GEN, s)), 'deny'); answer(dir, s); };
const reason = (res) => res.json.hookSpecificOutput.permissionDecisionReason;

test('a producing call needs a brief the guard asked for, once per session', () => {
  const dir = fixture();
  answer(dir); // an unrelated earlier question does not count as a brief
  const r = pre(dir);
  assert.equal(outcome(r), 'deny');
  assert.match(reason(r), /^fk iteration-guard: .*cheapest preview.*how many attempts/);
  answer(dir);
  assert.equal(outcome(pre(dir)), 'allow');
  assert.equal(outcome(pre(dir, GEN, { session_id: 'other' })), 'deny', 'the brief belongs to one session');
});

test('stops for a check-in after the limit; the founder speaking resets it', () => {
  const dir = fixture();
  brief(dir);
  for (let i = 0; i < 3; i++) { assert.equal(outcome(pre(dir)), 'allow', `call ${i + 1}`); post(dir); }
  const r = pre(dir);
  assert.equal(outcome(r), 'deny');
  assert.match(reason(r), /3 producing calls .* since the founder last spoke \(limit 3\)/);
  runHook(dir, 'UserPromptSubmit', { prompt: 'looks good, two more tries' });
  for (let i = 0; i < 3; i++) assert.equal(outcome(pre(dir)), 'allow');
  assert.equal(outcome(pre(dir)), 'deny');
  answer(dir);
  assert.equal(outcome(pre(dir)), 'allow');
});

test('a parallel batch cannot pass the limit: each allowed call reserves its slot before it runs', () => {
  const dir = fixture();
  brief(dir);
  const got = Array.from({ length: 6 }, () => outcome(pre(dir))); // PreToolUse for the whole batch, no PostToolUse yet
  assert.deepEqual(got, ['allow', 'allow', 'allow', 'deny', 'deny', 'deny']);
});

test('without a session id the guard still works', () => {
  const dir = fixture();
  brief(dir, { session_id: undefined });
  assert.equal(outcome(pre(dir, GEN, { session_id: undefined })), 'allow');
});

test('code work never counts: edits, tests, builds and developer MCP tools', () => {
  const dir = fixture();
  const mcp = (n) => ({ tool_name: `mcp__dev__${n}`, tool_input: {} });
  for (const p of [
    { tool_name: 'Bash', tool_input: { command: 'npm test' } },
    { tool_name: 'Bash', tool_input: { command: 'ffmpeg -i in.mp4 out.webm' } },
    { tool_name: 'Edit', tool_input: { file_path: path.join(dir, 'src.js'), old_string: 'a', new_string: 'b' } },
    ...['create_issue', 'list_drafts', 'regenerate_cache_index', 'generate_cache_index', 'generate_typescript_types', 'browser_generate_locator',
      'compose_up', 'generate_migration', 'generate_embeddings', 'export_csv', 'export_logs', 'render_template', 'video_export_status',
      'list_variations', 'get_variations', 'delete_variation', 'generate_code', 'generate_uuid', 'generate_api_client', 'export_data',
      'render_markdown', 'render_page', 'generate_docs', 'generate_commit_message'].map(mcp),
  ]) assert.equal(outcome(pre(dir, p)), 'allow', p.tool_name + ' ' + JSON.stringify(p.tool_input));
  brief(dir);
  for (let i = 0; i < 5; i++) { pre(dir, mcp('generate_typescript_types')); post(dir, mcp('generate_typescript_types')); }
  assert.equal(outcome(pre(dir)), 'allow', 'non-producing calls leave the count alone');
});

test('producing tools: MCP verbs, known renderers, and founder-listed producers', () => {
  const dir = fixture();
  for (const p of [
    { tool_name: 'mcp__media__video_export', tool_input: {} },
    { tool_name: 'mcp__music__compose', tool_input: {} },
    { tool_name: 'mcp__models__generate_3d', tool_input: {} },
    { tool_name: 'mcp__design__propose_variants', tool_input: {} },
    { tool_name: 'Bash', tool_input: { command: 'npx remotion render src/index.ts Promo out.mp4' } },
    { tool_name: 'PowerShell', tool_input: { command: 'blender -b scene.blend -a' } },
  ]) assert.equal(outcome(pre(dir, p)), 'deny', p.tool_name + ' ' + JSON.stringify(p.tool_input));
  const cfg = path.join(dir, '.fk', 'config.json');
  writeJson(cfg, { ...readJson(cfg, {}), producers: ['mcp__canvas__*', 'cmd:python make_banner.py', 7], not_producers: ['mcp__media__video_export'] });
  assert.equal(outcome(pre(dir, { tool_name: 'mcp__canvas__paint', tool_input: {} })), 'deny');
  assert.equal(outcome(pre(dir, { tool_name: 'Bash', tool_input: { command: 'python make_banner.py --size 2x' } })), 'deny');
  assert.equal(outcome(pre(dir, { tool_name: 'Bash', tool_input: { command: 'python make_banner.py_test.py' } })), 'allow', 'a prefix is a whole word');
  assert.equal(outcome(pre(dir, { tool_name: 'Bash', tool_input: { command: 'python other.py' } })), 'allow');
  assert.equal(outcome(pre(dir, { tool_name: 'mcp__media__video_export', tool_input: {} })), 'allow', 'not_producers wins');
});

test('hooks.json routes AskUserQuestion answers to PostToolUse', () => {
  const hooks = readJson(path.join(PLUGIN_ROOT, 'hooks', 'hooks.json'));
  assert.ok(hooks.hooks.PostToolUse.some((h) => new RegExp(h.matcher).test('AskUserQuestion')));
});

test('fk-approve rounds sets the limit or turns the guard off; tampering falls back to the default', () => {
  const dir = fixture();
  brief(dir);
  assert.match(runHook(dir, 'UserPromptSubmit', { prompt: 'fk-approve rounds 1' }).stdout, /limit to 1 generate\/render call/);
  assert.equal(outcome(pre(dir)), 'allow');
  assert.equal(outcome(pre(dir)), 'deny');
  assert.match(runHook(dir, 'UserPromptSubmit', { prompt: 'fk-approve rounds 0' }).stdout, /not understood/);
  assert.match(runHook(dir, 'UserPromptSubmit', { prompt: 'fk-approve rounds off' }).stdout, /turned the iteration-guard off/);
  assert.equal(outcome(pre(dir, GEN, { session_id: 'fresh' })), 'allow', 'off: no brief needed either');
  writeJson(path.join(dir, '.fk', 'iteration.json'), { limit: 999 });
  assert.equal(outcome(pre(dir, GEN, { session_id: 'fresh' })), 'deny', 'an agent-written file is not trusted');
  assert.equal(outcome(pre(dir, { tool_name: 'Write', tool_input: { file_path: path.join(dir, '.fk', 'iteration.json'), content: '{"limit":0}' } })), 'deny', 'gate-guard protects it');
});

test('a founder override lifts the guard for its session only', () => {
  const dir = fixture();
  runHook(dir, 'UserPromptSubmit', { prompt: 'fk-override iteration-guard batch of 20 product shots, already briefed' });
  assert.equal(outcome(pre(dir)), 'allow');
  assert.equal(outcome(pre(dir, GEN, { session_id: 'other' })), 'deny');
  answer(dir); // an answer while the override lifted the brief denial is not a brief
  assert.equal(outcome(pre(dir, GEN, {})), 'allow', 'override still active');
});
