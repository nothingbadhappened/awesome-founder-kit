// fk budget plan <provider> <usd> | fk budget check | fk budget usage
// plan: prints plain steps and writes budget-as-code into infra/budgets/<provider>/. Never applies anything.
// check: reads each recorded cap back through the provider's CLI or API where possible, with timeouts.
// usage: Claude token usage via ccusage, only when the founder approved it in the toolchain.
import fs from 'node:fs';
import path from 'node:path';
import { sanctionedJson } from '../../hooks/lib.mjs';
import { needFkRoot, catalog, canonical, cli, markRun, projectName, KIT, say } from './steward/lib.mjs';

const TEMPLATES = path.join(KIT, 'templates', 'budgets');
const TEMPLATE_OF = { firebase: 'gcp' };
const OUT = (p) => path.join('infra', 'budgets', p);

function copyTree(src, dst, vars, written) {
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name), d = path.join(dst, e.name);
    if (e.isDirectory()) { copyTree(s, d, vars, written); continue; }
    if (fs.existsSync(d)) { written.push(['kept', d]); continue; }
    fs.mkdirSync(path.dirname(d), { recursive: true });
    fs.writeFileSync(d, fs.readFileSync(s, 'utf8').replace(/\{\{(\w+)\}\}/g, (m, k) => vars[k] ?? m));
    written.push(['created', d]);
  }
}

const recordLine = (p, usd, c) => `fk-approve budget ${p} ${usd}${c.hard_cap === 'yes' ? ' hard-cap' : ''}`;

function stepsMd(c, usd, project) {
  return [`# ${c.name} budget for ${project} ($${usd}/month)`, '',
    `Hard cap: ${c.hard_cap}. Billing-safety score: ${c.billing_safety_score}/10 (catalog checked ${c.verified}).`, '',
    '## Set it (you do this; the kit never does)', ...c.how_to_set.map((s, i) => `${i + 1}. ${s}`), '',
    `Billing page: ${c.billing_url}`, '', '## Emergency stop', c.kill_switch, '',
    '## Traps', ...c.traps.map((t) => `- ${t}`), '',
    `Then record it: type \`${recordLine(c.provider, usd, c)}\` as your whole message.`, ''].join('\n');
}

export function planBudget(root, provider, usd) {
  const cat = catalog();
  const p = canonical(provider);
  const c = cat[p];
  if (!c) return { error: `fk budget: "${provider}" is not in the provider catalog. Known: ${Object.keys(cat).join(', ')}.` };
  const amount = Number(String(usd).replace(/^\$/, ''));
  if (!(amount > 0)) return { error: 'fk budget: the amount is a monthly limit in US dollars, for example: fk budget plan vercel 20' };
  const project = projectName(root);
  const dst = path.join(root, OUT(p));
  const written = [];
  const tpl = path.join(TEMPLATES, TEMPLATE_OF[p] || p);
  if (fs.existsSync(tpl)) copyTree(tpl, dst, { USD: String(amount), PROJECT: project }, written);
  else {
    const f = path.join(dst, 'STEPS.md');
    if (fs.existsSync(f)) written.push(['kept', f]);
    else { fs.mkdirSync(dst, { recursive: true }); fs.writeFileSync(f, stepsMd(c, amount, project)); written.push(['created', f]); }
  }
  return { c, p, amount, written: written.map(([a, f]) => [a, path.relative(root, f).split(path.sep).join('/')]) };
}

