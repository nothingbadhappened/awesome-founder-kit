// fk portability check on fixture repos: a web app with a database but no way to get it, a Unity-like game with large
// binaries outside Git LFS, a podcast without code, portable projects on several stacks (no tool is assumed). Temp
// folders only, no network.
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

const PORTABLE = {
  '.nvmrc': '22.11.0\n',
  '.gitattributes': '* text=auto eol=lf\n*.png filter=lfs diff=lfs merge=lfs -text\n',
  'package.json': JSON.stringify({ name: 'app', scripts: { dev: 'node src/db.js', test: 'node --test' }, dependencies: { pg: '8.13.0', express: '4.21.1' } }),
  'package-lock.json': '{"lockfileVersion":3}',
  'src/db.js': 'export const url = process.env.DATABASE_URL;\n',
  '.env.example': 'DATABASE_URL=\n',
  'compose.yaml': 'services:\n  db:\n    image: docker.io/library/postgres:17\n',
  '.github/workflows/ci.yml': 'jobs:\n  test:\n    steps:\n      - run: npm ci\n      - run: npm test\n',
  'tsconfig.json': '{ "compilerOptions": { "outDir": "<you>/dist", "baseUrl": "./src" } }\n',
};

test('fully portable project: every item passes; --strict exits 0', () => {
  const dir = repo({ ...PORTABLE, 'public/hero.png': binary(1.5) });
  try {
    const res = check(dir);
    assert.equal(res.kind, 'software');
    assert.equal(res.warn, 0, JSON.stringify(res.items, null, 1));
    assert.match(note(res, 'lfs'), /all in Git LFS/);
    assert.match(note(res, 'services'), /postgres: compose\.yaml/);
    const r = fk(dir, ['portability', 'check', '--strict']);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /0 warn/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('web app with a database and no way to get it: services warn without naming one tool as the fix; --strict exits 1', () => {
  const { 'compose.yaml': _, ...rest } = PORTABLE;
  const dir = repo(rest);
  try {
    const res = check(dir);
    assert.equal(status(res).services, 'warn');
    assert.match(note(res, 'services'), /uses postgres but nothing says how a fresh clone gets it: .*\(e\.g\. compose\.yaml, a devcontainer\)/);
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

test('committed .env, unpinned versions (mise or a version file) and home-folder paths warn', () => {
  const home = '/' + 'home/' + 'someone/' + 'app';
  const dir = repo({ ...PORTABLE, '.env': 'DATABASE_URL=x\n', '.mise.toml': '[tools]\nnode = "latest"\n', 'config/app.json': JSON.stringify({ data: home }) });
  try {
    const s = status(check(dir));
    assert.equal(s.env, 'warn');
    assert.equal(s.tools, 'warn');
    assert.equal(s.paths, 'warn');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  const lts = repo({ ...PORTABLE, '.nvmrc': 'lts/*\n' });
  try { assert.match(note(check(lts), 'tools'), /unpinned versions \(\.nvmrc: lts\/\*\)/); } finally { fs.rmSync(lts, { recursive: true, force: true }); }
  // A range in "engines" states support; it pins nothing. An exact version does.
  for (const [node, want] of [['>=20', 'warn'], ['^20.11.0', 'warn'], ['~20.11.0', 'warn'], ['20.11.1', 'pass']]) {
    const d = repo({ ...PORTABLE, 'package.json': JSON.stringify({ name: 'app', scripts: { test: 'node --test' }, engines: { node } }) });
    try { assert.equal(status(check(d)).tools, want, node); } finally { fs.rmSync(d, { recursive: true, force: true }); }
  }
});

test('fk adopt survey carries the portability gaps into the health report', async () => {
  const { survey, surveyMd } = await import('../bin/cmd/adopt/survey.mjs');
  const { 'compose.yaml': _, ...rest } = PORTABLE;
  const dir = repo(rest);
  try {
    const s = survey(dir, { skip: 'gitleaks,docker,sessions' });
    assert.equal(s.portability.warn, 1);
    assert.match(surveyMd(s), /## Portability[\s\S]*Services: uses postgres/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// ---- v0.7 review ----
test('game and firmware: the engine/toolchain item carries the pin; no node, mise or just hint', () => {
  const game = repo({ 'ProjectSettings/ProjectVersion.txt': 'm_EditorVersion: 2022.3.40f1\n', 'Assets/Scripts/Player.cs': 'public class Player {}\n' });
  const fw = repo({ 'platformio.ini': '[env:esp32]\nplatform = espressif32\n', 'src/main.cpp': 'void setup() {}\n' });
  try {
    const g = check(game), f = check(fw);
    assert.equal(status(g).tools, 'skip');
    assert.equal(status(f).tools, 'skip');
    assert.match(note(f, 'engine'), /platformio\.ini \(e\.g\. platform = espressif32@<x\.y\.z>\)/);
    for (const r of [g, f]) assert.doesNotMatch(JSON.stringify(r), /node@|mise|just /);
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

// ---- v1: agnostic or absent (no stack is preferred) ----
const CI = { '.gitattributes': '* text=auto eol=lf\n', '.gitlab-ci.yml': 'test:\n  script: [make check]\n' };
const noTool = (res) => assert.doesNotMatch(JSON.stringify(res), /mise|justfile|just setup|podman|fk portability init/i);

test('Python with a Makefile, .python-version and uv.lock: no runner or pin warning', () => {
  const dir = repo({ ...CI, Makefile: 'check:\n\tuv run pytest\n', '.python-version': '3.12.7\n', 'uv.lock': 'version = 1\n',
    'pyproject.toml': '[project]\nname = "app"\ndependencies = ["httpx==0.27.2"]\n', 'app/main.py': 'print(1)\n' });
  try {
    const res = check(dir), s = status(res);
    assert.equal(s.commands, 'pass', note(res, 'commands'));
    assert.match(note(res, 'commands'), /Makefile/);
    assert.equal(s.tools, 'pass', note(res, 'tools'));
    assert.match(note(res, 'tools'), /\.python-version/);
    assert.equal(s.locks, 'pass');
    noTool(res);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('Cargo project with rust-toolchain.toml: clean', () => {
  const dir = repo({ ...CI, 'Cargo.toml': '[package]\nname = "app"\nversion = "0.1.0"\n', 'Cargo.lock': 'version = 3\n',
    'rust-toolchain.toml': '[toolchain]\nchannel = "1.82.0"\n', 'src/main.rs': 'fn main() {}\n' });
  try { const res = check(dir); assert.equal(res.warn, 0, JSON.stringify(res.items, null, 1)); noTool(res); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('Node project with package.json scripts, .nvmrc and a lockfile: clean', () => {
  const dir = repo({ ...CI, '.nvmrc': '22.11.0\n', 'package-lock.json': '{"lockfileVersion":3}',
    'package.json': JSON.stringify({ name: 'app', scripts: { test: 'node --test' }, dependencies: { express: '4.21.1' } }), 'src/index.js': 'export {};\n' });
  try { const res = check(dir); assert.equal(res.warn, 0, JSON.stringify(res.items, null, 1)); noTool(res); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('Node project with no runtime pin: exactly one warning, with ecosystem examples and no tool named as the fix', () => {
  const dir = repo({ ...CI, 'package-lock.json': '{"lockfileVersion":3}',
    'package.json': JSON.stringify({ name: 'app', scripts: { test: 'node --test' }, dependencies: { express: '4.21.1' } }), 'src/index.js': 'export {};\n' });
  try {
    const res = check(dir);
    assert.equal(res.warn, 1, JSON.stringify(res.items, null, 1));
    assert.equal(status(res).tools, 'warn');
    assert.match(note(res, 'tools'), /no runtime version pinned: pin it the way this ecosystem does \(e\.g\. \.nvmrc/);
    assert.doesNotMatch(note(res, 'tools'), /mise/i);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('no runner file but a check command recorded in .fk/config.json: the command interface passes', () => {
  const dir = repo({ ...CI, '.python-version': '3.12.7\n', 'requirements.txt': 'httpx==0.27.2\n', 'app.py': 'print(1)\n' });
  try {
    const before = check(dir);
    assert.equal(status(before).commands, 'warn');
    assert.doesNotMatch(note(before, 'commands'), /justfile|fk portability init/);
    fs.mkdirSync(path.join(dir, '.fk'));
    fs.writeFileSync(path.join(dir, '.fk', 'config.json'), JSON.stringify({ check: 'python -m pytest' }));
    assert.match(note(check(dir), 'commands'), /check command recorded: python -m pytest/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('services: Testcontainers, a devcontainer, the README or a hosted URL in .env.example each count; localhost does not', () => {
  const { 'compose.yaml': _, ...rest } = PORTABLE;
  const pkg = (dev) => JSON.stringify({ name: 'app', scripts: { test: 'node --test' }, dependencies: { pg: '8.13.0' }, devDependencies: dev });
  const cases = [
    [{ 'package.json': pkg({ '@testcontainers/postgresql': '10.13.2' }) }, /Testcontainers/],
    [{ '.devcontainer/devcontainer.json': '{ "image": "mcr.microsoft.com/devcontainers/base:1" }', '.devcontainer/docker-compose.yml': 'services:\n  db:\n    image: postgres:17\n' }, /postgres: \.devcontainer\//],
    [{ 'README.md': '# app\nNeeds PostgreSQL 17 running locally.\n' }, /postgres: mentioned in README\.md/],
    [{ '.env.example': 'DATABASE_URL=postgres://app@db.example.com:5432/app\n' }, /hosted URL/],
  ];
  for (const [extra, want] of cases) {
    const dir = repo({ ...rest, ...extra });
    try { const res = check(dir); assert.equal(status(res).services, 'pass', note(res, 'services')); assert.match(note(res, 'services'), want); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }
  const local = repo({ ...rest, '.env.example': 'DATABASE_URL=postgres://app@localhost:5432/app\n' });
  try { assert.equal(status(check(local)).services, 'warn'); } finally { fs.rmSync(local, { recursive: true, force: true }); }
});

test('fk portability init is gone: the kit writes no task runner, version manager or CI template', () => {
  const dir = repo({ 'README.md': '# x\n' });
  try {
    const r = fk(dir, ['portability', 'init']);
    assert.equal(r.status, 1);
    assert.match(r.stdout, /usage: fk portability check/);
    assert.deepEqual(fs.readdirSync(dir).filter((f) => f !== '.git'), ['README.md']);
    assert.equal(fs.existsSync(path.join(KIT, 'templates', 'project', 'justfile')), false);
    assert.equal(fs.existsSync(path.join(KIT, 'templates', 'project', 'ci')), false);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
