// fk actions [--provider p]... | fk actions verify
// Writes the single batched founder checklist, docs/process/founder-actions.md: accounts, .env key names (never values),
// billing caps, API-key check, production approvals, gate relaxations. Ticks are kept across runs; `verify` re-checks
// what the kit can check (it reads provider caps back) and ticks those items.
import fs from 'node:fs';
import path from 'node:path';
import { sanctionedJson, readJson, readLog, fkHome } from '../../hooks/lib.mjs';
import { needFkRoot, catalog, canonical, say } from './steward/lib.mjs';
import { parseFlags } from './ledger.mjs';
import { checkProvider } from './budget.mjs';

export const FILE = path.join('docs', 'process', 'founder-actions.md');
const SKIP = new Set(['node_modules', '.git', '.omc', '.fk', 'dist', 'build', 'vendor', '.venv', 'venv', '.next']);

function walk(dir, depth, out) {
  let es;
  try { es = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of es) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (!SKIP.has(e.name) && depth < 3) walk(p, depth + 1, out); } else out.push(p);
  }
  return out;
}

// Providers this project uses: recorded budgets, config files, dependencies, Terraform providers, earlier checklist, --provider.
export function detectProviders(root, extra = [], previous = []) {
  const cat = catalog();
  const found = new Set([...extra.map(canonical), ...previous].filter((p) => cat[p]));
  for (const p of Object.keys(sanctionedJson(root, '.fk/budgets.json', {}).providers || {})) if (cat[canonical(p)]) found.add(canonical(p));
  const files = walk(root, 0, []).map((f) => path.relative(root, f).split(path.sep).join('/'));
  const pkg = readJson(path.join(root, 'package.json'), {});
  const deps = new Set(Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }));
  let pyText = '';
  for (const f of ['requirements.txt', 'pyproject.toml']) { try { pyText += fs.readFileSync(path.join(root, f), 'utf8').toLowerCase(); } catch { /* none */ } }
  const tfText = files.filter((f) => f.endsWith('.tf') && !f.startsWith('infra/budgets/')).map((f) => { try { return fs.readFileSync(path.join(root, f), 'utf8'); } catch { return ''; } }).join('\n');
  for (const [p, c] of Object.entries(cat)) {
    const d = c.detect || {};
    if ((d.files || []).some((f) => files.includes(f))) found.add(p);
    if ((d.deps || []).some((x) => deps.has(x) || new RegExp(`^${x.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}\\b`, 'm').test(pyText))) found.add(p);
    if (d.tf && new RegExp(`provider\\s+"${d.tf}"`).test(tfText)) found.add(p);
  }
  return [...found].sort();
}

