// fk score <npm|pypi|cargo|github>:<name>[@version] [--offline --fixtures <file>] [--input <judgement.json>] [--provenance p]
//   [--community n] [--kind k] [--json]
// Computes the automatable part of the scout rubric (skills/fk-scout/reference.md) from deps.dev, OSV, OpenSSF Scorecard and
// GitHub. Provenance, community verdict, data terms and platform fit are the agent's judgement, passed in with --input or flags.
import fs from 'node:fs';

const TIMEOUT = 5000;
const PROVENANCE = { official: 25, curated: 18, established: 12, anonymous: 0 };
const BILLING = { 'hard-cap': 10, prepaid: 8, alerts: 4, none: 0 };
const PRICING = { free: 15, fair: 10, 'lock-in': 3 };
const AUTOMATION = { 'official-mcp': 20, 'official-cli': 20, api: 12, none: 0 };
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const DAY = 24 * 60 * 60 * 1000;

// ---- rubric (pure) ----
export function score(s) {
  const gates = [];
  const flags = [];
  const pending = [];
  const commercial = s.profile === 'commercial';
  if (s.archived) gates.push('the source repository is archived');
  if (s.deleted) gates.push('the registry lists it as deleted');
  if (s.imitatesVendor) gates.push('the name imitates a vendor it does not belong to');
  if (s.dataTerms === 'bad') gates.push('its data terms are not acceptable for this project');
  if (!commercial) {
    if (s.mal?.length) gates.push(`known malicious package (${s.mal.join(', ')})`);
    if (s.critical?.length) gates.push(`open critical vulnerability (${s.critical.join(', ')})`);
    if (s.licence === null) gates.push('no licence');
    if (s.licenceConflict) gates.push(`licence ${s.licence} conflicts with the project licence`);
    if (s.installScriptFlagged) gates.push('install scripts flagged as risky');
    if (s.licence === undefined) pending.push('licence');
  }
  if (s.seesData && s.dataTerms !== 'known') flags.push('data terms unknown: test data only until they are checked');
  if (!(s.provenance in PROVENANCE)) pending.push('provenance');
  if (s.community === undefined) pending.push('community');

  const b = {};
  b.provenance = PROVENANCE[s.provenance] ?? 0;
  const platform = (s.osOk === true ? 4 : s.osOk === false ? 0 : 2) + (s.osIssues == null ? 1 : s.osIssues <= 2 ? 2 : 0)
    + (s.needsDocker ? 0 : 2) + (s.easyInstall === false ? 0 : 1) + (s.claudeDocs ? 1 : 0);
  const costKey = s.infra ? 'billing_safety' : 'token_cost';
  let cost;
  if (s.infra) cost = BILLING[s.billing] ?? 0;
  else if (s.kind === 'mcp') cost = (s.mcpTools == null ? 7 : s.mcpTools <= 10 ? 10 : s.mcpTools <= 30 ? 7 : 3) - (s.schemaTokens > 10000 ? 3 : 0);
  else cost = 10;
  if (commercial) {
    const c = s.commercial || {};
    b.terms = (s.dataTerms === 'known' ? 10 : 0) + (c.terms === 'ok' ? 10 : 0);
    b.pricing = PRICING[c.pricing] ?? 0;
    b.automation = AUTOMATION[c.automation] ?? 0;
  } else {
    const age = s.lastCommitDays;
    b.maintenance = clamp((age == null ? 0 : age <= 90 ? 8 : age <= 180 ? 5 : age <= 365 ? 2 : 0)
      + (s.releasesLastYear >= 3 ? 4 : s.releasesLastYear >= 1 ? 2 : 0)
      + (s.maintainedCheck != null ? Math.round(clamp(s.maintainedCheck, 0, 10) / 10 * 4) : age != null && age <= 90 ? 2 : 0)
      + (s.contributors > 1 ? 4 : 0), 0, 20);
    const sc = s.scorecard;
    b.security = clamp((sc == null ? 0 : sc >= 7 ? 8 : sc >= 6 ? 6 : sc >= 4 ? 3 : 0) + (s.signedReleases ? 4 : 0)
      + (s.local === false ? 0 : 4) + (s.scanClean ? 4 : 0) - Math.min(8, 2 * (s.vulns?.length || 0)), 0, 20);
    b.adoption = clamp(Math.min(7, Math.round(1.75 * Math.log10((s.stars || 0) + 1)))
      + Math.min(5, Math.round(Math.log10((s.weeklyDownloads || 0) + 1) * 5 / 6))
      + (s.curatedLists >= 2 ? 3 : s.curatedLists === 1 ? 1 : 0), 0, 15);
  }
  b[costKey] = clamp(cost, 0, 10);
  b.platform_fit = clamp(platform, 0, 10);
  b.community = clamp(Number(s.community) || 0, -10, 10);
  const total = clamp(Object.values(b).reduce((x, y) => x + y, 0), 0, 100);
  const tier = gates.length ? 'reject' : total >= 75 ? 'propose' : total >= 55 ? 'caution' : 'reject';
  return { total, tier, provisional: pending.length > 0 && !gates.length, gates, flags, pending, breakdown: b };
}

