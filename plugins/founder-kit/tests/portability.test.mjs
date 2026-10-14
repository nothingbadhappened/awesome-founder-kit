// fk portability check / init on fixture repos: a web app with a database but no compose file, a Unity-like game with
// large binaries outside Git LFS, a podcast without code, and a fully portable project. Temp folders only, no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { check } from '../bin/cmd/portability.mjs';

const KIT = path.join(import.meta.dirname, '..');
const FK = path.join(KIT, 'bin', 'fk.mjs');
const MB = 1024 * 1024;
const binary = (mb) => { const b = Buffer.alloc(Math.round(mb * MB)); b.write('PNG'); return b; };

function repo(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fk-port-'));
  for (const [f, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
    fs.writeFileSync(path.join(dir, f), body);
  }
  spawnSync('git', ['init', '-q'], { cwd: dir });
  spawnSync('git', ['add', '-A'], { cwd: dir });
  return dir;
}
const status = (res) => Object.fromEntries(res.items.map((i) => [i.id, i.status]));
const note = (res, id) => res.items.find((i) => i.id === id).note;
const fk = (dir, args) => spawnSync(process.execPath, [FK, ...args], { cwd: dir, encoding: 'utf8' });

const JUSTFILE = 'setup:\n    mise install\n    npm ci\n\ndev: up\n    npm run dev\n\nup:\n    podman compose up -d\n\ncheck:\n    npm test\n';
const PORTABLE = {
  '.mise.toml': '[tools]\nnode = "22.11.0"\njust = "1.58.0"\n',
  '.gitattributes': '* text=auto eol=lf\n*.png filter=lfs diff=lfs merge=lfs -text\n',
  justfile: JUSTFILE,
  'package.json': JSON.stringify({ name: 'app', dependencies: { pg: '8.13.0', express: '4.21.1' } }),
  'package-lock.json': '{"lockfileVersion":3}',
  'src/db.js': 'export const url = process.env.DATABASE_URL;\n',
  '.env.example': 'DATABASE_URL=\n',
  'compose.yaml': 'services:\n  db:\n    image: docker.io/library/postgres:17\n',
  '.github/workflows/fresh-clone.yml': 'jobs:\n  fresh:\n    steps:\n      - run: mise exec -- just setup\n      - run: mise exec -- just check\n',
  'tsconfig.json': '{ "compilerOptions": { "outDir": "<you>/dist", "baseUrl": "./src" } }\n',
};

test('fully portable project: every item passes; --strict exits 0', () => {
  const dir = repo({ ...PORTABLE, 'public/hero.png': binary(1.5) });
  try {
    const res = check(dir);
    assert.equal(res.kind, 'software');
    assert.equal(res.warn, 0, JSON.stringify(res.items, null, 1));
    assert.match(note(res, 'lfs'), /all in Git LFS/);
    assert.match(note(res, 'services'), /compose\.yaml runs postgres/);
    const r = fk(dir, ['portability', 'check', '--strict']);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /0 warn/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('web app with a database but no compose file: services warn; warnings exit 0, --strict exits 1', () => {
  const { 'compose.yaml': _, ...rest } = PORTABLE;
  const dir = repo(rest);
  try {
    const res = check(dir);
    assert.equal(status(res).services, 'warn');
    assert.match(note(res, 'services'), /uses postgres but no compose\.yaml defines it/);
    assert.equal(res.warn, 1);
    assert.equal(fk(dir, ['portability', 'check']).status, 0);
    assert.equal(fk(dir, ['portability', 'check', '--strict']).status, 1);
    const json = JSON.parse(fk(dir, ['portability', 'check', '--json']).stdout);
    assert.equal(json.items.find((i) => i.id === 'services').status, 'warn');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('Unity-like game: large binaries outside Git LFS warn; the engine pin counts; no lockfile warns', () => {
  const dir = repo({
    'ProjectSettings/ProjectVersion.txt': 'm_EditorVersion: 2022.3.40f1\n',
    'Packages/manifest.json': '{ "dependencies": { "com.unity.inputsystem": "1.7.0" } }',
    'Assets/Art/hero.png': binary(1.2), 'Assets/Audio/theme.wav': binary(2),
    'Assets/Scripts/Player.cs': 'public class Player {}\n',
    '.gitattributes': '* text=auto\n',
  });
  try {
    const res = check(dir);
    assert.equal(res.kind, 'game');
    const s = status(res);
    assert.equal(s.lfs, 'warn');
    assert.match(note(res, 'lfs'), /2 large binary file\(s\) not in Git LFS .*git lfs track "\*\.(png|wav)" "\*\.(png|wav)"/);
    assert.equal(s.engine, 'pass');
    assert.match(note(res, 'engine'), /Unity 2022\.3\.40f1/);
    assert.equal(s.locks, 'warn', 'Packages/packages-lock.json missing');
    assert.equal(s.env, 'skip');
    assert.equal(s.services, 'skip');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('podcast without code: code items skipped; machine paths and large files still checked', () => {
  const drive = 'D' + ':' + '\\episodes\\raw';
  const dir = repo({
    'episodes/001-pilot.md': '# Pilot\nGuest: someone\n',
    'audio/001-pilot.wav': binary(2),
    '.gitattributes': '* text=auto eol=lf\n*.wav filter=lfs diff=lfs merge=lfs -text\n',
    'publish.yaml': `output: ${drive}\n`,
  });
  try {
    const res = check(dir);
    assert.equal(res.kind, 'none');
    const s = status(res);
    for (const id of ['tools', 'locks', 'commands', 'env', 'services', 'ci']) assert.equal(s[id], 'skip', id);
    assert.equal(s.lfs, 'pass');
    assert.equal(s.paths, 'warn');
    assert.match(note(res, 'paths'), /publish\.yaml:1/);
    assert.doesNotMatch(JSON.stringify(res), /episodes\\\\raw/, 'paths are reported by file and line, not echoed');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('committed .env, unpinned mise versions and home-folder paths warn', () => {
  const home = '/' + 'home/' + 'someone/' + 'app';
  const dir = repo({ ...PORTABLE, '.env': 'DATABASE_URL=x\n', '.mise.toml': '[tools]\nnode = "latest"\n', 'config/app.json': JSON.stringify({ data: home }) });
  try {
    const s = status(check(dir));
    assert.equal(s.env, 'warn');
    assert.equal(s.tools, 'warn');
    assert.equal(s.paths, 'warn');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('fk portability init writes the justfile and fresh-clone CI, never over existing files', () => {
  const dir = repo({ 'README.md': '# x\n' });
  try {
    let r = fk(dir, ['portability', 'init', '--dry-run']);
    assert.match(r.stdout, /would create justfile/);
    assert.equal(fs.existsSync(path.join(dir, 'justfile')), false);
    r = fk(dir, ['portability', 'init']);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const jf = fs.readFileSync(path.join(dir, 'justfile'), 'utf8');
    for (const recipe of ['setup:', 'dev: up', 'check:', 'down:']) assert.ok(jf.includes(`\n${recipe}`), recipe);
    assert.match(jf, /mise install/);
    assert.match(jf, /node scripts\/fk-boundaries\.mjs/);
    const ci = fs.readFileSync(path.join(dir, '.github', 'workflows', 'fresh-clone.yml'), 'utf8');
    assert.match(ci, /actions\/checkout@[0-9a-f]{40} # v/);
    assert.match(ci, /jdx\/mise-action@[0-9a-f]{40} # v/);
    assert.match(ci, /just setup[\s\S]*just check/);
    fs.writeFileSync(path.join(dir, 'justfile'), 'mine:\n    echo mine\n');
    r = fk(dir, ['portability', 'init']);
    assert.match(r.stdout, /kept\s+justfile/);
    assert.match(r.stdout, /kept\s+\.github\/workflows\/fresh-clone\.yml/);
    assert.equal(fs.readFileSync(path.join(dir, 'justfile'), 'utf8'), 'mine:\n    echo mine\n');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('fk adopt survey carries the portability gaps into the health report', async () => {
  const { survey, surveyMd } = await import('../bin/cmd/adopt/survey.mjs');
  const { 'compose.yaml': _, ...rest } = PORTABLE;
  const dir = repo(rest);
  try {
    const s = survey(dir, { skip: 'gitleaks,docker,sessions' });
    assert.equal(s.portability.warn, 1);
    assert.match(surveyMd(s), /## Portability[\s\S]*Services in containers: uses postgres/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// ---- v0.7 review ----
const JUST_PIN = JSON.parse(fs.readFileSync(path.join(KIT, 'compat.lock.json'), 'utf8')).tools.just.version;

test('kind-specific pin hints: a game or firmware project is pointed at its engine/toolchain, never at node', () => {
  const game = repo({ 'ProjectSettings/ProjectVersion.txt': 'm_EditorVersion: 2022.3.40f1\n', 'Assets/Scripts/Player.cs': 'public class Player {}\n' });
  const fw = repo({ 'platformio.ini': '[env:esp32]\nplatform = espressif32\n', 'src/main.cpp': 'void setup() {}\n' });
  try {
    const g = note(check(game), 'tools'), f = note(check(fw), 'tools');
    for (const t of [g, f]) assert.doesNotMatch(t, /node@/);
    assert.match(g, /ProjectVersion\.txt/);
    assert.match(f, /platformio\.ini \(platform = <name>@<x\.y\.z>\)/);
    assert.match(f, /ESP-IDF/);
  } finally { for (const d of [game, fw]) fs.rmSync(d, { recursive: true, force: true }); }
});

test('no code and no binaries: line endings are skipped; with binaries they are still checked', () => {
  const book = repo({ 'chapters/01.md': '# One\n', 'outline.md': '- a\n' });
  try {
    const res = check(book);
    assert.equal(res.kind, 'none');
    assert.equal(status(res).attributes, 'skip');
    assert.equal(res.warn, 0, JSON.stringify(res.items));
  } finally { fs.rmSync(book, { recursive: true, force: true }); }
  const pod = repo({ 'episodes/001.md': '# Pilot\n', 'audio/001.wav': binary(0.1) });
  try { assert.equal(status(check(pod)).attributes, 'warn'); } finally { fs.rmSync(pod, { recursive: true, force: true }); }
});

test('a justfile without just pinned in .mise.toml warns; init offers the line and never rewrites an existing mise file', () => {
  const dir = repo({ ...PORTABLE, '.mise.toml': '[tools]\nnode = "22.11.0"\n' });
  try {
    const res = check(dir);
    assert.equal(status(res).tools, 'warn');
    assert.match(note(res, 'tools'), new RegExp(`does not pin just, but the project has a justfile: add just = "${JUST_PIN.replace(/\./g, '\\.')}"`));
    const r = fk(dir, ['portability', 'init']);
    assert.match(r.stdout, new RegExp(`kept {4}\\.mise\\.toml \\(never rewritten\\); to pin just, add under \\[tools\\]: just = "${JUST_PIN.replace(/\./g, '\\.')}"`));
    assert.equal(fs.readFileSync(path.join(dir, '.mise.toml'), 'utf8'), '[tools]\nnode = "22.11.0"\n');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('init: fresh-clone CI runs just at the lock pin through mise; a .mise.toml pinning just is written only when absent', () => {
  const tpl = fs.readFileSync(path.join(KIT, 'templates', 'project', 'ci', 'fresh-clone.yml'), 'utf8');
  assert.deepEqual([...new Set(tpl.match(/just@[\d.]+/g))], [`just@${JUST_PIN}`], 'template pin matches compat.lock.json');
  const dir = repo({ 'README.md': '# x\n' });
  try {
    assert.match(fk(dir, ['portability', 'init', '--dry-run']).stdout, /would create \.mise\.toml/);
    assert.equal(fs.existsSync(path.join(dir, '.mise.toml')), false);
    fk(dir, ['portability', 'init']);
    const ci = fs.readFileSync(path.join(dir, '.github', 'workflows', 'fresh-clone.yml'), 'utf8');
    assert.match(ci, new RegExp(`run: mise exec just@${JUST_PIN.replace(/\./g, '\\.')} -- just setup\\n[\\s\\S]*run: mise exec just@${JUST_PIN.replace(/\./g, '\\.')} -- just check`));
    assert.equal(fs.readFileSync(path.join(dir, '.mise.toml'), 'utf8'), `[tools]\njust = "${JUST_PIN}"\n`);
    fs.writeFileSync(path.join(dir, '.mise.toml'), '[tools]\njust = "1.40.0"\n');
    fk(dir, ['portability', 'init']);
    assert.equal(fs.readFileSync(path.join(dir, '.mise.toml'), 'utf8'), '[tools]\njust = "1.40.0"\n', 'never overwritten');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('justfile template: fallback messages are quoted for PowerShell and sh; up/down without compose print one line', () => {
  const jf = fs.readFileSync(path.join(KIT, 'templates', 'project', 'justfile'), 'utf8');
  assert.match(jf, /"echo 'no boundary checker yet \(fk gates build\)'"/, 'parentheses would run a subexpression in PowerShell');
  assert.match(jf, /^ {4}@\{\{ if path_exists\("compose\.yaml"\) == "true" \{ compose \+ " up -d" \} else \{ "echo 'no compose\.yaml: no services to start'" \} \}\}$/m);
  assert.match(jf, /^ {4}@\{\{ .* "echo 'no compose\.yaml: nothing to stop'" \} \}\}$/m);
  for (const l of jf.split('\n').filter((x) => /^\s+echo /.test(x))) assert.match(l, /^\s+echo '[^']*'$/, l);
  assert.match(jf, /^set windows-shell := /m, 'kept: just 1.15 (the floor) has no [windows] attribute on set shell');
});