// Key names from .env.example / .env.sample / .env.template; values in .env are checked for presence only, never returned.
const keysIn = (text) => text.split(/\r?\n/).map((l) => /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(l)).filter(Boolean);
export function envKeys(root) {
  const names = new Set();
  for (const f of ['.env.example', '.env.sample', '.env.template']) { try { for (const m of keysIn(fs.readFileSync(path.join(root, f), 'utf8'))) names.add(m[1]); } catch { /* none */ } }
  const filled = new Set();
  for (const f of ['.env', '.env.local']) {
    try { for (const m of keysIn(fs.readFileSync(path.join(root, f), 'utf8'))) if (m[2].trim().replace(/^["']|["']$/g, '')) filled.add(m[1]); } catch { /* none */ }
  }
  return { names: [...names].sort(), filled };
}

// Previous checklist: ticked ids, founder-written reasons, providers listed.
export function readPrevious(root) {
  const ticked = new Set(), reasons = {}, providers = [];
  let text = '';
  try { text = fs.readFileSync(path.join(root, FILE), 'utf8'); } catch { return { ticked, reasons, providers }; }
  for (const l of text.split(/\r?\n/)) {
    const id = /<!-- fk:([\w:.-]+) -->/.exec(l)?.[1];
    if (!id) continue;
    if (/^\s*- \[[xX]\]/.test(l)) ticked.add(id);
    const r = /Reason: (.*?)\s*<!--/.exec(l)?.[1];
    if (r && !/^_+$/.test(r)) reasons[id] = r;
    const p = /^(?:account|cap):(.+)$/.exec(id)?.[1];
    if (p && !providers.includes(p)) providers.push(p);
  }
  return { ticked, reasons, providers };
}

function gateRelaxations(root) {
  const since = Date.now() - 14 * 24 * 60 * 60 * 1000;
  const rows = readLog(root);
  const seen = new Map();
  for (const r of rows) {
    if (Date.parse(r.ts) < since || r.guard !== 'gate-guard' || !['deny', 'tamper'].includes(r.decision)) continue;
    const what = (r.changed || []).join(', ') || String(r.reason || '').replace(/^fk gate-guard:\s*/, '').slice(0, 80);
    if (what) seen.set(what, r.ts.slice(0, 10));
  }
  return [...seen].slice(-10);
}

// Builds the item list. auto: true/false when the kit can check it now, null when only the founder can.
export function buildItems(root, { extra = [], prev } = {}) {
  const cat = catalog();
  const providers = detectProviders(root, extra, prev.providers);
  const budgets = sanctionedJson(root, '.fk/budgets.json', {}).providers || {};
  const env = envKeys(root);
  const sections = [];
  const S = (title, items) => items.length && sections.push({ title, items });

  S('Accounts to create', providers.map((p) => ({ id: `account:${p}`, text: `Create a ${cat[p].name} account (use a company email you control): ${cat[p].signup}.`, check: 'tick it yourself', auto: null })));

  const keyNames = env.names.length ? env.names : [...new Set(providers.flatMap((p) => cat[p].env_keys || []))];
  S('Keys to put in .env (names only; never paste a value in chat, code or this file)', keyNames.map((k) => ({
    id: `env:${k}`, text: `Put \`${k}\` in .env${env.names.length ? '' : ' (suggested; add it to .env.example too)'}.`,
    check: 'fk actions verify ticks it when .env has a value for this name; the value is never read out', auto: env.filled.has(k) })));

  S('Billing caps (only the provider can stop a bill; the kit cannot)', providers.flatMap((p) => {
    const c = cat[p], b = budgets[p] || budgets[Object.keys(budgets).find((k) => canonical(k) === p)];
    if (c.spend_model === 'fees') return [{ id: `cap:${p}`, text: `${c.name} has no bill to cap (it takes fees per payment). Instead: ${c.how_to_set.slice(1).join(' ')} Emergency stop: ${c.kill_switch}`, check: 'tick it yourself', auto: null }];
    const items = [{ id: `cap:${p}`, provider: p, rec: b,
      text: `Set a ${c.hard_cap === 'yes' ? 'hard cap' : 'budget'} on ${c.name}: ${c.how_to_set[0]} Plan and files: \`fk budget plan ${p} <usd>\`. Then type \`fk-approve budget ${p} <usd>${c.hard_cap === 'yes' ? ' hard-cap' : ''}\`. ${c.billing_url}`,
      check: b ? `recorded at $${b.monthly_usd}/month; fk actions verify reads it back where the provider allows` : 'not recorded yet', auto: false }];
    if (c.hard_cap !== 'yes') items.push({ id: `accept:${p}`, text: `${c.name} has ${c.hard_cap === 'no' ? 'no hard cap' : 'only a partial cap'} (alerts can arrive after the money is spent). Approve using it anyway by writing why.`, reason: true, check: 'ticked when you write a reason', auto: null });
    return items;
  }));

  // Machine steps `fk setup` cannot take (admin rights and a restart, a browser sign-in), from its cached status.
  const machine = Object.values(readJson(path.join(fkHome(), 'base-tools.json'), {}).tools || {}).flatMap((t) => t?.founder || []).sort((a, b) => !!b.blocking - !!a.blocking);
  S('This computer (steps only you can take)', machine.map((f) => ({ id: `machine:${f.id}`, text: f.text, check: 'fk setup checks it again and drops this line once done', auto: null })));

  const apiKey = !!process.env.ANTHROPIC_API_KEY;
  S('Claude subscription or API key', [{ id: 'claude:billing',
    text: apiKey ? 'ANTHROPIC_API_KEY is set in this shell, so Claude Code may bill per token instead of your subscription. If that is intended, create a Claude Console workspace with a monthly spend limit (https://console.anthropic.com/settings/workspaces); if not, remove the variable.'
      : 'Claude Code uses your subscription (no ANTHROPIC_API_KEY set). Type /usage to see your limits.',
    check: 'fk actions verify ticks it when ANTHROPIC_API_KEY is not set; with a key, tick it after setting the workspace limit', auto: apiKey ? null : true }]);

  S('Production deploys, publishing and merges (always your call)', [
    { id: 'approve:deploy', text: 'Production deploys, store submissions and publishing: the kit asks you each time (cloud-guard). Answer only when it fits the budget.', check: 'tick it once you have read this', auto: null },
    { id: 'approve:merge', text: 'Merges to main: either grant auto-merge after review once, or keep them batched for you. Tell the agent which.', check: 'tick it yourself', auto: null },
  ]);

  S('Gate relaxations an agent asked for (last 14 days)', gateRelaxations(root).map(([what, day]) => ({ id: `gate:${what.replace(/[^\w.-]+/g, '_').slice(0, 60)}`,
    text: `${day}: an agent tried to loosen or edit \`${what}\`. If you agree, type \`fk-override gate <reason>\` (30 minutes); otherwise leave it.`, check: 'tick it once decided', auto: null })));
  return sections;
}

export function render(sections, prev, date = new Date().toISOString().slice(0, 10)) {
  const out = ['# Founder actions', '', `Made by \`fk actions\` on ${date}. Everything here needs you, batched in one place. Tick a box yourself (\`[x]\`), or run \`fk actions verify\` to let the kit re-check what it can. Names only: never paste a secret value here.`, ''];
  let n = 0, done = 0;
  sections.forEach((s, i) => {
    out.push(`## ${i + 1}. ${s.title}`, '');
    for (const it of s.items) {
      const reason = prev.reasons[it.id];
      const tick = prev.ticked.has(it.id) || it.auto === true || (it.reason && !!reason);
      n++; if (tick) done++;
      out.push(`- [${tick ? 'x' : ' '}] ${it.text}${it.reason ? ` Reason: ${reason || '____'}` : ''} (Kit check: ${it.check}.) <!-- fk:${it.id} -->`);
    }
    out.push('');
  });
  return { text: out.join('\n'), n, done };
}

export default async function actions(args) {
  const root = needFkRoot();
  const { pos, flags } = parseFlags(args);
  const verify = pos[0] === 'verify';
  if (pos[0] && !verify) { say('usage: fk actions [--provider <name>] | fk actions verify'); process.exitCode = 1; return; }
  const prev = readPrevious(root);
  const extra = [].concat(flags.provider || []);
  const sections = buildItems(root, { extra, prev });
  const checked = [];
  if (verify) {
    for (const s of sections) for (const it of s.items) {
      if (!it.provider || !it.rec) continue;
      const r = await checkProvider(it.provider, it.rec);
      it.auto = r.status === 'verified';
      checked.push(`${it.provider}: ${r.status}, ${r.note}`);
    }
  }
  const { text, n, done } = render(sections, prev);
  const file = path.join(root, FILE);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
  say(`fk actions: docs/process/founder-actions.md has ${n} items, ${done} done.`);
  for (const c of checked) say(`  ${c}`);
  if (!verify) say('Run `fk actions verify` after you have done some of them; it ticks what the kit can confirm.');
}
