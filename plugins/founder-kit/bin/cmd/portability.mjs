// fk portability check [--json] [--strict] | fk portability init [--dry-run]
// check: can a fresh clone run on any machine with `just setup` and `just check`? Plain pass/warn/skip per item:
//   pinned tool versions (mise), committed lockfiles, a justfile (setup/dev/check), .env.example, services in compose,
//   no machine-specific paths, .gitattributes + Git LFS for large binaries, a fresh-clone CI job.
//   Domain-aware: a project without code checks only paths and large files; games and firmware also check the
//   engine/toolchain pin. Read-only. Exit 0 with warnings; 1 only with --strict and a warning.
// init: writes the kit's justfile and .github/workflows/fresh-clone.yml templates (just at the kit's pin) and, when there
//   is no mise config, a .mise.toml pinning just; never over an existing file.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const say = (s = '') => process.stdout.write(s + '\n');
const SKIP_DIRS = new Set(['node_modules', '.git', '.omc', '.fk', 'dist', 'build', 'out', 'coverage', 'target', 'vendor', '.venv', 'venv',
  '__pycache__', '.next', '.turbo', '.cache', '.godot', 'Library', 'Temp', 'Logs', 'obj', '.gradle', '.pio']);
const SOURCE = /\.(?:[cm]?[jt]sx?|py|go|rs|java|kt|kts|swift|cs|cpp|cc|cxx|c|h|hpp|rb|php|gd|ex|exs|dart|ino|lua|scala)$/i;
const MANIFEST = /^(?:package\.json|pyproject\.toml|requirements[\w-]*\.txt|setup\.py|Pipfile|go\.mod|Cargo\.toml|pom\.xml|build\.gradle(?:\.kts)?|Gemfile|composer\.json|.+\.csproj|.+\.sln|deno\.jsonc?|mix\.exs|pubspec\.yaml|Package\.swift|CMakeLists\.txt|platformio\.ini|project\.godot)$/i;
const MISE = ['.mise.toml', 'mise.toml', '.config/mise.toml', '.mise/config.toml', '.tool-versions'];
const JUSTFILES = ['justfile', 'Justfile', '.justfile', 'JUSTFILE'];
const COMPOSE = /(?:^|\/)(?:compose|docker-compose)(?:\.[\w-]+)?\.ya?ml$/i;
const ENV_EXAMPLE = /(?:^|\/)\.env\.(?:example|sample|template)$|(?:^|\/)example\.env$/i;
const ENV_READ = /process\.env\b|import\.meta\.env\b|os\.environ\b|os\.getenv\(|getenv\(|std::env::var|env::var\(|os\.Getenv\(|Environment\.GetEnvironmentVariable|ENV\[|ENV\.fetch|System\.getenv/;
const BINARY = /\.(?:png|jpe?g|gif|webp|psd|tga|tiff?|exr|hdr|bmp|ico|fbx|obj|blend|max|ma|mb|glb|uasset|umap|pak|unitypackage|wav|mp3|ogg|flac|aiff?|m4a|mp4|mov|avi|mkv|webm|zip|7z|rar|tar|gz|tgz|pdf|ttf|otf|dll|so|dylib|exe|bin|elf|hex|apk|aab|ipa)$/i;
const CONFIG = /\.(?:json|jsonc|ya?ml|toml|ini|cfg|conf|properties|xml|code-workspace|env\.example|env\.sample|env\.template)$|(?:^|\/)(?:justfile|Justfile|Makefile|Dockerfile|\.tool-versions|\.npmrc|\.yarnrc|\.gitattributes|\.gitmodules)$/;
const LOCKS = /(?:^|\/)(?:package-lock\.json|npm-shrinkwrap\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?|uv\.lock|poetry\.lock|pdm\.lock|Pipfile\.lock|Cargo\.lock|go\.sum|Gemfile\.lock|composer\.lock|packages-lock\.json|pubspec\.lock|mix\.lock|deno\.lock)$/;
const MB = 1024 * 1024;
const JUST = () => JSON.parse(fs.readFileSync(path.join(KIT, 'compat.lock.json'), 'utf8')).tools.just.version;
const pinsJust = (text) => /^\s*["']?just["']?\s*(?:=|\s)/m.test(text);

// Services a project usually needs a server for: dependency name -> service (images matched in the compose file).
const SERVICES = {
  postgres: { deps: /^(?:pg|postgres|pg-promise|@neondatabase\/serverless|psycopg2?(?:-binary)?|psycopg|asyncpg|github\.com\/lib\/pq|github\.com\/jackc\/pgx(?:\/v\d+)?|tokio-postgres|sqlx-postgres)$/i, env: /^(?:DATABASE_URL|POSTGRES_\w+|PG(?:HOST|DATABASE|USER))$/, image: /postgres|postgis|timescale/i },
  mysql: { deps: /^(?:mysql2?|pymysql|mysqlclient|github\.com\/go-sql-driver\/mysql)$/i, env: /^MYSQL_\w+$/, image: /mysql|mariadb/i },
  mongodb: { deps: /^(?:mongodb|mongoose|pymongo|motor|go\.mongodb\.org\/mongo-driver)$/i, env: /^MONGO(?:DB)?_(?:URL|URI)$/, image: /mongo/i },
  redis: { deps: /^(?:redis|ioredis|bullmq|bull|celery|rq|github\.com\/redis\/go-redis(?:\/v\d+)?|github\.com\/go-redis\/redis(?:\/v\d+)?)$/i, env: /^REDIS_\w+$/, image: /redis|valkey|keydb|dragonfly/i },
  rabbitmq: { deps: /^(?:amqplib|amqp-connection-manager|pika|aio-pika|lapin)$/i, env: /^(?:AMQP_URL|RABBITMQ_\w+)$/, image: /rabbitmq/i },
  kafka: { deps: /^(?:kafkajs|kafka-python|confluent-kafka|rdkafka|github\.com\/segmentio\/kafka-go)$/i, env: /^KAFKA_\w+$/, image: /kafka|redpanda/i },
};

const read = (root, f, max = 512 * 1024) => { try { const p = path.join(root, f); return fs.statSync(p).size <= max ? fs.readFileSync(p, 'utf8') : ''; } catch { return ''; } };
const git = (root, args) => spawnSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 256 * MB });

function walk(root, depth = 6) {
  const out = [];
  const go = (dir, d) => {
    let es; try { es = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of es) {
      if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name) && d < depth) go(path.join(dir, e.name), d + 1); }
      else out.push(path.relative(root, path.join(dir, e.name)).split(path.sep).join('/'));
    }
  };
  go(root, 0);
  return out;
}

// Files in the project (tracked + new, not ignored) and the committed ones; without git, the folder walk for both.
function files(root) {
  const all = git(root, ['ls-files', '-co', '--exclude-standard']);
  if (all.status !== 0) { const w = walk(root); return { git: false, all: w, tracked: new Set(w) }; }
  const list = all.stdout.split('\n').filter(Boolean).filter((f) => !f.split('/').some((p) => SKIP_DIRS.has(p)));
  return { git: true, all: [...new Set(list)], tracked: new Set(git(root, ['ls-files']).stdout.split('\n').filter(Boolean)) };
}

// software | game | embedded | none (no code at all: a podcast, a book, a research project).
export function projectKind(all) {
  const base = (f) => f.split('/').pop();
  if (all.some((f) => /(?:^|\/)ProjectSettings\/ProjectVersion\.txt$/.test(f) || base(f) === 'project.godot' || /\.uproject$/i.test(f))) return 'game';
  if (all.some((f) => ['platformio.ini', 'sdkconfig', 'idf_component.yml'].includes(base(f)) || /\.ino$/i.test(f))) return 'embedded';
  if (all.some((f) => MANIFEST.test(base(f)) || SOURCE.test(f))) return 'software';
  return 'none';
}

// What to pin first, by kind: games and firmware pin the engine/toolchain itself elsewhere (see the engine item).
const PIN_HINT = {
  software: 'add .mise.toml with exact versions (`mise use node@22.11.0` writes it), so every machine gets the same runtimes',
  game: 'add .mise.toml for the helper tools (`mise use just@<version>`); the engine version itself is pinned by the engine (Unity: ProjectSettings/ProjectVersion.txt; Godot: the exact editor build)',
  embedded: 'add .mise.toml for the toolchain (e.g. the ESP-IDF version) and the helper tools; PlatformIO pins its platform version in platformio.ini (platform = <name>@<x.y.z>)',
};
function toolVersions(root, all, kind) {
  const file = MISE.find((f) => all.includes(f));
  if (!file) return ['warn', `no pinned tool versions: ${PIN_HINT[kind] || PIN_HINT.software}`];
  const text = read(root, file);
  const pins = file.endsWith('.tool-versions') ? text.split(/\r?\n/).filter((l) => /^\s*[\w-]+\s+\S/.test(l))
    : (/\[tools\]([\s\S]*?)(?:\n\[|$)/.exec(text)?.[1] || '').split(/\r?\n/).filter((l) => /^\s*["\w:./@-]+\s*=/.test(l));
  const loose = pins.filter((l) => /\blatest\b|=\s*["']?(?:lts|stable)["']?\s*$/i.test(l));
  if (loose.length) return ['warn', `${file} has unpinned versions (${loose.map((l) => l.trim()).slice(0, 3).join('; ')}): use exact versions`];
  if (!pins.length) return ['warn', `${file} lists no tools yet`];
  if (JUSTFILES.some((f) => all.includes(f)) && !pinsJust(text)) return ['warn', `${file} does not pin just, but the project has a justfile: add just = "${JUST()}" (\`fk portability init\` offers it)`];
  return ['pass', `${file} pins ${pins.length} tool(s)`];
}

function engine(root, all, kind) {
  if (kind === 'game') {
    const unity = all.find((f) => /(?:^|\/)ProjectSettings\/ProjectVersion\.txt$/.test(f));
    if (unity) { const v = /m_EditorVersion:\s*(\S+)/.exec(read(root, unity))?.[1]; return v ? ['pass', `Unity ${v} pinned in ${unity}`] : ['warn', `${unity} has no m_EditorVersion`]; }
    const godot = all.find((f) => f.split('/').pop() === 'project.godot');
    if (godot) { const v = /config\/features=PackedStringArray\("(\d+\.\d+)/.exec(read(root, godot))?.[1]; return v ? ['pass', `Godot ${v} named in ${godot}; pin the exact editor build in .mise.toml or the README`] : ['warn', `${godot} names no engine version`]; }
    return ['warn', 'pin the exact engine version in the repo (and in CI)'];
  }
  const pio = all.find((f) => f.split('/').pop() === 'platformio.ini');
  if (pio) {
    const plats = [...read(root, pio).matchAll(/^\s*platform\s*=\s*(\S+)/gm)].map((m) => m[1]);
    const loose = plats.filter((p) => !/@\s*\d/.test(p));
    return !plats.length ? ['warn', `${pio} names no platform`] : loose.length ? ['warn', `pin the platform version in ${pio} (e.g. platform = ${loose[0]}@<x.y.z>)`] : ['pass', `${pio} pins ${plats.join(', ')}`];
  }
  return ['warn', 'pin the toolchain version (ESP-IDF, Arduino core, compiler) in .mise.toml or the CI image'];
}

function lockfiles(root, all, tracked) {
  const want = [];
  const has = (dir, names) => names.some((n) => tracked.has(dir ? `${dir}/${n}` : n) || tracked.has(n));
  for (const f of all) {
    const dir = path.posix.dirname(f) === '.' ? '' : path.posix.dirname(f), b = f.split('/').pop();
    const need = {
      'package.json': ['package-lock.json', 'npm-shrinkwrap.json', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lockb', 'bun.lock'],
      'pyproject.toml': ['uv.lock', 'poetry.lock', 'pdm.lock', 'requirements.txt'],
      Pipfile: ['Pipfile.lock'], 'Cargo.toml': ['Cargo.lock'], Gemfile: ['Gemfile.lock'], 'composer.json': ['composer.lock'],
      'pubspec.yaml': ['pubspec.lock'], 'mix.exs': ['mix.lock'], 'deno.json': ['deno.lock'],
      'manifest.json': /(?:^|\/)Packages$/.test(dir) ? ['packages-lock.json'] : null,
      'go.mod': /^\s*require\b/m.test(read(root, f)) ? ['go.sum'] : null,
    }[b];
    if (!need) continue;
    if (b === 'package.json' && !/"(?:dev)?[dD]ependencies"\s*:\s*\{\s*"/.test(read(root, f))) continue; // nothing to lock
    if (!has(dir, need)) want.push(`${f} (expected ${need[0]}${need.length > 1 ? ' or similar' : ''})`);
  }
  const ecos = all.filter((f) => /(?:^|\/)(?:package\.json|pyproject\.toml|Pipfile|Cargo\.toml|Gemfile|composer\.json|pubspec\.yaml|mix\.exs|deno\.json|go\.mod|Packages\/manifest\.json)$/.test(f));
  if (!ecos.length) return ['skip', 'no package manifests'];
  return want.length ? ['warn', `no committed lockfile for ${want.slice(0, 4).join(', ')}: commit it so every machine installs the same versions`] : ['pass', `lockfiles committed for ${ecos.length} manifest(s)`];
}

function commands(root, all, kind) {
  const file = JUSTFILES.find((f) => all.includes(f));
  if (!file) return ['warn', 'no justfile: `fk portability init` adds one with setup, dev, check and down'];
  const recipes = new Set([...read(root, file).matchAll(/^@?([A-Za-z_][\w-]*)(?:[^\n:=]*)?:(?!=)/gm)].map((m) => m[1]));
  const missing = ['setup', ...(kind === 'software' ? ['dev'] : []), 'check'].filter((r) => !recipes.has(r));
  return missing.length ? ['warn', `${file} has no ${missing.join(', ')} recipe(s)`] : ['pass', `${file}: ${['setup', 'dev', 'check'].filter((r) => recipes.has(r)).join(', ')}`];
}

function envNames(root, all) {
  const names = new Set();
  for (const f of all.filter((x) => ENV_EXAMPLE.test(x))) for (const m of read(root, f).matchAll(/^\s*(?:export\s+)?([A-Za-z_]\w*)\s*=/gm)) names.add(m[1]);
  return names;
}

function env(root, all, tracked) {
  const committed = [...tracked].filter((f) => /(?:^|\/)\.env(?:\.[\w-]+)?$/.test(f) && !ENV_EXAMPLE.test(f));
  if (committed.length) return ['warn', `${committed.slice(0, 3).join(', ')} is committed: remove it from git (git rm --cached <file>), keep it in .gitignore and rotate the keys it held`];
  const example = all.find((f) => ENV_EXAMPLE.test(f));
  const reads = all.filter((f) => SOURCE.test(f)).slice(0, 3000).some((f) => ENV_READ.test(read(root, f, 256 * 1024)));
  if (!reads) return ['pass', example ? `${example} present` : 'the code reads no environment variables'];
  return example ? ['pass', `the code reads environment variables; ${example} lists them`] : ['warn', 'the code reads environment variables but there is no .env.example: list every name there (values stay in .env, never committed)'];
}

function deps(root, all) {
  const out = new Set();
  for (const f of all.filter((x) => /(?:^|\/)package\.json$/.test(x))) {
    try { const j = JSON.parse(read(root, f)); for (const k of Object.keys({ ...j.dependencies, ...j.devDependencies })) out.add(k); } catch { /* unreadable */ }
  }
  for (const f of all.filter((x) => /(?:^|\/)(?:requirements[\w-]*\.txt|pyproject\.toml|Pipfile|Gemfile|Cargo\.toml|go\.mod)$/.test(x))) {
    for (const m of read(root, f).matchAll(/^\s*(?:require\s+)?["']?([A-Za-z0-9_.\/-]+?)["']?(?:\[[^\]]*\])?\s*(?:[=<>~!^ ]|$)/gm)) out.add(m[1]);
    for (const m of read(root, f).matchAll(/["']([A-Za-z0-9_.-]+)(?:\[[^\]]*\])?\s*(?:[=<>~!]|["'])/g)) out.add(m[1]); // pyproject dependency arrays
  }
  const prisma = all.find((f) => /schema\.prisma$/.test(f));
  if (prisma) { const p = /provider\s*=\s*"(postgresql|mysql|mongodb)"/.exec(read(root, prisma))?.[1]; if (p) out.add({ postgresql: 'pg', mysql: 'mysql2', mongodb: 'mongodb' }[p]); }
  return out;
}

function services(root, all) {
  const d = deps(root, all), names = envNames(root, all);
  const need = Object.entries(SERVICES).filter(([, s]) => [...d].some((x) => s.deps.test(x)) || [...names].some((n) => s.env.test(n))).map(([k]) => k);
  if (!need.length) return ['pass', 'no database, cache or queue server detected'];
  const composeFiles = all.filter((f) => COMPOSE.test(f) && f.split('/').length <= 3);
  const text = composeFiles.map((f) => read(root, f)).join('\n');
  const images = [...text.matchAll(/^\s*image:\s*["']?([^\s"']+)/gm)].map((m) => m[1]).join(' ');
  const missing = need.filter((k) => !SERVICES[k].image.test(images) && !new RegExp(`^\\s{2}${k}\\s*:`, 'm').test(text));
  if (!composeFiles.length) return ['warn', `uses ${need.join(', ')} but no compose.yaml defines it: add it there so \`just dev\` starts it on any machine (Podman or Docker)`];
  return missing.length ? ['warn', `${composeFiles[0]} does not define ${missing.join(', ')}`] : ['pass', `${composeFiles[0]} runs ${need.join(', ')}`];
}

// Machine-specific absolute paths in committed config (drive paths, personal home folders); placeholders pass.
const DRIVE = /(?<![\w$%{/])[A-Za-z]:[\\/]+(?![<$%{])[\w. -]/;
const HOMEDIR = /\/(?:Users|home)\/(?![<$%{]|runner\b|user\b|you\b|name\b|USER\b)[^/\s"'<>]+\//;
function paths(root, tracked) {
  const hits = [];
  for (const f of [...tracked].filter((x) => CONFIG.test(x) && !LOCKS.test(x))) {
    const lines = read(root, f, 256 * 1024).split(/\r?\n/);
    lines.forEach((l, i) => { if (DRIVE.test(l) || HOMEDIR.test(l)) hits.push(`${f}:${i + 1}`); });
    if (hits.length >= 5) break;
  }
  return hits.length ? ['warn', `machine-specific paths in ${hits.slice(0, 5).join(', ')}: use paths relative to the project, or an environment variable`] : ['pass', 'no machine-specific paths in committed config'];
}

function attributes(root, all, kind) {
  if (kind === 'none' && !all.some((f) => BINARY.test(f))) return ['skip', 'no code and no binary files: line endings do not matter here'];
  const text = all.includes('.gitattributes') ? read(root, '.gitattributes') : '';
  if (!text) return ['warn', 'no .gitattributes: add `* text=auto eol=lf` so line endings are the same on every OS'];
  return /\beol=|\btext=auto\b|^\*\s+text\b/m.test(text) ? ['pass', '.gitattributes sets line endings'] : ['warn', '.gitattributes sets no line-ending rule: add `* text=auto eol=lf`'];
}

function isBinary(root, f) {
  if (BINARY.test(f)) return true;
  try { const fd = fs.openSync(path.join(root, f), 'r'); const b = Buffer.alloc(8000); const n = fs.readSync(fd, b, 0, 8000, 0); fs.closeSync(fd); return b.subarray(0, n).includes(0); } catch { return false; }
}
function lfs(root, all, kind, isGit) {
  const big = all.filter((f) => { try { return fs.statSync(path.join(root, f)).size > MB; } catch { return false; } }).filter((f) => isBinary(root, f));
  const patterns = /filter=lfs/.test(all.includes('.gitattributes') ? read(root, '.gitattributes') : '');
  let loose = big;
  if (big.length && isGit) {
    const r = spawnSync('git', ['check-attr', 'filter', '--stdin'], { cwd: root, input: big.join('\n') + '\n', encoding: 'utf8' });
    const inLfs = new Set(r.stdout.split('\n').filter((l) => /: filter: lfs$/.test(l)).map((l) => l.replace(/: filter: lfs$/, '')));
    loose = big.filter((f) => !inLfs.has(f));
  }
  const size = (f) => `${(fs.statSync(path.join(root, f)).size / MB).toFixed(1)} MB`;
  if (loose.length) {
    const exts = [...new Set(loose.map((f) => path.extname(f).toLowerCase()).filter(Boolean))].slice(0, 4);
    return ['warn', `${loose.length} large binary file(s) not in Git LFS (${loose.slice(0, 3).map((f) => `${f} ${size(f)}`).join(', ')}): ${exts.length ? `git lfs track ${exts.map((e) => `"*${e}"`).join(' ')}` : 'git lfs track <pattern>'}, then commit .gitattributes`];
  }
  if (kind === 'game' && !patterns) return ['warn', 'game projects grow large assets: set Git LFS patterns now (git lfs track "*.png" "*.fbx" "*.wav")'];
  return ['pass', big.length ? `${big.length} large binary file(s), all in Git LFS` : 'no large binary files'];
}

function ci(root, all) {
  const wf = all.filter((f) => /^\.github\/workflows\/[^/]+\.ya?ml$|^\.gitlab-ci\.yml$|^azure-pipelines\.yml$|^bitbucket-pipelines\.yml$/.test(f));
  const fresh = wf.find((f) => /just setup|mise install|mise-action/.test(read(root, f)));
  if (fresh) return ['pass', `${fresh} builds from a fresh clone`];
  return ['warn', `${wf.length ? 'CI exists but no job runs `just setup` on a fresh clone' : 'no CI'}: \`fk portability init\` adds .github/workflows/fresh-clone.yml`];
}

const LABELS = { tools: 'Tool versions', engine: 'Engine / toolchain', locks: 'Lockfiles', commands: 'One command interface', env: 'Settings (.env)',
  services: 'Services in containers', paths: 'No machine paths', attributes: 'Line endings', lfs: 'Large files', ci: 'Fresh-clone CI' };

export function check(root) {
  const { git: isGit, all, tracked } = files(root);
  const kind = projectKind(all);
  const code = kind !== 'none';
  const noCode = ['skip', 'no code in this project'];
  const items = {
    tools: code ? toolVersions(root, all, kind) : noCode,
    ...(kind === 'game' || kind === 'embedded' ? { engine: engine(root, all, kind) } : {}),
    locks: kind === 'software' || kind === 'game' ? lockfiles(root, all, tracked) : code ? ['skip', 'no package manager lockfile for this kind of project'] : noCode,
    commands: code ? commands(root, all, kind) : noCode,
    env: kind === 'software' ? env(root, all, tracked) : code ? ['skip', 'not a service with settings'] : noCode,
    services: kind === 'software' ? services(root, all) : code ? ['skip', 'no server-side services expected'] : noCode,
    paths: paths(root, tracked),
    attributes: attributes(root, all, kind),
    lfs: lfs(root, all, kind, isGit),
    ci: code ? ci(root, all) : noCode,
  };
  const list = Object.entries(items).map(([id, [status, note]]) => ({ id, label: LABELS[id], status, note }));
  const count = (s) => list.filter((i) => i.status === s).length;
  return { kind, items: list, pass: count('pass'), warn: count('warn'), skip: count('skip') };
}

const KIND = { software: 'software project', game: 'game project (large files and the engine version matter most)', embedded: 'firmware/hardware project (the toolchain version matters most)', none: 'project without code (code items skipped)' };

function init(root, dry) {
  const pairs = [[path.join(KIT, 'templates', 'project', 'justfile'), JUSTFILES.map((f) => path.join(root, f)), 'justfile'],
    [path.join(KIT, 'templates', 'project', 'ci', 'fresh-clone.yml'), [path.join(root, '.github', 'workflows', 'fresh-clone.yml')], '.github/workflows/fresh-clone.yml']];
  for (const [src, existing, rel] of pairs) {
    const have = existing.find((f) => fs.existsSync(f));
    if (have) { say(`kept    ${path.relative(root, have).split(path.sep).join('/')} (already there; never overwritten)`); continue; }
    if (dry) { say(`would create ${rel}`); continue; }
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), fs.readFileSync(src, 'utf8').replace(/just@\d+\.\d+\.\d+/g, `just@${JUST()}`)); // the kit's pin at init time
    say(`created ${rel}`);
  }
  // just in the mise config: a new .mise.toml only; an existing file is never rewritten (the line to add is printed).
  const mise = MISE.find((f) => fs.existsSync(path.join(root, f)));
  const line = `just = "${JUST()}"`;
  if (!mise) {
    if (dry) say(`would create .mise.toml (${line})`);
    else { fs.writeFileSync(path.join(root, '.mise.toml'), `[tools]\n${line}\n`); say(`created .mise.toml (${line})`); }
  } else if (!pinsJust(fs.readFileSync(path.join(root, mise), 'utf8'))) {
    say(`kept    ${mise} (never rewritten); to pin just, add ${mise === '.tool-versions' ? `the line: just ${JUST()}` : `under [tools]: ${line}`}`);
  }
  if (!dry) say('fk portability: replace the GATE-MISSING and example lines with the project\'s real commands, then run `fk portability check`.');
}

export default async function portability(args) {
  const [sub] = args;
  const r = git(process.cwd(), ['rev-parse', '--show-toplevel']);
  const root = r.status === 0 ? path.resolve(r.stdout.trim()) : process.cwd();
  if (sub === 'init') return init(root, args.includes('--dry-run'));
  if (sub !== 'check') { say('usage: fk portability check [--json] [--strict] | fk portability init [--dry-run]'); process.exitCode = 1; return; }
  const res = check(root);
  if (args.includes('--json')) say(JSON.stringify(res, null, 2));
  else {
    say(`fk portability: ${KIND[res.kind]}. Goal: a fresh clone runs on any machine with \`just setup\` and \`just check\`.`);
    const w = Math.max(...res.items.map((i) => i.label.length));
    for (const i of res.items) say(`  ${i.status.padEnd(4)}  ${i.label.padEnd(w)}  ${i.note}`);
    say(`fk portability: ${res.pass} pass, ${res.warn} warn, ${res.skip} skip.${res.warn ? ' Warnings never block work; fix them as small tasks.' : ''}`);
  }
  if (args.includes('--strict') && res.warn) process.exitCode = 1;
}