export const TIER_WORDS = {
  propose: 'can be proposed (75 or more)',
  caution: 'only if nothing scoring 75 or more covers the need; logged as caution',
  reject: 'never installed',
};

// ---- signals (network or fixtures) ----
export function parseSpec(spec) {
  const m = /^(npm|pypi|cargo|github):(.+?)(?:@([^@/]+))?$/i.exec(String(spec || ''));
  return m ? { system: m[1].toLowerCase(), name: m[2], version: m[3] || null } : null;
}

function makeGet({ offline, fixtures }) {
  const map = fixtures ? JSON.parse(fs.readFileSync(fixtures, 'utf8')) : {};
  return async (url, { body, key } = {}) => {
    if (offline) return map[key || url] ?? null;
    try {
      const headers = { 'user-agent': 'founder-kit-scout', accept: 'application/json' };
      if (url.startsWith('https://api.github.com/') && process.env.GITHUB_TOKEN) headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
      if (body) headers['content-type'] = 'application/json';
      const r = await fetch(url, { method: body ? 'POST' : 'GET', headers, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(TIMEOUT) });
      return r.ok ? await r.json() : null;
    } catch { return null; }
  };
}

const DEPS = { npm: 'NPM', pypi: 'PYPI', cargo: 'CARGO' };
const OSV_ECO = { npm: 'npm', pypi: 'PyPI', cargo: 'crates.io' };
const enc = encodeURIComponent;
const daysAgo = (iso, now) => (iso ? Math.floor((now - Date.parse(iso)) / DAY) : null);
const check = (sc, name) => sc?.checks?.find((c) => c.name === name)?.score;

export async function fetchSignals(spec, opts = {}) {
  const p = parseSpec(spec);
  if (!p) throw new Error(`not a package spec: ${spec} (use npm:<name>, pypi:<name>, cargo:<name> or github:<owner>/<repo>, optionally @version)`);
  const get = makeGet(opts);
  const now = opts.now ?? Date.now();
  const s = { system: p.system, name: p.name, version: p.version, sources: [] };
  let repo = p.system === 'github' ? p.name : null;
  let versions = [];
  if (p.system !== 'github') {
    const base = `https://api.deps.dev/v3/systems/${DEPS[p.system]}/packages/${enc(p.name)}`;
    const pkg = await get(base);
    if (pkg) {
      s.sources.push('deps.dev');
      versions = (pkg.versions || []).map((v) => ({ v: v.versionKey?.version, at: v.publishedAt, def: v.isDefault }));
      s.version ||= versions.find((v) => v.def)?.v || versions.at(-1)?.v || null;
    }
    if (s.version) {
      const ver = await get(`${base}/versions/${enc(s.version)}`);
      if (ver) {
        s.licence = ver.licenses?.length ? ver.licenses.join(' AND ') : null;
        s.advisories = (ver.advisoryKeys || []).map((a) => a.id);
        s.deprecated = !!ver.isDeprecated;
        const src = (ver.relatedProjects || []).find((r) => r.relationType === 'SOURCE_REPO')?.projectKey?.id;
        if (src?.startsWith('github.com/')) repo ||= src.slice('github.com/'.length);
      }
      const osvKey = `osv:${OSV_ECO[p.system]}:${p.name}@${s.version}`;
      const osv = await get('https://api.osv.dev/v1/query', { key: osvKey, body: { package: { name: p.name, ecosystem: OSV_ECO[p.system] }, version: s.version } });
      if (osv) {
        s.sources.push('osv');
        const vulns = osv.vulns || [];
        s.mal = vulns.filter((v) => v.id.startsWith('MAL-')).map((v) => v.id);
        s.critical = vulns.filter((v) => !v.id.startsWith('MAL-') && String(v.database_specific?.severity).toUpperCase() === 'CRITICAL').map((v) => v.id);
        s.vulns = vulns.filter((v) => !s.mal.includes(v.id) && !s.critical.includes(v.id)).map((v) => v.id);
      }
    }
    const dl = p.system === 'npm' ? await get(`https://api.npmjs.org/downloads/point/last-week/${p.name}`)
      : p.system === 'pypi' ? await get(`https://pypistats.org/api/packages/${enc(p.name.toLowerCase())}/recent`)
        : await get(`https://crates.io/api/v1/crates/${enc(p.name)}`);
    if (dl) s.weeklyDownloads = dl.downloads ?? dl.data?.last_week ?? (dl.crate?.recent_downloads != null ? Math.round(dl.crate.recent_downloads / 13) : undefined);
  }
  if (repo) {
    s.repo = `github.com/${repo}`;
    const [gh, rel, contrib, sc, proj] = await Promise.all([
      get(`https://api.github.com/repos/${repo}`),
      get(`https://api.github.com/repos/${repo}/releases?per_page=30`),
      get(`https://api.github.com/repos/${repo}/contributors?per_page=2`),
      get(`https://api.securityscorecards.dev/projects/github.com/${repo}`),
      get(`https://api.deps.dev/v3/projects/${enc(`github.com/${repo}`)}`),
    ]);
    if (gh) {
      s.sources.push('github');
      s.archived = !!gh.archived;
      s.stars = gh.stargazers_count;
      s.lastCommitDays = daysAgo(gh.pushed_at, now);
      if (s.licence === undefined) s.licence = gh.license?.spdx_id && gh.license.spdx_id !== 'NOASSERTION' ? gh.license.spdx_id : null;
    }
    if (Array.isArray(rel)) s.releasesLastYear = rel.filter((r) => daysAgo(r.published_at, now) <= 365).length;
    if (Array.isArray(contrib)) s.contributors = contrib.length;
    const card = sc ? { overallScore: sc.score, checks: sc.checks } : proj?.scorecard;
    if (card) {
      s.sources.push('scorecard');
      s.scorecard = card.overallScore;
      s.maintainedCheck = check(card, 'Maintained');
      const signed = check(card, 'Signed-Releases');
      s.signedReleases = signed != null && signed > 0;
    }
    if (proj && s.stars == null) s.stars = proj.starsCount;
  }
  if (s.releasesLastYear == null && versions.length) s.releasesLastYear = versions.filter((v) => daysAgo(v.at, now) <= 365).length;
  if (s.lastCommitDays == null && versions.length) s.lastCommitDays = Math.min(...versions.map((v) => daysAgo(v.at, now)).filter((d) => d != null));
  if (!Number.isFinite(s.lastCommitDays)) s.lastCommitDays = null;
  s.easyInstall = true; // a package registry or a GitHub release
  return s;
}

