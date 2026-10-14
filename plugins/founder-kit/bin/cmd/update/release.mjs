// Founder Kit releases: the newest published version (GitHub, cached 24 h in <FK_HOME>/state/fk-latest.json, 2 s budget,
// silent offline) and the plain-language CHANGELOG.md entries between two versions.
// The repository comes from the marketplace Claude Code knows (known_marketplaces.json), else from compat.lock.json.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJson, writeJson, homeCache, cmpVer } from '../../../hooks/lib.mjs';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const DAY = 24 * 60 * 60 * 1000;
const SEMVER = /^v?(\d+\.\d+\.\d+)$/;
const GH = { headers: { accept: 'application/vnd.github+json', 'user-agent': 'founder-kit' } };

export const kitVersion = (dir = KIT) => readJson(path.join(dir, '.claude-plugin', 'plugin.json'), {})?.version || null;
export const pluginsDir = () => path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'plugins');

// { plugin: founder-kit@<marketplace>, name: <marketplace>, repo: owner/repo, dir: the local marketplace clone or null }
export function kitSource(lock = readJson(path.join(KIT, 'compat.lock.json'), {})) {
  const spec = lock?.tools?.['founder-kit'] || {};
  const plugin = spec.plugin || 'founder-kit@awesome-founder-kit';
  const name = plugin.split('@')[1];
  const known = readJson(path.join(pluginsDir(), 'known_marketplaces.json'), {})?.[name];
  return { plugin, name, repo: known?.source?.repo || spec.marketplace || null, dir: known?.installLocation || null };
}

const cacheFile = () => homeCache('fk-latest.json');
export const readKitCache = () => readJson(cacheFile(), {}) || {};
export const writeKitCache = (patch) => writeJson(cacheFile(), { ...readKitCache(), ...patch });

// FK_LATEST (tests): a version is used as is; "offline" behaves as an unreachable network.
const envLatest = () => {
  const e = process.env.FK_LATEST;
  if (e === undefined || e === 'offline') return undefined;
  return SEMVER.exec(e)?.[1] ?? null;
};

// Cache only, never the network (the session hot path). { latest, stale }.
export function kitLatestCached(now = Date.now()) {
  const e = envLatest();
  if (e !== undefined) return { latest: e, stale: false };
  const c = readKitCache();
  return { latest: c.latest || null, stale: now - Math.max(c.ts || 0, c.tried || 0) > DAY };
}

// The newest version: from the cache when it is under a day old (unless force), else GitHub releases, then tags,
// within 2 s. Offline or slow: the cached value (or null), silently.
export async function fetchKitLatest({ fetch: get = globalThis.fetch, repo = kitSource().repo, now = Date.now(), force = false } = {}) {
  const e = envLatest();
  if (e !== undefined) return e;
  const c = readKitCache();
  if (!force && c.latest && now - (c.ts || 0) < DAY) return c.latest;
  if (!repo || process.env.FK_LATEST === 'offline') return c.latest || null;
  try { writeKitCache({ tried: now }); } catch { /* read-only home */ }
  const signal = AbortSignal.timeout(2000);
  const pick = (list) => list.map((x) => SEMVER.exec(String(x || ''))?.[1]).filter(Boolean).sort(cmpVer).at(-1);
  try {
    const r = await get(`https://api.github.com/repos/${repo}/releases/latest`, { ...GH, signal });
    let v = r.ok ? pick([(await r.json())?.tag_name]) : null;
    if (!v) {
      const t = await get(`https://api.github.com/repos/${repo}/tags?per_page=100`, { ...GH, signal });
      v = t.ok ? pick(((await t.json()) || []).map((x) => x?.name)) : null;
    }
    if (v) { writeKitCache({ latest: v, ts: now }); return v; }
  } catch { /* offline or slow: stay silent */ }
  return c.latest || null;
}

// "## v0.8.0 (2026-11-02)" headings, newest first; the paragraph below each is the entry.
export function parseChangelog(text) {
  const out = [];
  let cur = null;
  for (const line of String(text || '').split(/\r?\n/)) {
    const h = /^##\s+v?(\d+\.\d+\.\d+)\s*(.*)$/.exec(line);
    if (h) { cur = { version: h[1], date: h[2].replace(/[()]/g, '').trim(), body: [] }; out.push(cur); continue; }
    if (/^#\s/.test(line)) { cur = null; continue; }
    if (cur) cur.body.push(line);
  }
  return out.map((e) => ({ ...e, body: e.body.join('\n').trim() }));
}

// Entries after `from` up to and including `to`, newest first.
export const sliceChangelog = (entries, from, to) => entries.filter((e) => cmpVer(e.version, from) > 0 && (!to || cmpVer(e.version, to) <= 0))
  .sort((a, b) => cmpVer(b.version, a.version));

// GitHub first (it has the newest entries), then the local marketplace clone.
export async function readChangelog({ fetch: get = globalThis.fetch, src = kitSource(), ref = 'main' } = {}) {
  if (src.repo && process.env.FK_LATEST !== 'offline') {
    try {
      const r = await get(`https://raw.githubusercontent.com/${src.repo}/${ref}/CHANGELOG.md`, { signal: AbortSignal.timeout(2000) });
      if (r.ok) return parseChangelog(await r.text());
    } catch { /* offline */ }
  }
  try { return parseChangelog(fs.readFileSync(path.join(src.dir || '', 'CHANGELOG.md'), 'utf8')); } catch { return []; }
}

// Tool pins that change between the installed compat.lock.json and the one published with `version` (null offline).
export async function lockChanges({ fetch: get = globalThis.fetch, src = kitSource(), version, lock = readJson(path.join(KIT, 'compat.lock.json'), {}) } = {}) {
  if (!src.repo || process.env.FK_LATEST === 'offline') return null;
  let next;
  try {
    const r = await get(`https://raw.githubusercontent.com/${src.repo}/v${version}/plugins/founder-kit/compat.lock.json`, { signal: AbortSignal.timeout(2000) });
    if (!r.ok) return null;
    next = await r.json();
  } catch { return null; }
  const pin = (t) => t?.commit || t?.version || null;
  return Object.keys({ ...(lock?.tools || {}), ...(next?.tools || {}) }).filter((id) => id !== 'founder-kit')
    .map((id) => ({ id, from: pin(lock?.tools?.[id]), to: pin(next?.tools?.[id]) })).filter((c) => c.from !== c.to);
}
