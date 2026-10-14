// fk adopt survey (A1): read-only facts about an existing repo -> survey.json + survey.md in the adopt workspace (kit state dir, outside the repo).
// Never runs a command it was not given, never prints a secret value, never stores a local user path.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { git, tool, slug, measure, gitleaks, pairs, many } from './util.mjs';
import { check as portability } from '../portability.mjs';

const SKIP = new Set(['node_modules', '.git', '.omc', '.fk', 'dist', 'build', 'out', 'coverage', 'target', 'vendor', '.venv', 'venv', '__pycache__', '.next', '.turbo', '.cache', '.godot']);
const MANIFESTS = /^(package\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?|requirements[\w-]*\.txt|pyproject\.toml|Pipfile|setup\.py|go\.mod|Cargo\.toml|pom\.xml|build\.gradle(\.kts)?|Gemfile|composer\.json|.+\.csproj|.+\.sln|project\.godot|pubspec\.yaml|Package\.swift|mix\.exs|deno\.jsonc?)$/i;
// Unity: the package manifest only inside Packages/, the editor version only inside ProjectSettings/.
const UNITY = /(?:^|\/)(?:Packages\/manifest\.json|ProjectSettings\/ProjectVersion\.txt)$/;
const INFRA = /^(Dockerfile|docker-compose[\w.-]*\.ya?ml|compose\.ya?ml|.+\.tf|Pulumi\.ya?ml|serverless\.ya?ml|vercel\.json|netlify\.toml|fly\.toml|wrangler\.toml|firebase\.json|app\.yaml|render\.yaml|Procfile|.+\.bicep|cdk\.json|template\.ya?ml)$/i;
const CI = ['.github/workflows', '.gitlab-ci.yml', '.circleci', 'azure-pipelines.yml', 'bitbucket-pipelines.yml', 'Jenkinsfile'];
const ENV_FILES = /^\.env\.(example|sample|template|dist|defaults)$|^example\.env$/i;
const TEST_FILE = /(\.|_)(test|spec)\.[a-z]+$|^test_.+\.py$|_test\.go$/i;
const LOCKS = /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|Cargo\.lock|poetry\.lock|go\.sum|Gemfile\.lock|composer\.lock)$/;
const FIX = /\b(fix|fixes|fixed|fixing|hotfix|bugfix)\b/i;
const REVERT = /^Revert\b|\breverts?\b|\breverted\b/i;

function walk(root, depth = 3) {
  const files = [];
  const go = (dir, d) => {
    let es; try { es = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of es) {
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) { if (!SKIP.has(e.name) && d < depth) go(abs, d + 1); }
      else files.push(path.relative(root, abs).split(path.sep).join('/'));
    }
  };
  go(root, 0);
  return files;
}

// Existing north-star docs (a vision doc, game design doc, PRD, design folder, or Vision/Principles sections in
// README/AGENTS/CLAUDE): when found, docs/PROJECT.md becomes a thin index that links to them (bible_mode index).
const NORTH_NAME = /(?:^|[-_ .])(?:gdd|game[-_ ]?design(?:[-_ ]?doc(?:ument)?)?|design[-_ ]?doc(?:ument)?|vision|prd|product[-_ ]?requirements?|north[-_ ]?star|overview|charter|manifesto|principles|project[-_ ]?brief)(?:[-_ .]|$)/i;
// A design folder counts by its top-level page (README, index) or a top-level design file, not by generic subpages.
const NORTH_DIR = /(?:^|\/)docs?\/design\/(?:readme|index)\.\w+$|^(?:docs?\/)?design\.\w+$/i;
const NORTH_HEAD = /^#{1,3}\s+((?:product\s+)?vision|mission|principles|design pillars|pillars|goals|non-negotiables|overview)\b/gim;
const AGENT_HEAD = /^#{1,3}\s+((?:product\s+)?vision|mission)\b/gim; // AGENTS.md/CLAUDE.md are agent instructions unless they state the vision
const DOC_EXT = /\.(?:md|mdx|markdown|txt|rst|adoc|docx|pdf)$/i;
const KIT_DOCS = /^docs\/(?:PROJECT\.md|adr\/|process\/|tasks\/|standards\/|archive\/)/i;
export function northStar(root, files) {
  const out = [];
  for (const f of files.filter((x) => DOC_EXT.test(x) && !KIT_DOCS.test(x))) {
    const base = f.split('/').pop();
    let sections = [];
    if (/^(?:README|AGENTS|CLAUDE)\.md$/i.test(base) && !NORTH_DIR.test(f)) {
      try { sections = [...fs.readFileSync(path.join(root, f), 'utf8').matchAll(/^README/i.test(base) ? NORTH_HEAD : AGENT_HEAD)].map((m) => m[1]); } catch { /* unreadable */ }
      if (!sections.length) continue;
    } else if (!NORTH_NAME.test(base.replace(DOC_EXT, '')) && !NORTH_DIR.test(f)) continue;
    out.push({ file: f, sections: [...new Set(sections)] });
  }
  return out.slice(0, 10);
}

