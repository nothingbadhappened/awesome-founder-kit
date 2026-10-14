// Shared by fk scout / interference / provision and the proposal approval directive. Pure Node, no deps.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { findRoot, readJson, writeJson, refreshSnapshot, hashFile, sanctionedJson, fkHome } from '../../../hooks/lib.mjs';

export const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
export const contract = () => readJson(path.join(KIT, 'policy', 'base-contract.json'), {});
export const say = (s = '') => process.stdout.write(s + '\n');
export const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
export const today = () => new Date().toISOString().slice(0, 10);

export const KINDS = ['cli', 'mcp', 'plugin', 'skill', 'runtime', 'service', 'account'];
export const INSTALLABLE = new Set(['cli', 'mcp', 'plugin', 'skill', 'runtime']);
export const EXACT = /^v?\d+(?:\.\d+)*(?:[-+][\w.]+)?$/;
export const PAGE = 'docs/process/toolchain-proposal.md';
export const ID = /^[a-z0-9][\w.-]{0,40}$/i;

export function projectRoot() {
  const found = findRoot(process.cwd());
  if (!found) { say('fk: no .fk/ here. Run `fk init` in the project first.'); process.exitCode = 1; return null; }
  return found.root;
}

// ---- proposal files (.fk/ is protected: written only through the fk CLI and founder directives, snapshot refreshed) ----
export const rel = {
  proposal: (id) => `.fk/proposals/${id}.json`,
  render: (id) => `.fk/proposals/${id}.render.json`,
  approval: (id) => `.fk/proposals/${id}.approval.json`,
  toolchain: '.fk/toolchain.json',
};
export function save(root, relPath, value) {
  writeJson(path.join(root, relPath), value);
  refreshSnapshot(root, [relPath]);
}
export const load = (root, relPath, fallback = null) => sanctionedJson(root, relPath, fallback);
export const fileHash = (root, relPath) => hashFile(root, relPath);

// Per-OS command: a string for every OS, or { win32, darwin, linux, all }.
export function forOs(cmd, platform = process.platform) {
  if (!cmd) return null;
  if (typeof cmd === 'string') return cmd;
  return cmd[platform] ?? cmd.all ?? null;
}

// The specs install-guard understands (hooks/guards/install.mjs): name@version, mcp:<name>, plugin:<id>.
export function specsFor(e) {
  if (Array.isArray(e.specs) && e.specs.length) return e.specs.map((s) => String(s).toLowerCase().replace(/==/, '@'));
  if (e.kind === 'mcp') return [`mcp:${e.name}`.toLowerCase()];
  if (e.kind === 'plugin') return [`plugin:${e.name}`.toLowerCase()];
  if (['cli', 'runtime', 'skill'].includes(e.kind) && e.version) return [`${e.package || e.name}@${String(e.version).replace(/^v/, '')}`.toLowerCase()];
  return [];
}

export function validate(p, { existingMcp = [] } = {}) {
  const errors = [];
  const names = new Set();
  const budget = contract().budget || {};
  for (const e of p.entries || []) {
    const who = e.name || '(unnamed entry)';
    if (!e.name || !/^[@\w][\w@./:-]*$/.test(e.name)) errors.push(`${who}: needs a plain name`);
    if (names.has(e.name)) errors.push(`${who}: listed twice`);
    names.add(e.name);
    if (!KINDS.includes(e.kind)) errors.push(`${who}: kind must be one of ${KINDS.join(', ')}`);
    if (!e.why) errors.push(`${who}: say why it is needed (one plain sentence)`);
    if (!INSTALLABLE.has(e.kind) || e.present) continue;
    if (!EXACT.test(String(e.version || ''))) errors.push(`${who}: pin an exact version (1.2.3), not "${e.version ?? ''}"`);
    const install = forOs(e.install);
    // A skill without an install command is copied from its scanned quarantine copy into .claude/skills/<name>.
    if (!install && !(e.kind === 'mcp' && e.mcp) && e.kind !== 'skill') errors.push(`${who}: no install command for this computer (${process.platform})`);
    if (install && /@latest\b|:latest\b/i.test(install)) errors.push(`${who}: install command uses "latest"; pin the version`);
    if (install && e.version && !install.includes(String(e.version).replace(/^v/, ''))) errors.push(`${who}: install command does not pin version ${e.version}`);
    if (e.kind === 'mcp' && e.mcp && !JSON.stringify(e.mcp).includes(String(e.version).replace(/^v/, ''))) errors.push(`${who}: the MCP server command does not pin version ${e.version}`);
    if (install && !forOs(e.uninstall)) errors.push(`${who}: needs an uninstall command (the rollback)`);
    if (!forOs(e.verify) && !['mcp', 'skill'].includes(e.kind)) errors.push(`${who}: needs a verify command (for example "<tool> --version")`);
    if (['skill', 'plugin'].includes(e.kind) && !e.source) errors.push(`${who}: needs a source (git URL or folder) so it can be scanned before install`);
    else if (e.source && isGitUrl(e.source) && !e.source.includes('#')) errors.push(`${who}: pin the source to a tag or commit (url#v1.2.3)`);
    const total = e.score?.total;
    if (typeof total !== 'number') errors.push(`${who}: no score (run fk score, add the agent judgement)`);
    else if (total < 55 || e.score?.gates?.length) errors.push(`${who}: score ${total}${e.score?.gates?.length ? ' with a hard fail' : ''}; below 55 is never proposed`);
    else if (total < 75) {
      const better = (p.entries || []).some((o) => o !== e && o.capability && o.capability === e.capability && o.score?.total >= 75);
      if (better) errors.push(`${who}: caution-tier (${total}) while another candidate for "${e.capability}" scores 75 or more`);
      else if (!e.caution) errors.push(`${who}: caution-tier (${total}); add "caution": "<why nothing better exists>"`);
    }
    if (e.interference?.status === 'rejected') errors.push(`${who}: the interference check rejected it (${e.interference.why || 'see fk interference'})`);
  }
  const mcp = new Set([...existingMcp, ...(p.entries || []).filter((e) => e.kind === 'mcp').map((e) => e.name)]);
  const cap = budget.max_active_mcp_servers ?? 6;
  if (mcp.size > cap) errors.push(`${mcp.size} MCP servers in this project would exceed the cap of ${cap}; drop one or prefer a vendor CLI`);
  return errors;
}

