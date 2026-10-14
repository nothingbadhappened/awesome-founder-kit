// fk metrics [--since 30d] [--json] [--write]: is the process paying off? Per task and in total:
// tokens and cost (estimate, from this project's Claude Code transcripts: usage numbers only, never content), time to
// done, rework, regressions after done, and what the guards and reviews caught versus false alarms.
// --write saves docs/process/metrics.md. FK_TRANSCRIPTS points at another transcripts folder (tests).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { readJson, writeJson, readLog, homeCache, rootKey } from '../../hooks/lib.mjs';
import { readTasks, readGateRuns } from '../../hooks/authorship.mjs';
import { say, git, needRoot, parseArgs } from './adopt/util.mjs';
import { readTask, reviews } from './task.mjs';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DAY = 24 * 60 * 60 * 1000;
export const notesKey = (root) => rootKey(root);
export const notesFile = () => homeCache('metrics-notes.json');

// Claude Code keeps a project's transcripts in <config>/projects/<cwd with every non-alphanumeric character as "-">.
export function transcriptsDir(root) {
  if (process.env.FK_TRANSCRIPTS) return process.env.FK_TRANSCRIPTS;
  const config = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
  return path.join(config, 'projects', path.resolve(root).replace(/[^A-Za-z0-9]/g, '-'));
}

// [{ ts, model, input, output, cache_write, cache_read }], one per API message (streamed entries repeat the same message id).
export function usageRows(dir, sinceMs) {
  const rows = [], seen = new Set();
  const walk = (d) => {
    let entries = [];
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { if (!['tool-results', 'memory'].includes(e.name)) walk(p); continue; }
      if (!e.name.endsWith('.jsonl')) continue;
      try { if (fs.statSync(p).mtimeMs < sinceMs) continue; } catch { continue; }
      let text = '';
      try { text = fs.readFileSync(p, 'utf8'); } catch { continue; }
      for (const line of text.split('\n')) {
        if (!line.includes('"usage"')) continue;
        let j;
        try { j = JSON.parse(line); } catch { continue; }
        const u = j?.message?.usage;
        if (j.type !== 'assistant' || !u) continue;
        const key = j.message.id || j.requestId || j.uuid;
        if (key && seen.has(key)) continue;
        if (key) seen.add(key);
        rows.push({ ts: Date.parse(j.timestamp), model: String(j.message.model || ''), input: u.input_tokens || 0, output: u.output_tokens || 0,
          cache_write: u.cache_creation_input_tokens || 0, cache_read: u.cache_read_input_tokens || 0 });
      }
    }
  };
  walk(dir);
  return rows;
}

const prices = () => readJson(path.join(KIT, 'catalog', 'model-prices.json'), { models: {} });
function sum(rows, table) {
  const t = { input: 0, output: 0, cache_write: 0, cache_read: 0, usd: 0, unpriced: 0 };
  const ids = Object.keys(table.models || {}).sort((a, b) => b.length - a.length);
  for (const r of rows) {
    for (const k of ['input', 'output', 'cache_write', 'cache_read']) t[k] += r[k];
    const p = table.models[ids.find((id) => r.model.startsWith(id))];
    if (!p) { t.unpriced += r.input + r.output + r.cache_write + r.cache_read; continue; }
    t.usd += (r.input * p.input + r.output * p.output + r.cache_write * p.cache_write + r.cache_read * p.cache_read) / 1e6;
  }
  return t;
}