// ---- CLI ----
function flag(args, name) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

export function summary(spec, r) {
  const parts = Object.entries(r.breakdown).map(([k, v]) => `${k.replace(/_/g, ' ')} ${v}`).join(', ');
  const lines = [`${spec}: ${r.total}/100, ${r.provisional ? 'provisional ' : ''}${r.tier} (${TIER_WORDS[r.tier]}).`, `  ${parts}.`];
  for (const g of r.gates) lines.push(`  hard fail: ${g}.`);
  for (const f of r.flags) lines.push(`  flag: ${f}.`);
  if (r.pending.length) lines.push(`  still to judge (agent): ${r.pending.join(', ')}. Pass them with --input <file.json> or flags; the score is provisional until then.`);
  return lines.join('\n');
}

export default async function main(args) {
  const valued = new Set(['--fixtures', '--input', '--provenance', '--community', '--kind']);
  let spec;
  for (let i = 0; i < args.length && !spec; i++) {
    if (valued.has(args[i])) i++;
    else if (!args[i].startsWith('--')) spec = args[i];
  }
  if (!spec || !parseSpec(spec)) {
    process.stdout.write('usage: fk score <npm|pypi|cargo|github>:<name>[@version] [--provenance official|curated|established|anonymous] [--community -10..10] [--kind cli|mcp|...] [--input judgement.json] [--offline --fixtures file.json] [--json]\n');
    process.exitCode = 1; return;
  }
  const offline = args.includes('--offline');
  const signals = await fetchSignals(spec, { offline, fixtures: flag(args, '--fixtures') });
  const input = flag(args, '--input') ? JSON.parse(fs.readFileSync(flag(args, '--input'), 'utf8')) : {};
  Object.assign(signals, input);
  if (flag(args, '--provenance')) signals.provenance = flag(args, '--provenance');
  if (flag(args, '--community') !== undefined) signals.community = Number(flag(args, '--community'));
  if (flag(args, '--kind')) signals.kind = flag(args, '--kind');
  const r = { spec, ...score(signals), signals };
  if (!args.includes('--json')) process.stdout.write(summary(spec, r) + '\n');
  process.stdout.write(JSON.stringify(r, null, 2) + '\n');
  if (!signals.sources.length && !offline) process.stdout.write('fk score: no source answered (offline?); the score uses only what you passed in.\n');
}