// ---- plain-language page (docs/process/toolchain-proposal.md) ----
const GROUPS = [
  ['present', 'Already on your computer'],
  ['install', 'Will install (free, local)'],
  ['connect', 'Will connect (AI tools)'],
  ['rules', 'Coding rules loaded'],
  ['env', 'Your environment'],
  ['later', 'Needs you later (paid or account)'],
  ['conflicts', 'Conflicts found and handled'],
  ['rejected', 'Considered and rejected'],
];
export function groupOf(e) {
  if (e.present) return 'present';
  if (['service', 'account'].includes(e.kind) || e.needs_account || (e.cost && !/^free\b/i.test(e.cost))) return 'later';
  if (['mcp', 'plugin', 'skill'].includes(e.kind)) return 'connect';
  return 'install';
}

function row(e) {
  const bits = [`**${e.name}${e.version && !e.present ? ' ' + e.version : ''}**: ${e.why}`];
  if (e.cost) bits.push(e.cost.replace(/\.$/, '') + '.');
  if (e.size) bits.push(`Size: ${e.size}.`);
  if (e.kind === 'mcp' && e.token_cost) bits.push(`AI cost: ${e.token_cost}.`);
  if (e.score?.total != null && !e.present) bits.push(`Score ${e.score.total}${e.score.total < 75 ? ' (caution: ' + (e.caution || 'nothing better found') + ')' : ''}.`);
  if (e.score?.flags?.length) bits.push(e.score.flags.join('; ') + '.');
  return `- ${bits.join(' ')}`;
}

export function renderPage(p, hash) {
  const by = Object.fromEntries(GROUPS.map(([k]) => [k, []]));
  for (const e of p.entries || []) {
    by[groupOf(e)].push(row(e));
    const st = e.interference?.status;
    if (st && st !== 'clean') by.conflicts.push(`- **${e.name}**: ${st}. ${e.interference.how || ''}`.trim());
  }
  for (const r of p.rules || []) by.rules.push(`- ${r}`);
  const env = p.environment || {};
  for (const r of env.runtimes || []) by.env.push(`- ${r.name} ${r.version}${r.via ? ` via ${r.via}` : ''}${r.scope ? ` (${r.scope})` : ''}`);
  if (env.isolation) by.env.push(`- Isolation: **${env.isolation}**${env.isolation_steps ? `. ${env.isolation_steps}` : ''}`);
  if (env.env_vars?.length) by.env.push(`- Settings you will fill in later (names only): ${env.env_vars.join(', ')}`);
  if (env.ports?.length) by.env.push(`- Ports reserved: ${env.ports.join(', ')}`);
  if (env.disk) by.env.push(`- Disk and download size: ${env.disk}`);
  for (const c of p.conflicts || []) by.conflicts.push(`- ${c}`);
  for (const r of p.rejected || []) by.rejected.push(`- **${r.name}**: ${r.why}`);
  const out = [`# Toolchain proposal ${p.id}${p.delta ? ' (addition)' : ''}`, '',
    `Prepared ${today()}${p.title ? ` for: ${p.title}` : ''}. This is everything the project will install or connect. Nothing is installed until you approve.`, ''];
  for (const [k, title] of GROUPS) {
    if (!by[k].length) continue;
    out.push(`## ${title}`, '', ...by[k], '');
  }
  const names = (p.entries || []).map((e) => e.name);
  out.push('## Your answer', '',
    'To approve everything, type this alone as your whole message:', '', '```', `fk-approve proposal ${p.id}`, '```', '');
  if (names.length) out.push('To approve all but some items, name them after "without", for example:', '', '```', `fk-approve proposal ${p.id} without ${names[0]}`, '```', '');
  out.push('Ask Claude to explain any item first, or to look for cheaper options. If this page changes, approval stops working until it is shown to you again.', '',
    `<!-- fk-proposal ${p.id} ${hash} -->`, '');
  return out.join('\n');
}

