// Context-budget CI (design §16.4): hard caps on what every plugin under plugins/ puts into context.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..', '..');
const PLUGINS = path.join(REPO, 'plugins');

const MAX_DESCRIPTION = 200;
const MAX_BODY_LINES = 150;
const MAX_TEMPLATE_WORDS = 450;
const MAX_KIT_DESCRIPTIONS = 2000; // characters, ≈ the kit's always-on share of skill descriptions
const RESERVED = ['plan', 'execute', 'review', 'verify', 'research', 'tdd', 'debug', 'release', 'team', 'ralph',
  'autopilot', 'security-review', 'code-review', 'simplify', 'init'];
// Generic shapes of personal data (no literal names): a mail address, a user home, a non-system absolute drive path.
const PRIVATE = [/@gmail\.com/i, /[A-Z]:\\Users\\(?!<|you\b|name\b|runneradmin\b)[A-Za-z0-9]/,
  /\/(?:home|Users)\/(?!<|you\b|name\b|runner\b|cwd\b)[a-z0-9]/, /\b[A-Z]:[\\/](?!<|Users[\\/](?:<|you\b|name\b|runneradmin\b)|Windows\b|Program Files\b|x\b)[A-Za-z]/];

const plugins = fs.readdirSync(PLUGINS, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
const skills = plugins.flatMap((plugin) => {
  const dir = path.join(PLUGINS, plugin, 'skills');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && fs.existsSync(path.join(dir, d.name, 'SKILL.md')))
    .map((d) => ({ plugin, dir: path.join(dir, d.name), id: `${plugin}/${d.name}` }));
});

function parseSkill(file) {
  const lines = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n').split('\n');
  if (lines.at(-1) === '') lines.pop();
  if (lines[0] !== '---') return { frontmatter: null, body: lines };
  const end = lines.indexOf('---', 1);
  if (end === -1) return { frontmatter: null, body: lines };
  const frontmatter = {};
  const errors = [];
  for (const line of lines.slice(1, end)) {
    const m = /^([A-Za-z0-9_-]+):(?:\s+(.*))?$/.exec(line);
    if (!m) { errors.push(`not a "key: value" line: ${line}`); continue; }
    try { frontmatter[m[1]] = scalar(m[2] || ''); } catch (e) { errors.push(`${m[1]}: ${e.message}`); }
  }
  return { frontmatter, errors, body: lines.slice(end + 1) };
}

// Strict YAML subset for one-line frontmatter values: a plain scalar, a "double-quoted" or a 'single-quoted' string.
// A plain scalar with ": " or " #" in it, or starting with an indicator, is not what it looks like in real YAML.
function scalar(v) {
  if (v.startsWith('"')) {
    if (!/^"(?:[^"\\]|\\.)*"$/.test(v)) throw new Error('unbalanced or unescaped double quote');
    return JSON.parse(v);
  }
  if (v.startsWith("'")) {
    if (!/^'(?:[^']|'')*'$/.test(v)) throw new Error('unbalanced single quote');
    return v.slice(1, -1).replace(/''/g, "'");
  }
  if (/: | #|:$/.test(v)) throw new Error('plain value contains ": " or " #": wrap it in double quotes');
  if (/^[[\]{}&*!|>%@`,?-]/.test(v) && v !== '-') throw new Error('plain value starts with a YAML indicator: wrap it in double quotes');
  return v;
}

const parsed = new Map(skills.map((s) => [s.id, parseSkill(path.join(s.dir, 'SKILL.md'))]));

function contractNames() {
  const candidates = [path.join(REPO, 'policy', 'base-contract.json'),
    path.join(PLUGINS, 'founder-kit', 'policy', 'base-contract.json')];
  const file = candidates.find((f) => fs.existsSync(f));
  if (!file) return null;
  const c = JSON.parse(fs.readFileSync(file, 'utf8'));
  const list = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []);
  const s = c.skills || {};
  return {
    file,
    foreign: new Set([...list(s.omc), ...list(s.omc_retired), ...list(s.builtin), ...list(s.memory),
      ...Object.values(c.agents || {}).flatMap(list), ...Object.values(c.commands || {}).flatMap(list)]),
    kit: new Set(list(s.kit)),
  };
}

test('found skills to check', () => {
  assert.ok(skills.length > 0);
});

for (const s of skills) {
  test(`${s.id}: frontmatter, description and body within budget`, () => {
    const { frontmatter, errors, body } = parsed.get(s.id);
    assert.ok(frontmatter, 'SKILL.md must start with --- frontmatter ---');
    assert.deepEqual(errors, [], 'frontmatter is valid YAML');
    assert.ok(frontmatter.name, 'frontmatter needs name');
    assert.ok(frontmatter.description, 'frontmatter needs description');
    assert.ok(frontmatter.description.length <= MAX_DESCRIPTION,
      `description is ${frontmatter.description.length} chars (max ${MAX_DESCRIPTION})`);
    assert.ok(body.length <= MAX_BODY_LINES, `body is ${body.length} lines (max ${MAX_BODY_LINES})`);
  });

  if (fs.existsSync(path.join(s.dir, 'reference.md'))) {
    test(`${s.id}: reference.md is linked from SKILL.md`, () => {
      assert.match(parsed.get(s.id).body.join('\n'), /reference\.md/);
    });
  }
}

test('generated <project>-dev template stays within 450 words', () => {
  const file = path.join(PLUGINS, 'founder-kit', 'skills', 'fk-process', 'templates', 'SKILL.template.md');
  assert.ok(fs.existsSync(file), 'fk-process SKILL.template.md exists');
  const words = fs.readFileSync(file, 'utf8').split(/\s+/).filter(Boolean).length;
  assert.ok(words <= MAX_TEMPLATE_WORDS, `template is ${words} words (max ${MAX_TEMPLATE_WORDS})`);
});

test('founder-kit skill descriptions stay within the always-on budget', () => {
  const total = skills.filter((s) => s.plugin === 'founder-kit')
    .reduce((n, s) => n + (parsed.get(s.id).frontmatter?.description?.length ?? 0), 0);
  assert.ok(total <= MAX_KIT_DESCRIPTIONS, `founder-kit descriptions total ${total} chars (max ${MAX_KIT_DESCRIPTIONS})`);
});

test('skill names are unique and do not collide with OMC/built-in names', () => {
  const seen = new Map();
  for (const s of skills) {
    const name = parsed.get(s.id).frontmatter?.name;
    if (!name) continue;
    assert.ok(!seen.has(name), `duplicate skill name ${name}: ${seen.get(name)} and ${s.id}`);
    seen.set(name, s.id);
    assert.ok(!RESERVED.includes(name), `${s.id} uses reserved name ${name}`);
  }
});

test('skill names do not collide with policy/base-contract.json', (t) => {
  const contract = contractNames();
  if (!contract) return t.skip('base-contract.json not present');
  for (const s of skills) {
    const name = parsed.get(s.id).frontmatter?.name;
    if (!name) continue;
    assert.ok(!contract.foreign.has(name), `${s.id} collides with base-contract name ${name}`);
    if (s.plugin !== 'founder-kit') assert.ok(!contract.kit.has(name), `${s.id} takes founder-kit's name ${name}`);
  }
});

