// fk risk [--base <ref>] [--json]: propose a risk class (R0-R3) from the actual change, with plain reasons.
// The change: git diff of <base> (default: merge-base with main/master) against the working tree, plus untracked files.
// Agents may raise the class they declared, never lower it: effective = max(declared, proposed).
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig, globToRegex, protectedClass, MANIFEST, quietPath } from '../../hooks/lib.mjs';
import { say, git, needRoot, parseArgs } from './adopt/util.mjs';

export const CLASSES = ['R0', 'R1', 'R2', 'R3'];
export const maxClass = (...cs) => CLASSES[Math.max(...cs.map((c) => CLASSES.indexOf(c)), 0)];
const DEFAULTS = { r2_lines: 400, r2_files: 15 };

// R3 areas: matched on path words (split on / . _ - and camelCase), outside docs and tests. A word in a directory
// name is R3; a word only in the file name is R2 (useSession.ts, formatMoney.ts are usually not that area).
const AREAS = [
  ['auth or permissions', /^(?:auth|authn|authz|oauth|login|logout|permission|permissions|rbac|acl|jwt|password|passwords)$/],
  ['payments or money', /^(?:payment|payments|billing|invoice|invoices|checkout|wallet|refund|refunds|money|stripe)$/],
  ['database migrations or schema', /^(?:migration|migrations|migrate)$/],
  ['security or crypto', /^(?:security|crypto|cryptography|encrypt|encryption|decrypt|cipher|kms|csp|cors)$/],
  ['data deletion or privacy', /^(?:delete|deletion|erase|erasure|purge|gdpr|privacy|pii|consent|dpia)$/],
  ['infrastructure', /^(?:terraform|k8s|kubernetes|helm|pulumi|cloudformation|infra|iac)$/],
];
const SCHEMA = /(?:^|\/)(?:schema\.(?:prisma|sql|rb)|structure\.sql)$|(?:^|\/)(?:db|database)\/.*\.sql$/i;
// Added lines of code that touch auth, money or destructive SQL.
const SIGNAL = /\b(?:bcrypt|argon2|jwt|oauth|set_password|check_password|stripe|charge|refund)\b|\bauthenticate\(|\b(?:DROP TABLE|ALTER TABLE|DELETE FROM|TRUNCATE)\b/i;
const PROD_COMPOSE = /(?:^|\/)(?:docker-)?compose[.-](?:prod|production)[\w.-]*\.ya?ml$/i;
const CONTRACT = /(?:^|\/)(?:openapi|swagger)[\w.-]*\.(?:ya?ml|json)$|\.(?:proto|graphql|gql|avsc)$|(?:^|\/)(?:contracts?|api-spec)\//i;
const LOCK = /(?:^|\/)(?:package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?|poetry\.lock|uv\.lock|Pipfile\.lock|Cargo\.lock|go\.sum|Gemfile\.lock|composer\.lock)$/;
// An added line that names a dependency with a version: "name": "^1.2", name = "1.2", name==1.2, module v1.2.3, <artifactId>.
const DEP_LINE = /^\s*"(@?[\w./-]+)"\s*:\s*"[~^<>=]*\d[^"]*"|^\s*([\w.-]+)\s*=\s*(?:\{[^}]*version\s*=\s*)?"[~^<>=]*\d|^\s*([A-Za-z][\w.-]*)\s*(?:\[[^\]]*\])?\s*(?:[=<>~!]=|>|<)|^\s*(?:require\s+)?([\w.-]+\.[\w.-]+\/[\w./-]+)\s+v\d|^\s*["']([A-Za-z][\w.-]*)(?:\[[^\]]*\])?\s*(?:[=<>~!]=|>|<)[^"']*["']|<artifactId>([\w.-]+)<\/artifactId>|^\s*gem\s+["']([\w.-]+)["']/;

const words = (rel) => rel.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase().split(/[\s/._-]+/).filter(Boolean);

export function defaultBase(root) {
  for (const b of ['main', 'master', 'origin/main', 'origin/master']) {
    const r = git(root, ['merge-base', 'HEAD', b]);
    if (r.status === 0 && r.stdout.trim()) return r.stdout.trim();
  }
  return git(root, ['rev-parse', '--verify', '-q', 'HEAD']).status === 0 ? 'HEAD' : null;
}

// [{ path, added, removed, isNew }] and the added/removed lines of manifest files.
export function changes(root, base) {
  const files = new Map();
  const add = (p, a, d, isNew = false) => files.set(p, { path: p, added: a, removed: d, isNew });
  if (base) {
    for (const l of git(root, ['diff', '--numstat', '--no-renames', base]).stdout.split('\n').filter(Boolean)) {
      const [a, d, p] = l.split('\t');
      add(p, Number(a) || 0, Number(d) || 0);
    }
    for (const l of git(root, ['diff', '--name-status', '--no-renames', '--diff-filter=A', base]).stdout.split('\n').filter(Boolean)) {
      const p = l.split('\t')[1];
      if (files.has(p)) files.get(p).isNew = true;
    }
  }
  const untracked = git(root, base ? ['ls-files', '--others', '--exclude-standard'] : ['ls-files', '--others', '--cached', '--exclude-standard']).stdout.split('\n').filter(Boolean);
  for (const p of untracked) {
    if (files.has(p)) continue;
    let n = 0;
    try { n = fs.readFileSync(path.join(root, p), 'utf8').split('\n').length; } catch { /* unreadable */ }
    add(p, n, 0, true);
  }
  // One `git diff -U0` for every tracked change: path -> its +/- lines (headers before the first @@ are skipped).
  let byPath = null;
  const tracked = () => {
    if (byPath) return byPath;
    byPath = new Map();
    let cur = null, hunk = false;
    for (const l of (base ? git(root, ['-c', 'core.quotepath=off', 'diff', '-U0', '--no-renames', base]).stdout : '').split('\n')) {
      if (l.startsWith('diff --git ')) { cur = null; hunk = false; continue; }
      if (!hunk) {
        const m = /^\+\+\+ b\/(.*)$/.exec(l);
        if (m) { cur = m[1]; byPath.set(cur, []); }
        if (l.startsWith('@@')) hunk = true;
        continue;
      }
      if (cur && (l.startsWith('+') || l.startsWith('-'))) byPath.get(cur).push(l);
    }
    return byPath;
  };
  const diffLines = (p) => {
    if (base && !files.get(p).isNew) return tracked().get(p) || [];
    if (base && tracked().has(p)) return tracked().get(p);
    try { return fs.readFileSync(path.join(root, p), 'utf8').split('\n').map((l) => '+' + l); } catch { return []; }
  };
  return { files: [...files.values()], diffLines };
}

function depName(line) {
  const m = DEP_LINE.exec(line);
  return m ? (m.slice(1).find(Boolean) || '').toLowerCase() : null;
}
const SKIP_KEYS = new Set(['version', 'name', 'python', 'node', 'requires-python', 'edition', 'go', 'description', 'license', 'main', 'type']);

// Impact map rules: { id, when: [globs] } from docs/standards/impact-map.yaml (flow style, as the template writes it).
export function impactRules(root) {
  let text;
  try { text = fs.readFileSync(path.join(root, 'docs', 'standards', 'impact-map.yaml'), 'utf8'); } catch { return []; }
  const rules = [];
  for (const m of text.matchAll(/id:\s*([\w-]+)\s*,\s*when:\s*\[([^\]]*)\]/g)) {
    const globs = m[2].split(',').map((g) => g.trim().replace(/^["']|["']$/g, '')).filter((g) => g && !g.includes('{{'));
    if (globs.length) rules.push({ id: m[1], when: globs.map(globToRegex) });
  }
  return rules;
}

export function assess(root, { base } = {}) {
  base = base === undefined ? defaultBase(root) : base;
  const cfg = loadConfig(root).risk || {};
  const lim = { ...DEFAULTS, ...cfg };
  const extra = (cfg.r3 || []).map((g) => [g, globToRegex(g)]);
  const { files, diffLines } = changes(root, base);
  const reasons = [];
  let cls = 'R0';
  const raise = (c, why) => { reasons.push(`${c}: ${why}`); cls = maxClass(cls, c); };
  if (!files.length) return { class: 'R0', reasons: ['R0: no changes found'], files: [], lines: 0, base };
  const lines = files.reduce((n, f) => n + f.added + f.removed, 0);
  const hits = new Map();
  const note = (c, why, p) => { const k = `${c}|${why}`; if (!hits.has(k)) hits.set(k, []); if (!hits.get(k).includes(p)) hits.get(k).push(p); };
  for (const f of files) {
    const p = f.path;
    for (const [g, re] of extra) if (re.test(p)) note('R3', `matches the project's R3 rule ${g}`, p);
    const quiet = quietPath(p);
    if (!quiet) {
      const segs = p.split('/');
      const dirWords = segs.slice(0, -1).flatMap(words), fileWords = words(segs.at(-1));
      for (const [area, re] of AREAS) {
        if (dirWords.some((x) => re.test(x))) note('R3', area, p);
        else if (fileWords.some((x) => re.test(x))) note('R2', `name suggests ${area} (raise to R3 if it really is)`, p);
      }
      if (SCHEMA.test(p)) note('R3', 'database migrations or schema', p);
      if (/\.tf(?:vars)?$/i.test(p) || PROD_COMPOSE.test(p)) note('R3', 'infrastructure', p);
      if (!LOCK.test(p)) {
        const m = diffLines(p).filter((l) => l.startsWith('+')).map((l) => SIGNAL.exec(l)).find(Boolean);
        if (m) note('R3', `added code mentions ${m[0].replace(/\($/, '')} (auth, money or destructive SQL)`, p);
      }
    }
    if (/^\.github\/workflows\//i.test(p) || (!LOCK.test(p) && !MANIFEST.test(p) && protectedClass(root, p))) note('R3', 'CI or gate configuration', p);
    if (CONTRACT.test(p)) note('R2', 'public API or contract file', p);
    if (LOCK.test(p)) note('R1', 'dependency lockfile changed', p);
    if (!quiet && !LOCK.test(p)) note('R1', 'production code or config changed', p);
  }
  for (const r of impactRules(root)) {
    const hit = files.filter((f) => r.when.some((re) => re.test(f.path)));
    for (const f of hit) note('R2', `impact-map rule ${r.id}`, f.path);
  }
  const deps = new Set();
  for (const f of files.filter((x) => MANIFEST.test(x.path))) {
    const diff = diffLines(f.path);
    const removed = new Set(diff.filter((l) => l.startsWith('-')).map((l) => depName(l.slice(1))).filter(Boolean));
    for (const l of diff.filter((x) => x.startsWith('+'))) {
      const n = depName(l.slice(1));
      if (n && !removed.has(n) && !SKIP_KEYS.has(n)) deps.add(n);
    }
  }
  if (deps.size) raise('R2', `new dependencies: ${[...deps].slice(0, 8).join(', ')}${deps.size > 8 ? ', ...' : ''}`);
  for (const [k, ps] of hits) {
    const [c, why] = k.split('|');
    raise(c, `${why}: ${ps.slice(0, 4).join(', ')}${ps.length > 4 ? ` and ${ps.length - 4} more` : ''}`);
  }
  if (lines > lim.r2_lines) raise('R2', `${lines} lines changed (over ${lim.r2_lines})`);
  if (files.length > lim.r2_files) raise('R2', `${files.length} files changed (over ${lim.r2_files})`);
  if (cls === 'R0') reasons.push('R0: only docs, copy or tests changed');
  return { class: cls, reasons: reasons.sort((a, b) => b.localeCompare(a)), files: files.map((f) => f.path), lines, base };
}

export default async function risk(args) {
  const { flags } = parseArgs(args);
  const root = needRoot();
  const r = assess(root, { base: flags.base });
  if (flags.json) return say(JSON.stringify(r, null, 2));
  say(`fk risk: proposed ${r.class} (${r.files.length} files, ${r.lines} lines changed since ${r.base ? r.base.slice(0, 12) : 'the first commit'}).`);
  for (const x of r.reasons) say(`- ${x}`);
  say('Use the higher of this and the class you declared; you may raise a class, never lower it.');
}
