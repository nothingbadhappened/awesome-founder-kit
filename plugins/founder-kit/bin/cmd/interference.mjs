// fk interference <plugin-or-skill-dir | git-url[#ref]> [...more] [--json]
// Copies each candidate into a quarantine folder (~/.fk/quarantine/<hash>/, never executed), inspects what it would add to
// Claude Code, compares it with policy/base-contract.json, runs a static SkillSpector scan, and returns per candidate:
// clean | adapted (how) | isolated (how) | rejected (why).
import fs from 'node:fs';
import path from 'node:path';
import { contract, quarantine, skillspector, say } from './scout/lib.mjs';

const TEXT = /\.(?:md|mdx|txt|json|jsonc|ya?ml|toml|js|mjs|cjs|ts|mts|py|sh|bash|ps1|psm1|cmd|bat|rb|go|rs)$/i;
const SKIP = new Set(['.git', 'node_modules', '.venv', 'venv', '__pycache__', 'dist', 'build', 'target']);
const ORCH = /\b(?:orchestrat\w*|autopilot|autonomous (?:loop|agent|mode)|task loop|swarm|multi-agent (?:workflow|team|orchestration)|plan[- ]execute[- ]review|workflow engine)\b/i;
const MEMORY = /\b(?:long[- ]term memory|memory (?:system|palace|bank|store|layer)|persistent memory|remembers? across sessions)\b/i;
const LEARN = /\b(?:continuous[- ]learning|self[- ]improv\w*|learns? from (?:your |past )?sessions|instincts?)\b/i;
const BROAD = /\b(?:always|whenever|any ?time|every (?:task|request|message|prompt|time|change)|all (?:tasks|requests|code changes))\b/i;
const WRITE_CODE = /(?:writeFile(?:Sync)?|appendFile(?:Sync)?|>>?|\btee\b|Set-Content|Add-Content|Out-File|copyFile(?:Sync)?|\bcp\b|Copy-Item|open\([^)\n]*['"][wa]['"])[^\n]{0,120}?(?:CLAUDE\.md|AGENTS\.md|settings(?:\.local)?\.json)/i;
const WRITE_TEXT = /\b(?:add|append|write|update|edit|modify|replace|insert|put)\b[^\n]{0,60}\b(?:to|into|in)\b[^\n]{0,30}(?:CLAUDE\.md|AGENTS\.md|settings(?:\.local)?\.json)/i;
const PERMS = /--dangerously-skip-permissions|bypassPermissions|dangerouslyDisableSandbox|full disk access/i;
const DAEMON = /\bnohup\b|systemctl\s+enable|launchctl\s+load|pm2\s+start|schtasks\s+\/create|--daemon\b/i;
const PORT = /(?:listen\(\s*|--port[ =]|\bPORT\s*[=:]\s*|localhost:)(\d{4,5})\b/g;
const TELEMETRY = /\b(?:posthog|segment\.io|mixpanel|amplitude|sentry\.io|telemetry)\b/i;

const lower = (a) => new Set((a || []).map((x) => String(x).toLowerCase()));

function frontmatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  const out = {};
  if (!m) return out;
  const lines = m[1].split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const kv = /^([\w-]+):\s*(.*)$/.exec(lines[i]);
    if (!kv) continue;
    let v = kv[2].trim();
    if (v === '>' || v === '|' || v === '>-' || v === '|-' || v === '') {
      const more = [];
      while (i + 1 < lines.length && /^\s+\S/.test(lines[i + 1])) more.push(lines[++i].trim());
      v = more.join(' ');
    }
    out[kv[1].toLowerCase()] = v.replace(/^["']|["']$/g, '');
  }
  return out;
}

function walk(dir) {
  const files = [];
  const go = (d, depth) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.isSymbolicLink()) continue;
      const abs = path.join(d, e.name);
      if (e.isDirectory()) { if (!SKIP.has(e.name) && depth < 8) go(abs, depth + 1); }
      else files.push(path.relative(dir, abs).split(path.sep).join('/'));
    }
  };
  go(dir, 0);
  return files;
}

const readText = (f) => { try { return fs.statSync(f).size <= 1024 * 1024 ? fs.readFileSync(f, 'utf8') : ''; } catch { return ''; } };
const readJsonFile = (f) => { try { return JSON.parse(readText(f)); } catch { return null; } };

