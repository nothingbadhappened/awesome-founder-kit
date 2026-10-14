// fk scout new [--delta] [--title "..."] | add <id> <draft.json> | render <id> | list | stale [days]
// The toolchain proposal lives in .fk/proposals/<id>.json (protected; only this CLI writes it). Agents draft entries in any
// project file, `add` merges them, `render` writes the founder's page and records its hash; the founder's
// `fk-approve proposal <id>` line only works while the proposal still has that hash.
import fs from 'node:fs';
import path from 'node:path';
import { projectRoot, rel, save, load, fileHash, validate, renderPage, groupOf, readJson, refreshSnapshot, say, today, ID, PAGE } from './scout/lib.mjs';

const USAGE = 'usage: fk scout new [--delta] [--title "<text>"] | fk scout add <id> <draft.json> | fk scout render <id> | fk scout list | fk scout stale [days]';
const fail = (msg) => { say(msg); process.exitCode = 1; };
const existingMcp = (root) => Object.keys(readJson(path.join(root, '.mcp.json'), {}).mcpServers || {});

function getProposal(root, id) {
  if (!ID.test(id || '')) return fail(`fk scout: "${id ?? ''}" is not a proposal id.`), null;
  if (!fs.existsSync(path.join(root, rel.proposal(id)))) return fail(`fk scout: no proposal ${id}. Start one with: fk scout new`), null;
  const p = load(root, rel.proposal(id));
  if (!p) fail(`fk scout: .fk/proposals/${id}.json was changed outside the fk CLI. Restore it (git checkout) or start a new proposal.`);
  return p;
}

function create(root, args) {
  const dir = path.join(root, '.fk', 'proposals');
  const stamp = today().replace(/-/g, '');
  const taken = fs.existsSync(dir) ? fs.readdirSync(dir) : [];
  let n = 1;
  while (taken.includes(`${stamp}-${n}.json`)) n++;
  const id = `${stamp}-${n}`;
  const ti = args.indexOf('--title');
  const p = { id, title: ti >= 0 ? args[ti + 1] : null, delta: args.includes('--delta'), created: new Date().toISOString(),
    capabilities: [], entries: [], rules: [], environment: { runtimes: [], isolation: null, env_vars: [], ports: [], disk: null, verify: [] },
    conflicts: [], rejected: [] };
  save(root, rel.proposal(id), p);
  say(`fk scout: proposal ${id} created (.fk/proposals/${id}.json).`);
  say(`Next: write entries to a draft JSON file, then: fk scout add ${id} <draft.json>; then: fk scout render ${id}`);
}

const byName = (a, b) => { const m = new Map(a.map((x) => [x.name ?? x, x])); for (const x of b) m.set(x.name ?? x, x); return [...m.values()]; };

function add(root, id, draftPath) {
  const p = getProposal(root, id);
  if (!p) return;
  let d;
  try { d = JSON.parse(fs.readFileSync(path.resolve(draftPath || ''), 'utf8')); } catch (e) { return fail(`fk scout: cannot read the draft ${draftPath ?? ''}: ${e.message}`); }
  if (Array.isArray(d)) d = { entries: d };
  for (const k of ['entries', 'rejected', 'capabilities']) if (d[k]) p[k] = byName(p[k] || [], d[k]);
  for (const k of ['rules', 'conflicts']) if (d[k]) p[k] = [...new Set([...(p[k] || []), ...d[k]])];
  if (d.environment) p.environment = { ...p.environment, ...d.environment };
  if (d.title) p.title = d.title;
  save(root, rel.proposal(id), p);
  fs.rmSync(path.join(root, rel.render(id)), { force: true }); // any earlier render no longer matches
  refreshSnapshot(root, [rel.render(id)]);
  const errors = validate(p, { existingMcp: existingMcp(root), root });
  say(`fk scout: ${id} now has ${p.entries.length} entries, ${p.rejected.length} rejected.`);
  if (errors.length) say(`Fix before rendering:\n- ${errors.join('\n- ')}`);
}

function render(root, id) {
  const p = getProposal(root, id);
  if (!p) return;
  if (fs.existsSync(path.join(root, rel.approval(id)))) return fail(`fk scout: ${id} is already approved. Changes go in a delta proposal: fk scout new --delta`);
  const errors = validate(p, { existingMcp: existingMcp(root), root });
  if (errors.length) return fail(`fk scout: ${id} is not ready:\n- ${errors.join('\n- ')}`);
  const hash = fileHash(root, rel.proposal(id));
  const page = path.join(root, PAGE);
  fs.mkdirSync(path.dirname(page), { recursive: true });
  fs.writeFileSync(page, renderPage(p, hash));
  save(root, rel.render(id), { id, hash, page: PAGE, rendered: new Date().toISOString() });
  const counts = {};
  for (const e of p.entries) counts[groupOf(e)] = (counts[groupOf(e)] || 0) + 1;
  say(`fk scout: rendered ${PAGE} (hash ${hash}). ${Object.entries(counts).map(([g, n]) => `${n} ${g}`).join(', ') || 'no entries'}; ${p.rejected.length} rejected.`);
  say(`Show the founder the page and summarize it in plain words. They approve by typing alone: fk-approve proposal ${id} [without <name,...>]`);
}

function list(root) {
  const dir = path.join(root, '.fk', 'proposals');
  const ids = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.json') && !/\.(render|approval)\.json$/.test(f)).map((f) => f.slice(0, -5)) : [];
  if (!ids.length) return say('fk scout: no proposals yet.');
  for (const id of ids) {
    const p = readJson(path.join(dir, `${id}.json`), {});
    const state = fs.existsSync(path.join(dir, `${id}.approval.json`)) ? 'approved' : fs.existsSync(path.join(dir, `${id}.render.json`)) ? 'shown to founder' : 'draft';
    say(`${id}  ${state.padEnd(16)} ${(p.entries || []).length} entries${p.delta ? ' (delta)' : ''}${p.title ? `  ${p.title}` : ''}`);
  }
}

// Research notes carry "researched: YYYY-MM-DD"; anything older than the limit (default 90 days) must be re-checked before reuse.
function stale(root, days = 90) {
  const dir = path.join(root, 'docs', 'research');
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.md')) : [];
  const limit = Date.now() - Number(days) * 24 * 60 * 60 * 1000;
  const old = files.filter((f) => {
    const m = /^\s*researched:\s*(\d{4}-\d{2}-\d{2})/im.exec(fs.readFileSync(path.join(dir, f), 'utf8'));
    return !m || Date.parse(m[1]) < limit;
  });
  if (!old.length) return say(`fk scout: ${files.length} research notes, none older than ${days} days.`);
  say(`fk scout: re-check before reuse (older than ${days} days or undated):`);
  for (const f of old) say(`- docs/research/${f}`);
}

export default async function scout(args) {
  const [sub, ...rest] = args;
  if (!['new', 'add', 'render', 'list', 'stale'].includes(sub)) return fail(USAGE);
  const root = projectRoot();
  if (!root) return;
  if (sub === 'new') return create(root, rest);
  if (sub === 'add') return add(root, rest[0], rest[1]);
  if (sub === 'render') return render(root, rest[0]);
  if (sub === 'list') return list(root);
  return stale(root, rest[0] || 90);
}