function plan(root, provider, usd) {
  if (!provider || !usd) { say('usage: fk budget plan <provider> <usd/month>'); process.exitCode = 1; return; }
  const r = planBudget(root, provider, usd);
  if (r.error) { say(r.error); process.exitCode = 1; return; }
  const { c, p, amount, written } = r;
  say(`${c.name}: a $${amount}/month limit. Hard cap: ${c.hard_cap === 'yes' ? 'yes, the provider can stop spending at the limit' : c.hard_cap === 'partial' ? 'only partly; read the traps' : 'no, the provider only alerts; spending can pass the limit'}.`);
  say('Steps for the founder (the kit applies nothing):');
  c.how_to_set.forEach((s, i) => say(`  ${i + 1}. ${s}`));
  say(`Emergency stop: ${c.kill_switch}`);
  say(`Watch out for: ${c.traps.slice(0, 3).join('; ')}.`);
  for (const [a, f] of written) say(`${a.padEnd(8)}${f}`);
  if (c.hard_cap !== 'yes') say(`Because ${c.name} has no full hard cap, the founder approves using it in docs/process/founder-actions.md with a written reason.`);
  say(`To record the budget, the founder types this as the whole message: ${recordLine(p, amount, c)}`);
}

// ---- read-back. Each returns { status: 'verified'|'mismatch'|'unverified', note } ----
const fmt = (n) => `$${Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
const within = (found, usd) => found.filter((a) => Number(a) <= Number(usd) + 0.005);
const parse = (s) => { try { return JSON.parse(s); } catch { return null; } };
const noCli = (name, c) => ({ status: 'unverified', note: `the ${name} command-line tool is not installed or not logged in; check ${c.billing_url} by hand` });

function readAmounts(found, usd, what) {
  if (!found.length) return { status: 'mismatch', note: `no ${what} found` };
  const ok = within(found, usd);
  return ok.length ? { status: 'verified', note: `${what} of ${fmt(ok[0])} found (recorded ${fmt(usd)})` }
    : { status: 'mismatch', note: `${what} found (${found.map(fmt).join(', ')}) but all above the recorded ${fmt(usd)}` };
}

const CHECKS = {
  aws(rec, c) {
    const id = cli('aws', ['sts', 'get-caller-identity', '--query', 'Account', '--output', 'text']);
    if (!id.ok) return noCli('aws', c);
    const b = parse(cli('aws', ['budgets', 'describe-budgets', '--account-id', id.out.trim(), '--output', 'json']).out);
    if (!b) return { status: 'unverified', note: 'could not read budgets (permission or timeout)' };
    const r = readAmounts((b.Budgets || []).map((x) => x.BudgetLimit?.Amount).filter(Boolean), rec.monthly_usd, 'an AWS budget');
    const acts = parse(cli('aws', ['budgets', 'describe-budget-actions-for-account', '--account-id', id.out.trim(), '--output', 'json']).out);
    return { ...r, note: `${r.note}; ${(acts?.Actions || []).length ? 'a budget action (deny policy) is set' : 'no budget action, so alerts only'}` };
  },
  gcp(rec, c) {
    const accts = parse(cli('gcloud', ['billing', 'accounts', 'list', '--format=json']).out);
    if (!accts) return noCli('gcloud', c);
    const amounts = [];
    let topic = false;
    for (const a of accts.filter((x) => x.open)) {
      const id = String(a.name).split('/').pop();
      for (const b of parse(cli('gcloud', ['billing', 'budgets', 'list', `--billing-account=${id}`, '--format=json']).out) || []) {
        const u = b.amount?.specifiedAmount?.units;
        if (u != null) amounts.push(Number(u));
        if (b.allUpdatesRule?.pubsubTopic) topic = true;
      }
    }
    const r = readAmounts(amounts, rec.monthly_usd, 'a Google Cloud budget');
    return { ...r, note: `${r.note}; ${topic ? 'connected to Pub/Sub (kill switch possible)' : 'no Pub/Sub kill switch'}` };
  },
  azure(rec, c) {
    const b = parse(cli('az', ['consumption', 'budget', 'list', '-o', 'json']).out);
    if (!b) return noCli('az', c);
    return readAmounts(b.map((x) => x.amount).filter((x) => x != null), rec.monthly_usd, 'an Azure budget');
  },
  async openrouter(rec, c) {
    if (!process.env.OPENROUTER_API_KEY) return { status: 'unverified', note: `OPENROUTER_API_KEY is not set in this shell; check key limits at ${c.billing_url}` };
    try {
      const r = await fetch('https://openrouter.ai/api/v1/key', { headers: { authorization: `Bearer ${process.env.OPENROUTER_API_KEY}` }, signal: AbortSignal.timeout(5000) });
      const lim = (await r.json())?.data?.limit;
      if (lim == null) return { status: 'mismatch', note: 'the key in use has no credit limit' };
      return readAmounts([lim], rec.monthly_usd, 'a key credit limit');
    } catch { return { status: 'unverified', note: 'OpenRouter did not answer within 5 seconds' }; }
  },
};
CHECKS.firebase = CHECKS.gcp;

export async function checkProvider(provider, rec) {
  const p = canonical(provider);
  const c = catalog()[p];
  if (!c) return { status: 'unverified', note: 'not in the provider catalog' };
  if (!CHECKS[p]) return { status: 'unverified', note: `${c.name} offers no command to read the cap back; open ${c.billing_url}, confirm it, and tick it in docs/process/founder-actions.md` };
  try { return await CHECKS[p](rec, c); } catch { return { status: 'unverified', note: 'the check failed or timed out' }; }
}

async function check(root) {
  const providers = sanctionedJson(root, '.fk/budgets.json', {}).providers || {};
  const names = Object.keys(providers);
  if (!names.length) { say('fk budget check: no budgets recorded yet. The founder records one with: fk-approve budget <provider> <usd/month> [hard-cap]'); markRun(root, 'budget_check'); return; }
  const words = { verified: 'verified  ', mismatch: 'MISMATCH  ', unverified: 'unverified' };
  for (const p of names) {
    const r = await checkProvider(p, providers[p]);
    say(`${words[r.status]}  ${p} ($${providers[p].monthly_usd}/month${providers[p].hard_cap ? ', hard cap' : ''}): ${r.note}`);
  }
  markRun(root, 'budget_check');
  say('verified = read back from the provider; unverified = the kit could not read it, so check by hand; MISMATCH = fix it in the provider console.');
}

// ---- Claude token usage: ccusage only when approved in .fk/toolchain.json ----
const HOW_TO = 'Type /usage in Claude Code to see your plan limits and how much is left. To get daily cost numbers here, approve ccusage in the toolchain (founder types: fk-approve tool ccusage@20.0.23 <reason>).';
function usage(root) {
  const tc = sanctionedJson(root, '.fk/toolchain.json', {});
  const spec = (tc.approved || []).find((s) => /^ccusage@\d/.test(s));
  if (!spec) return say(`fk budget usage: ccusage is not approved for this project. ${HOW_TO}`);
  const r = cli('npx', ['--yes', spec, 'daily', '--json'], { timeout: 60000 });
  const j = parse(r.out);
  if (!j?.daily) return say(`fk budget usage: ccusage did not return data (${r.timedOut ? 'timed out' : 'error'}). ${HOW_TO}`);
  say(`Claude Code usage, last ${Math.min(7, j.daily.length)} days (from ${spec}):`);
  for (const d of j.daily.slice(-7)) say(`  ${d.date || d.period}  ${fmt(d.totalCost ?? d.costUSD ?? 0)}  ${Number(d.totalTokens ?? 0).toLocaleString('en-US')} tokens`);
  if (j.totals) say(`  total ${fmt(j.totals.totalCost ?? j.totals.costUSD ?? 0)}`);
}

export default async function budget(args) {
  const root = needFkRoot();
  const [sub, ...rest] = args;
  if (sub === 'plan') return plan(root, rest[0], rest[1]);
  if (sub === 'check') return check(root);
  if (sub === 'usage') return usage(root);
  say('usage: fk budget plan <provider> <usd/month> | fk budget check | fk budget usage'); process.exitCode = 1;
}