function regressions(root, id, t, gateRuns) {
  if (!t.done) return { gates: 0, reverts: 0, lessons: 0 };
  const files = new Set(t.files || []);
  const gates = gateRuns.filter((g) => g.ok === false && Date.parse(g.ts) > Date.parse(t.done) && (g.paths || []).some((p) => files.has(p))).length;
  const log = git(root, ['log', `--since=${t.done}`, '-i', '--grep=revert', '--format=%s%n%b%x1e']).stdout || '';
  const reverts = log.split('\x1e').filter((c) => new RegExp(`\\b${id}\\b`).test(c)).length;
  let lessons = 0;
  try { lessons = fs.readFileSync(path.join(root, 'docs', 'process', 'lessons.md'), 'utf8').split(/\n(?=## )/).filter((b) => b.startsWith('## ') && b.includes(id)).length; } catch { /* none */ }
  return { gates, reverts, lessons };
}

export function collect(root, sinceMs, now = Date.now()) {
  const table = prices();
  const tasks = readTasks(root).tasks || {};
  const gateRuns = readGateRuns(root);
  const usage = usageRows(transcriptsDir(root), sinceMs);
  const rows = [];
  let catches = 0;
  for (const [id, t] of Object.entries(tasks)) {
    const start = Date.parse(t.start), end = t.done ? Date.parse(t.done) : now;
    if (end < sinceMs) continue;
    const rv = reviews(root, id, t);
    const fails = rv.reduce((n, r) => n + Object.values(r.acs).filter((a) => !a.pass).length, 0);
    const revise = rv.filter((r) => r.verdict === 'REVISE').length;
    const fixed = new Set();
    rv.forEach((r, i) => { for (const [ac, a] of Object.entries(r.acs)) if (!a.pass && rv.slice(i + 1).some((l) => l.acs[ac]?.pass)) fixed.add(ac); });
    catches += fixed.size;
    rows.push({ id, title: readTask(root, id)?.title || '', risk: t.last_check?.effective || readTask(root, id)?.risk || '?', open: !t.done,
      override: !!t.override, hours: t.done ? Math.round((end - start) / 36e5 * 10) / 10 : null,
      tokens: sum(usage.filter((u) => u.ts >= start && u.ts <= end), table), rounds: new Set(rv.map((r) => r.round)).size,
      fails, revise, reopened: t.reopened || 0, caught: fixed.size, regressions: regressions(root, id, t, gateRuns) });
  }
  // A retried command denied again for the same reason in the same session counts once.
  const seen = new Set();
  const once = (r) => { if (r.decision !== 'deny' || !r.session) return true; const k = `${r.guard}|${r.reason}|${r.session}`; if (seen.has(k)) return false; seen.add(k); return true; };
  const log = readLog(root).filter((r) => Date.parse(r.ts) >= sinceMs).filter(once);
  const by = (pred) => { const o = {}; for (const r of log.filter(pred)) o[r.guard] = (o[r.guard] || 0) + 1; return o; };
  const governance = { blocks: by((r) => r.decision === 'deny'), asks: by((r) => r.decision === 'ask'),
    overrides: by((r) => r.decision === 'override-set' && r.guard !== 'task-check'),
    task_overrides: log.filter((r) => r.decision === 'override-set' && r.guard === 'task-check').length,
    tamper: log.filter((r) => r.decision === 'tamper').length, review_catches: catches };
  const n = (o) => Object.values(o).reduce((a, b) => a + b, 0);
  // Closing a task on an override is the founder's call on a task, not a guard firing wrongly: counted apart.
  governance.false_alarms = n(governance.overrides);
  governance.catches = catches + governance.tamper + Math.max(0, n(governance.blocks) - governance.false_alarms);
  return { since: new Date(sinceMs).toISOString(), prices_as_of: table.as_of, tasks: rows,
    total: sum(usage.filter((u) => u.ts >= sinceMs), table), governance, transcripts: usage.length > 0 };
}

const k = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(n));
const usd = (t) => `$${t.usd.toFixed(2)}${t.unpriced ? '+' : ''}`;
const toks = (t) => `${k(t.input + t.cache_write + t.cache_read)} in / ${k(t.output)} out`;
const list = (o) => Object.entries(o).map(([g, c]) => `${g} ${c}`).join(', ') || 'none';

export function render(m, days) {
  const closed = m.tasks.filter((t) => !t.open);
  const hours = closed.map((t) => t.hours).sort((a, b) => a - b);
  const g = m.governance;
  const out = [`# Process metrics (last ${days} days)`, '',
    `Tokens and cost are estimates from this project's Claude Code transcripts on this machine (prices as of ${m.prices_as_of}; tasks that overlap in time share tokens).${m.transcripts ? '' : ' No transcripts were found, so tokens show 0.'}`, '',
    `- Tasks: ${closed.length} closed, ${m.tasks.length - closed.length} open${hours.length ? `; median time to done ${hours[Math.floor(hours.length / 2)]} h` : ''}.`,
    `- Rework: ${m.tasks.reduce((a, t) => a + t.fails, 0)} criteria failed review, ${m.tasks.reduce((a, t) => a + t.revise, 0)} REVISE verdicts, ${m.tasks.reduce((a, t) => a + t.reopened, 0)} tasks reopened.`,
    `- Regressions after done: ${m.tasks.reduce((a, t) => a + t.regressions.gates, 0)} failed gate runs on the same files, ${m.tasks.reduce((a, t) => a + t.regressions.reverts, 0)} reverts naming a task, ${m.tasks.reduce((a, t) => a + t.regressions.lessons, 0)} lessons naming a task.`,
    `- Guards: blocked ${list(g.blocks)}; asked you ${list(g.asks)}; ${g.tamper} gate-file changes caught. You typed ${g.false_alarms} overrides (${list(g.overrides)}): treat each as a likely false alarm. Tasks you closed with an override: ${g.task_overrides}.`,
    `- Catches vs false alarms: ${g.catches} vs ${g.false_alarms} (review failures fixed later: ${g.review_catches}).`,
    `- Total for the period: ${toks(m.total)}, about ${usd(m.total)}.`, ''];
  if (m.tasks.length) {
    out.push('| Task | Risk | Status | Time to done | Tokens | Est. cost | Review rounds | Failed criteria | Reopened | Regressions |', '|---|---|---|---|---|---|---|---|---|---|');
    for (const t of m.tasks) {
      const r = t.regressions;
      out.push(`| ${t.id} ${t.title.replace(/\|/g, '/')} | ${t.risk} | ${t.open ? 'open' : t.override ? 'closed (override)' : 'closed'} | ${t.hours == null ? '-' : `${t.hours} h`} | ${toks(t.tokens)} | ${usd(t.tokens)} | ${t.rounds} | ${t.fails} | ${t.reopened} | ${r.gates + r.reverts + r.lessons} |`);
    }
    out.push('');
  }
  return out.join('\n');
}

export default async function metrics(args) {
  const { flags } = parseArgs(args);
  const root = needRoot();
  const m = /^(\d+)d$/.exec(String(flags.since || '30d'));
  if (!m) {
    const usage = 'usage: fk metrics [--since <days>d] [--json] [--write]';
    say(flags.json ? JSON.stringify({ error: `invalid --since ${flags.since}: expected <days>d, e.g. 30d`, usage }) : usage);
    process.exitCode = 1; return;
  }
  const days = Number(m[1]);
  const data = collect(root, Date.now() - days * DAY);
  const text = render(data, days);
  if (flags.json) say(JSON.stringify(data, null, 2)); else say(text);
  if (flags.write) {
    const file = path.join(root, 'docs', 'process', 'metrics.md');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
    if (!flags.json) say('fk metrics: saved docs/process/metrics.md');
  }
  const notes = readJson(notesFile(), {});
  writeJson(notesFile(), { ...notes, [notesKey(root)]: { ...(notes[notesKey(root)] || {}), summary: Date.now() } });
}