test('strict frontmatter check catches the planted cases', () => {
  for (const bad of ['Use when x: do y.', '"open', '"a "b" c"', "'open", '[x]', 'a #b']) assert.throws(() => scalar(bad), bad);
  assert.equal(scalar('"Use when x: do \\"y\\"."'), 'Use when x: do "y".');
  assert.equal(scalar("'it''s: fine'"), "it's: fine");
  assert.equal(scalar('plain - with (parens) and "inner" quotes'), 'plain - with (parens) and "inner" quotes');
});

// The official validator, when the claude CLI is installed (CI installs the pinned version).
const claudeCli = spawnSync('claude', ['--version'], { encoding: 'utf8', shell: process.platform === 'win32' }).status === 0;
for (const dir of ['.', ...plugins.map((p) => path.join('plugins', p))]) {
  test(`claude plugin validate --strict ${dir}`, { skip: !claudeCli && 'claude CLI not found' }, () => {
    const r = spawnSync('claude', ['plugin', 'validate', '--strict', dir], { cwd: REPO, encoding: 'utf8', shell: process.platform === 'win32', timeout: 60000 });
    assert.equal(r.status, 0, r.stdout + r.stderr);
  });
}

test('no personal data in tracked files', () => {
  const self = path.relative(REPO, fileURLToPath(import.meta.url)).split(path.sep).join('/');
  const files = spawnSync('git', ['ls-files'], { cwd: REPO, encoding: 'utf8' }).stdout.split('\n')
    .filter((f) => f && f !== self && !/^(?:docs|\.omc|scripts)\//.test(f));
  const hits = [];
  for (const f of files) {
    let buf;
    try { buf = fs.readFileSync(path.join(REPO, f)); } catch { continue; }
    if (buf.includes(0)) continue; // binary
    const text = buf.toString('utf8').replace(/\\\\/g, '\\'); // source-escaped backslashes count as one
    for (const re of PRIVATE) if (re.test(text)) hits.push(`${f}: ${re}`);
  }
  assert.deepEqual(hits, []);
});

test('personal-data patterns: planted samples hit, placeholders do not', () => {
  const hit = (s) => PRIVATE.some((re) => re.test(s));
  for (const s of ['a.b@gmail.com', 'C:\\Users\\alice\\x', '/home/alice/x', '/Users/bob/x', 'E:/work/app']) assert.ok(hit(s), s);
  for (const s of ['C:\\Users\\<you>\\x', '/home/runner/work', '<run>/home/cwd', '/Users/<name>/x', 'C:\\Windows\\System32', 'C:\\Program Files\\Git', 'https://x.io/a']) assert.ok(!hit(s), s);
});