// Static inventory of what the candidate would add. Pure: reads files only.
export function inventory(dir) {
  const inv = { skills: [], agents: [], commands: [], hooks: [], mcp: [], tools: [], writers: [], perms: [], daemons: [], ports: [],
    telemetry: [], plugins: [], bins: [], licence: null, docker: false, engines: {} };
  for (const f of walk(dir)) {
    const abs = path.join(dir, f);
    const base = path.posix.basename(f);
    const parts = f.split('/');
    if (/^(?:LICEN[CS]E|COPYING)(?:\.\w+)?$/i.test(base) && parts.length === 1) {
      const t = readText(abs);
      inv.licence = /GNU AFFERO/i.test(t) ? 'AGPL' : /GNU GENERAL PUBLIC/i.test(t) ? 'GPL' : /Business Source/i.test(t) ? 'BUSL'
        : /Server Side Public/i.test(t) ? 'SSPL' : /Apache License/i.test(t) ? 'Apache-2.0' : /MIT License|Permission is hereby granted/i.test(t) ? 'MIT' : 'other';
    }
    if (/^(?:Dockerfile|docker-compose\.ya?ml|compose\.ya?ml)$/i.test(base)) inv.docker = true;
    if (base === 'SKILL.md') {
      const fm = frontmatter(readText(abs));
      inv.skills.push({ name: fm.name || parts.at(-2) || 'skill', description: fm.description || '', dmi: fm['disable-model-invocation'] === 'true', file: f,
        triggers: fm.triggers || fm.keywords || '' });
    } else if (parts.includes('agents') && base.endsWith('.md')) {
      const fm = frontmatter(readText(abs));
      inv.agents.push({ name: fm.name || base.slice(0, -3), description: fm.description || '', file: f });
    } else if (parts.includes('commands') && base.endsWith('.md')) {
      inv.commands.push({ name: base.slice(0, -3), file: f });
    }
    if (base === 'hooks.json' || /(^|\/)\.claude\/settings(?:\.local)?\.json$/.test(f)) {
      const j = readJsonFile(abs);
      const events = Object.keys(j?.hooks || (base === 'hooks.json' ? j || {} : {})).filter((k) => /^[A-Z]\w+$/.test(k));
      for (const ev of events) inv.hooks.push({ event: ev, file: f });
    }
    if (base === 'plugin.json' || base === 'marketplace.json' || base === '.mcp.json' || base === 'server.json' || base === 'package.json') {
      const j = readJsonFile(abs) || {};
      if (base === 'plugin.json') {
        inv.plugins.push(j.name || parts[0]);
        if (j.hooks && typeof j.hooks === 'object') for (const ev of Object.keys(j.hooks)) inv.hooks.push({ event: ev, file: f });
      }
      if (base === 'marketplace.json') for (const p of j.plugins || []) inv.plugins.push(p.name);
      const servers = base === 'server.json' && j.name ? { [j.name]: j } : j.mcpServers || {};
      if (typeof servers === 'object') {
        for (const [name, s] of Object.entries(servers)) {
          inv.mcp.push({ name, file: f });
          for (const t of s?.tools || []) inv.tools.push({ server: name, name: t.name || t });
        }
      }
      if (base === 'package.json') {
        if (j.bin) inv.bins.push(...(typeof j.bin === 'string' ? [j.name] : Object.keys(j.bin)));
        if (j.engines?.node) inv.engines.node = j.engines.node;
      }
    }
    if (base === 'pyproject.toml') {
      const m = /requires-python\s*=\s*["']([^"']+)["']/.exec(readText(abs));
      if (m) inv.engines.python = m[1];
      if (/\[project\.scripts\]/.test(readText(abs))) inv.bins.push('python-scripts');
    }
    if (!TEXT.test(base)) continue;
    const text = readText(abs);
    const code = !/\.(?:md|mdx|txt)$/i.test(base);
    if ((code ? WRITE_CODE : WRITE_TEXT).test(text)) inv.writers.push(f);
    if (PERMS.test(text)) inv.perms.push(f);
    if (code && DAEMON.test(text)) inv.daemons.push(f);
    if (code) for (const m of text.matchAll(PORT)) inv.ports.push(Number(m[1]));
    if (code && TELEMETRY.test(text)) inv.telemetry.push(f);
  }
  inv.ports = [...new Set(inv.ports)];
  return inv;
}

const majorOf = (range) => { const m = /(\d+)/.exec(String(range || '')); return m ? Number(m[1]) : null; };