function stack(root) {
  const files = walk(root);
  const base = (f) => f.split('/').pop();
  const manifests = files.filter((f) => MANIFESTS.test(base(f)) || UNITY.test(f));
  const unity = files.find((f) => f.endsWith('ProjectSettings/ProjectVersion.txt') && UNITY.test(f));
  let engine = null;
  if (unity) { try { engine = `Unity ${/^m_EditorVersion:\s*(\S+)/m.exec(fs.readFileSync(path.join(root, unity), 'utf8'))?.[1] || '(version unknown)'}`; } catch { engine = 'Unity'; } }
  const infra = files.filter((f) => INFRA.test(base(f)));
  const ci = CI.filter((c) => fs.existsSync(path.join(root, c)));
  const envNames = new Set();
  for (const f of files.filter((f) => ENV_FILES.test(base(f)))) {
    for (const l of fs.readFileSync(path.join(root, f), 'utf8').split(/\r?\n/)) {
      const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(l); // the name only, never the value
      if (m) envNames.add(m[1]);
    }
  }
  const scripts = {};
  for (const f of manifests.filter((f) => base(f) === 'package.json')) {
    try { Object.assign(scripts, Object.fromEntries(Object.entries(JSON.parse(fs.readFileSync(path.join(root, f), 'utf8')).scripts || {}).map(([k]) => [`${f}:${k}`, true]))); } catch { /* unreadable */ }
  }
  return {
    manifests, engine, infra, ci, env_names: [...envNames].sort(), package_scripts: Object.keys(scripts),
    test_files: files.filter((f) => TEST_FILE.test(base(f)) || /(^|\/)(tests?|__tests__|spec)\//.test(f)).length,
    north_star: northStar(root, files),
    claude_setup: ['CLAUDE.md', 'AGENTS.md', '.claude/settings.json', '.claude/skills', '.mcp.json', '.omc'].filter((p) => fs.existsSync(path.join(root, p))),
  };
}

function history(root, { days = 90, minPair = 3 } = {}) {
  const log = git(root, ['log', '-n', '3000', '--name-only', '--no-renames', '--format=%x1e%H%x1f%ct%x1f%s']);
  if (log.status !== 0) return { commits: 0 };
  const commits = log.stdout.split('\x1e').filter((c) => c.trim()).map((c) => {
    const [head, ...rest] = c.split('\n');
    const [hash, ct, subject] = head.split('\x1f');
    return { hash: hash.slice(0, 10), t: Number(ct) * 1000, subject, files: rest.map((f) => f.trim()).filter(Boolean) };
  });
  const since = Date.now() - days * 864e5;
  const recent = commits.filter((c) => c.t >= since);
  const churn = new Map(), pair = new Map();
  for (const c of recent) {
    const fs_ = c.files.filter((f) => !LOCKS.test(f));
    for (const f of fs_) churn.set(f, (churn.get(f) || 0) + 1);
    if (fs_.length < 2 || fs_.length > 30) continue;
    const s = [...new Set(fs_)].sort();
    for (let i = 0; i < s.length; i++) for (let j = i + 1; j < s.length; j++) { const k = `${s[i]}\n${s[j]}`; pair.set(k, (pair.get(k) || 0) + 1); }
  }
  const date = (t) => new Date(t).toISOString().slice(0, 10);
  const reverts = commits.filter((c) => REVERT.test(c.subject));
  const chains = [];
  let cur = null;
  for (const c of [...commits].reverse()) { // oldest first
    const isFix = FIX.test(c.subject) || REVERT.test(c.subject);
    if (isFix && cur && c.files.some((f) => cur.files.has(f))) { cur.items.push(c); c.files.forEach((f) => cur.files.add(f)); continue; }
    if (cur && cur.items.length >= 2) chains.push(cur);
    cur = isFix ? { items: [c], files: new Set(c.files) } : null;
  }
  if (cur && cur.items.length >= 2) chains.push(cur);
  const count = (args) => { const r = git(root, args); return r.status === 0 ? r.stdout.split('\n').filter(Boolean).length : null; };
  return {
    commits: Number(git(root, ['rev-list', '--count', 'HEAD']).stdout.trim()) || commits.length,
    first_commit: git(root, ['log', '--max-parents=0', '--format=%cs']).stdout.trim().split('\n').pop() || null,
    contributors: count(['shortlog', '-sn', 'HEAD']), // a count only, never names
    branches: count(['for-each-ref', '--format=%(refname:short)', 'refs/heads']),
    uncommitted: count(['status', '--porcelain']),
    window_days: days,
    hotspots: [...churn].sort((a, b) => b[1] - a[1]).slice(0, 15).map(([file, n]) => ({ file, commits: n })),
    co_change: [...pair].filter(([, n]) => n >= minPair).sort((a, b) => b[1] - a[1]).slice(0, 20).map(([k, n]) => ({ files: k.split('\n'), together: n })),
    reverts: { count: reverts.length, recent: reverts.slice(0, 10).map((c) => ({ date: date(c.t), subject: c.subject })) },
    fix_chains: chains.sort((a, b) => b.items.length - a.items.length).slice(0, 10)
      .map((ch) => ({ length: ch.items.length, from: date(ch.items[0].t), files: [...ch.files].slice(0, 5), subjects: ch.items.map((c) => c.subject).slice(0, 6) })),
  };
}

function containers(root) {
  if (tool('docker', ['version', '--format', '{{.Server.Version}}'], { timeout: 5000 }).status !== 0) return null;
  const r = tool('docker', ['ps', '--format', '{{json .}}'], { timeout: 8000 });
  if (r.status !== 0) return null;
  const norm = (p) => path.resolve(p).toLowerCase();
  const mine = [];
  let others = 0;
  for (const line of r.stdout.split('\n').filter(Boolean)) {
    let c; try { c = JSON.parse(line); } catch { continue; }
    const labels = Object.fromEntries(String(c.Labels || '').split(',').map((kv) => kv.split(/=(.*)/s)));
    const wd = labels['com.docker.compose.project.working_dir'];
    if (wd && (norm(wd) + path.sep).startsWith(norm(root) + path.sep)) mine.push({ id: c.ID, name: c.Names, image: c.Image, compose_project: labels['com.docker.compose.project'] || null });
    else others++;
  }
  return { related: mine, unrelated_count: others };
}

// Claude Code keeps transcripts in ~/.claude/projects/<cwd with every non-alphanumeric char as "-">/.
export function sessionsDir(root) {
  return path.join(os.homedir(), '.claude', 'projects', fs.realpathSync.native(root).replace(/[^a-zA-Z0-9]/g, '-'));
}
function sessions(root, cap) {
  const dir = sessionsDir(root);
  let files = [];
  try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl')); } catch { return { found: false, dir_hint: '~/.claude/projects/<encoded-repo-path>/' }; }
  const rows = files.map((f) => { const s = fs.statSync(path.join(dir, f)); return { file: f, kb: Math.round(s.size / 1024), modified: s.mtime.toISOString().slice(0, 10) }; })
    .sort((a, b) => b.modified.localeCompare(a.modified) || b.kb - a.kb);
  return { found: true, dir_hint: '~/.claude/projects/<encoded-repo-path>/', count: rows.length, total_mb: Math.round(rows.reduce((s, r) => s + r.kb, 0) / 1024), suggested_cap: cap, recent: rows.slice(0, 50) };
}

export function survey(root, flags) {
  const skip = new Set(many(flags.skip).flatMap((s) => String(s).split(',')));
  const s = {
    surveyed: new Date().toISOString(),
    repo: slug(root),
    stack: stack(root),
    git: history(root, { days: Number(flags.days) || 90, minPair: Number(flags['min-pair']) || 3 }),
    runs: Object.fromEntries(pairs(flags.run).map(([n, c]) => [n, measure(root, n, c)])),
    gitleaks: skip.has('gitleaks') ? { skipped: true } : gitleaks(root) ?? { installed: false },
    containers: skip.has('docker') ? { skipped: true } : containers(root) ?? { docker: false },
    portability: skip.has('portability') ? { skipped: true } : portability(root),
    sessions: skip.has('sessions') ? { skipped: true } : sessions(root, Number(flags['session-cap']) || 10),
    mempalace_wing: slug(root),
  };
  return s;
}

const list = (a, f = (x) => x) => (a?.length ? a.map((x) => `- ${f(x)}`).join('\n') : '- none found');
export function surveyMd(s) {
  const g = s.git, st = s.stack;
  const leaks = s.gitleaks.skipped ? 'skipped' : s.gitleaks.installed === false ? 'gitleaks is not installed, so history was not scanned'
    : `${s.gitleaks.count} finding(s) in git history${s.gitleaks.count ? ` (${Object.entries(s.gitleaks.rules).map(([r, n]) => `${r} ${n}`).join(', ')}); values are never shown` : ''}`;
  const runs = Object.entries(s.runs);
  return `# Adoption survey: ${s.repo}

Read-only facts, gathered ${s.surveyed.slice(0, 10)}. Nothing in the project was changed.

## The project
- ${g.commits} commits since ${g.first_commit || '?'}, ${g.contributors ?? '?'} contributor(s), ${g.branches ?? '?'} local branch(es).
- Uncommitted changes right now: ${g.uncommitted ?? '?'} file(s). These are left alone.
- Building blocks found: ${st.manifests.join(', ') || 'none'}.
${st.engine ? `- Engine: ${st.engine}.\n` : ''}- Hosting and infrastructure files: ${st.infra.join(', ') || 'none'}.
- Automatic checks (CI): ${st.ci.join(', ') || 'none'}.
- Test files: ${st.test_files}.
- Settings names the app expects (values never read): ${st.env_names.join(', ') || 'none found'}.
- Existing AI setup kept as is: ${st.claude_setup.join(', ') || 'none'}.

## Existing north-star docs (vision, design doc, PRD)
${list(st.north_star, (d) => `${d.file}${d.sections.length ? ` (sections: ${d.sections.join(', ')})` : ''}`)}
${st.north_star?.length ? '- docs/PROJECT.md becomes a thin index that links to these (fk bible init --index <doc>); it never copies or contradicts them.\n' : ''}
## Where the work concentrates (last ${g.window_days} days)
${list(g.hotspots, (h) => `${h.file}: changed in ${h.commits} commits`)}

## Files that change together (impact-map candidates)
${list(g.co_change, (p) => `${p.files.join(' + ')}: together ${p.together} times`)}

## Signs of past trouble
- Reverts: ${g.reverts?.count ?? 0}.
${list(g.reverts?.recent, (r) => `${r.date} ${r.subject}`)}
- Fix-after-fix chains:
${list(g.fix_chains, (c) => `${c.length} fixes in a row from ${c.from} on ${c.files.join(', ')}`)}

## Secrets in history
- ${leaks}.

## Running containers
${s.containers.skipped ? '- skipped' : s.containers.docker === false ? '- Docker not available' : `${list(s.containers.related, (c) => `${c.name} (${c.image}): already running, recorded as pre-existing at apply`)}\n- Other containers on this machine (not this project): ${s.containers.unrelated_count}`}

## Portability (does a fresh clone run on another machine?)
${!s.portability || s.portability.skipped ? '- skipped' : `- ${s.portability.kind} project: ${s.portability.pass} pass, ${s.portability.warn} warn (fk portability check).
${list(s.portability.items.filter((i) => i.status === 'warn'), (i) => `${i.label}: ${i.note}`)}`}

## Measured now
${runs.length ? runs.map(([n, r]) => `- ${n}: ${r.kind === 'coverage' ? `${r.value ?? '?'}% coverage` : `${r.value} problem(s)`} (exit ${r.exit})`).join('\n') : '- nothing run (no commands were given)'}

## Past Claude sessions for this folder
${s.sessions.skipped ? '- skipped' : s.sessions.found ? `- ${s.sessions.count} session file(s), ${s.sessions.total_mb} MB in ${s.sessions.dir_hint}. Mine at most the ${s.sessions.suggested_cap} most recent into the MemPalace wing "${s.mempalace_wing}".` : '- none found'}
`;
}