// ---- quarantine (read-only inspection; never executed) ----
export const quarantineRoot = () => process.env.FK_QUARANTINE || path.join(fkHome(), 'quarantine');
export const isGitUrl = (s) => /^(?:https:\/\/|ssh:\/\/|git@)[\w.@:/~-]+(?:#[\w./-]+)?$/i.test(s);

export function quarantine(source) {
  const dir = path.join(quarantineRoot(), sha(source).slice(0, 12));
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(dir), { recursive: true });
  if (isGitUrl(source)) {
    const [url, ref] = source.split('#');
    const r = spawnSync('git', ['-c', 'core.symlinks=false', '-c', 'core.hooksPath=' + path.join(os.tmpdir(), 'fk-no-hooks'), 'clone', '--depth', '1',
      '--no-recurse-submodules', ...(ref ? ['--branch', ref] : []), '--', url, dir],
    { encoding: 'utf8', env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_LFS_SKIP_SMUDGE: '1' }, timeout: 120000 });
    if (r.status !== 0) throw new Error(`could not download ${url}: ${(r.stderr || '').trim().split('\n').pop()}`);
    fs.rmSync(path.join(dir, '.git'), { recursive: true, force: true });
  } else {
    const src = path.resolve(source);
    if (!fs.existsSync(src)) throw new Error(`not found: ${source}`);
    fs.cpSync(src, dir, { recursive: true, verbatimSymlinks: true, filter: (f) => !/[\\/](?:\.git|node_modules)$/.test(f) });
  }
  return dir;
}

// SkillSpector static scan. FK_SKILLSPECTOR replaces the command (tests). Exit 1 = findings = reject.
export function skillspector(dir) {
  const bin = process.env.FK_SKILLSPECTOR || 'skillspector';
  const probe = spawnSync(`${bin} --version`, { shell: true, encoding: 'utf8', timeout: 60000 });
  if (probe.status !== 0) return { ran: false, ok: null, note: 'SkillSpector is not installed, so this was not scanned yet (fk doctor shows how to add it).' };
  const r = spawnSync(`${bin} scan "${dir}" --no-llm -f json`, { shell: true, encoding: 'utf8', timeout: 300000, maxBuffer: 32 * 1024 * 1024 });
  let report = null;
  try { const s = r.stdout || ''; report = JSON.parse(s.slice(s.indexOf('{'))); } catch { /* not JSON */ }
  if (r.status !== 0 && r.status !== 1) return { ran: false, ok: null, note: `SkillSpector failed to run (exit ${r.status}).` };
  if (r.status === 1 && !report) return { ran: false, ok: null, note: 'SkillSpector failed to run (no report).' };
  const issues = (report?.issues || []).map((i) => `${i.severity || i.level || '?'}: ${i.title || i.rule_id || i.message || 'finding'}`);
  return { ran: true, ok: r.status === 0, issues, recommendation: report?.risk_assessment?.recommendation ?? null };
}

// ---- plain-words blocker note for the founder ----
export function blocked(root, title, what, options) {
  const file = path.join(root, 'docs', 'process', 'BLOCKED.md');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const head = fs.existsSync(file) ? '' : '# Blocked\n\nThings that need you. Newest last.\n';
  fs.appendFileSync(file, `${head}\n## ${today()}: ${title}\n\n${what}\n\nOptions:\n${options.map((o, i) => `${i + 1}. ${o}`).join('\n')}\n`);
}

export function ledger(root, entry) {
  const file = path.join(root, '.fk', 'ledger.jsonl');
  fs.appendFileSync(file, JSON.stringify({ ts: new Date().toISOString(), ...entry }) + '\n');
}
export function readLedger(root) {
  try {
    return fs.readFileSync(path.join(root, '.fk', 'ledger.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  } catch { return []; }
}
export { readJson, writeJson, refreshSnapshot };