// Compares the inventory with the base contract. Returns findings and the parts that must be left out.
export function judge(inv, c = contract()) {
  const findings = [];
  const drop = new Set();
  const add = (check, severity, detail, fix) => findings.push({ check, severity, detail, fix });
  const skillNames = new Set([...lower(c.skills?.omc), ...lower(c.skills?.omc_retired), ...lower(c.skills?.kit), ...lower(c.skills?.builtin),
    ...lower(c.skills?.memory), ...lower(c.commands?.builtin)]);
  const agentNames = new Set([...lower(c.agents?.omc), ...lower(c.agents?.builtin)]);
  const keywords = [...(c.keyword_triggers?.omc || []), ...(c.keyword_triggers?.omc_phrases || [])];
  const prefix = c.skills?.kit_prefix || 'fk-';

  for (const a of inv.agents) {
    if (agentNames.has(a.name.toLowerCase())) {
      drop.add(`agent:${a.name}`);
      add('role overlap', 'adapt', `ships its own "${a.name}" agent, which the base setup (OMC) already provides`, `leave out agent ${a.name}`);
    } else if (ORCH.test(`${a.name} ${a.description}`) || MEMORY.test(a.description) || LEARN.test(a.description)) {
      drop.add(`agent:${a.name}`);
      add('role overlap', 'adapt', `agent "${a.name}" is a second orchestrator, memory or learning system`, `leave out agent ${a.name}`);
    }
  }
  for (const s of inv.skills) {
    const text = `${s.name} ${s.description}`;
    const role = ORCH.test(text) ? 'orchestrator' : MEMORY.test(text) ? 'memory system' : LEARN.test(text) ? 'learning loop' : null;
    if (role) { drop.add(`skill:${s.name}`); add('role overlap', 'adapt', `skill "${s.name}" is a second ${role}`, `leave out skill ${s.name}`); continue; }
    const n = s.name.toLowerCase();
    if (skillNames.has(n) || n.startsWith(prefix)) {
      add('name collision', 'adapt', `skill name "${s.name}" is already taken by the base setup or Claude Code`, `vendor it as fk-<area>-${s.name}`);
    }
    const hit = keywords.find((k) => new RegExp(`\\b${k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(`${s.description} ${s.triggers}`));
    if (!s.dmi && (BROAD.test(s.description) || hit)) {
      add('keyword hijack', 'adapt', `skill "${s.name}" would fire on everyday requests${hit ? ` ("${hit}" is an OMC trigger)` : ''}`, `rewrite its description or set disable-model-invocation: true`);
    }
  }
  for (const cmd of inv.commands) {
    if (skillNames.has(cmd.name.toLowerCase())) add('name collision', 'adapt', `command /${cmd.name} is already taken`, `rename it fk-<area>-${cmd.name} or leave it out`);
  }
  for (const s of inv.mcp) {
    if (lower(c.mcp?.servers).has(s.name.toLowerCase())) add('name collision', 'adapt', `MCP server name "${s.name}" is already used by the base setup`, `register it under another name`);
  }
  const baseTools = new Set(Object.values(c.mcp?.tools || {}).flat().map((t) => t.toLowerCase()));
  const clash = inv.tools.filter((t) => baseTools.has(String(t.name).toLowerCase()));
  if (clash.length) add('name collision', 'note', `MCP tools named like base tools: ${clash.map((t) => t.name).join(', ')}`, 'agents may confuse them; keep the server name distinct');
  if (inv.hooks.length) {
    drop.add('hooks');
    add('hook overlap', 'adapt', `registers hooks on ${[...new Set(inv.hooks.map((h) => h.event))].join(', ')}`, 'install without its hooks; port a valuable one into the kit dispatcher');
  }
  const code = inv.writers.filter((f) => !/.(?:md|mdx|txt)$/i.test(f));
  const text = inv.writers.filter((f) => !code.includes(f));
  for (const f of code) drop.add(`file:${f}`);
  if (code.length) add('instruction files', 'adapt', `code that writes CLAUDE.md, AGENTS.md or settings (${code.join(', ')})`, `never run or install those parts (${code.join(', ')})`);
  if (text.length) add('instruction files', 'adapt', `tells the agent to edit CLAUDE.md, AGENTS.md or settings (${text.join(', ')})`, `remove that instruction when vendoring (${text.join(', ')})`);
  if (inv.perms.length) add('permissions', 'isolate', `asks for bypass mode or broad access (${inv.perms.join(', ')})`, 'run it isolated (container or WSL), or reject');
  const nodeMajor = majorOf(inv.engines.node);
  const floor = majorOf(c.runtimes?.node);
  const upper = /<\s*(=?)\s*(\d+)/.exec(inv.engines.node || '');
  const capped = upper && (Number(upper[2]) < floor || (Number(upper[2]) === floor && !upper[1]));
  const pinnedOld = nodeMajor && !/[<>]/.test(inv.engines.node) && nodeMajor < floor;
  if (floor && (capped || pinnedOld)) {
    add('runtime', 'note', `wants Node ${inv.engines.node} while the base setup needs ${c.runtimes.node}+`, 'pin a per-project Node with mise; never downgrade globally');
  }
  if (inv.engines.python && /<\s*3\.(\d+)/.test(inv.engines.python) && Number(/<\s*3\.(\d+)/.exec(inv.engines.python)[1]) <= 11) {
    add('runtime', 'note', `wants Python ${inv.engines.python}`, 'use a project-local Python through uv');
  }
  if (inv.docker) add('runtime', 'note', 'needs Docker', 'isolation level: container; show the disk size in the proposal');
  if (inv.ports.length || inv.daemons.length) {
    add('ports and processes', 'note', `${inv.ports.length ? `uses ports ${inv.ports.join(', ')}` : ''}${inv.ports.length && inv.daemons.length ? '; ' : ''}${inv.daemons.length ? 'starts a background process' : ''}`,
      'assign ports in the environment plan and register the process in the ledger');
  }
  const kept = inv.skills.filter((s) => !drop.has(`skill:${s.name}`));
  const tokens = Math.round(kept.filter((s) => !s.dmi).reduce((n, s) => n + s.name.length + s.description.length, 0) / 4);
  const cap = c.budget?.mcp_tools_soft_cap ?? 30;
  if (tokens > (c.budget?.kit_always_on_tokens ?? 2500) / 4) add('token budget', 'adapt', `its skill descriptions cost about ${tokens} tokens on every turn`, 'load its reference skills on demand only (disable-model-invocation)');
  if (inv.tools.length > cap) add('token budget', 'note', `${inv.tools.length} MCP tools (over ${cap})`, 'keep MCP tool search deferred; prefer a vendor CLI if one exists');
  if (!inv.licence) add('data and licence', 'note', 'no licence file found', 'founder decision: without a licence it cannot be reused safely');
  else if (['AGPL', 'BUSL', 'SSPL'].includes(inv.licence)) add('data and licence', 'note', `licence ${inv.licence} may conflict with the project licence`, 'founder decision in the proposal');
  if (inv.telemetry.length) add('data and licence', 'note', `sends usage data to a third party (${inv.telemetry.join(', ')})`, 'founder decision; turn telemetry off if it allows');
  return { findings, drop };
}

export function verdict(inv, { findings, drop }, scan) {
  if (scan?.ran && !scan.ok) {
    return { status: 'rejected', why: `the security scan (SkillSpector) found problems: ${(scan.issues || []).slice(0, 5).join('; ') || 'see its report'}` };
  }
  const usable = inv.skills.filter((s) => !drop.has(`skill:${s.name}`)).length + inv.commands.length + inv.mcp.length + inv.bins.length;
  const claudeParts = inv.skills.length + inv.agents.length + inv.commands.length + inv.hooks.length + inv.mcp.length;
  if (claudeParts && !usable) return { status: 'rejected', why: 'everything it adds duplicates the base setup (orchestrator, agents, hooks or memory)' };
  const iso = findings.filter((f) => f.severity === 'isolate');
  if (iso.length) return { status: 'isolated', how: iso.map((f) => f.fix).join('; ') };
  const ad = findings.filter((f) => f.severity === 'adapt');
  if (ad.length) return { status: 'adapted', how: [...new Set(ad.map((f) => f.fix))].join('; ') };
  return { status: 'clean' };
}

export function check(source, { scan = true } = {}) {
  const dir = quarantine(source);
  const inv = inventory(dir);
  const j = judge(inv);
  const s = scan ? skillspector(dir) : { ran: false, ok: null, note: 'scan skipped' };
  return { source, quarantine: dir, ...verdict(inv, j, s), findings: j.findings, scan: s,
    parts: { skills: inv.skills.map((x) => x.name), agents: inv.agents.map((x) => x.name), commands: inv.commands.map((x) => x.name),
      hooks: [...new Set(inv.hooks.map((h) => h.event))], mcp: inv.mcp.map((x) => x.name) } };
}

export function plain(r) {
  const head = `${r.source}: ${r.status}${r.how ? ` (${r.how})` : ''}${r.why ? ` (${r.why})` : ''}.`;
  const lines = [head];
  for (const f of r.findings) lines.push(`  ${f.check}: ${f.detail}. ${f.severity === 'note' ? 'Note' : 'Handled'}: ${f.fix}.`);
  if (r.scan?.note) lines.push(`  ${r.scan.note}`);
  return lines.join('\n');
}

export default async function interference(args) {
  const sources = args.filter((a) => !a.startsWith('--'));
  if (!sources.length) { say('usage: fk interference <plugin-or-skill-folder | git-url[#ref]> [...] [--json] [--no-scan]'); process.exitCode = 1; return; }
  const results = [];
  for (const src of sources) {
    try { results.push(check(src, { scan: !args.includes('--no-scan') })); }
    catch (e) { results.push({ source: src, status: 'rejected', why: String(e.message || e), findings: [] }); }
  }
  if (!args.includes('--json')) for (const r of results) say(plain(r));
  say(JSON.stringify(results.length === 1 ? results[0] : results, null, 2));
  if (results.some((r) => r.status === 'rejected')) process.exitCode = 1;
}
