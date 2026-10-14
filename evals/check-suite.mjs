#!/usr/bin/env node
// Free, offline structure check of an eval suite against the documented format (code.claude.com/docs/en/plugin-evals):
// prompt.md frontmatter keys, case.yaml keys, grader types and options, regexes that compile as JavaScript, the
// grader naming report.mjs relies on, and a scaffold script inside each case directory.
//   node evals/check-suite.mjs [eval dir]      (default: evals/cases)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.resolve(process.argv[2] || path.join(path.dirname(fileURLToPath(import.meta.url)), 'cases'));
const PROMPT_KEYS = new Set(['schema_version', 'name', 'description', 'tags', 'plugins', 'runs', 'expected_outcome', 'model',
  'max_turns', 'timeout_seconds', 'allowed_tools', 'append_system_prompt', 'env']);
const CASE_KEYS = new Set(['schema_version', 'name', 'description', 'tags', 'plugins', 'runs', 'expected_outcome', 'execution', 'context', 'graders']);
const CONTEXT_KEYS = new Set(['scaffold_script', 'history_file', 'add_dirs']);
const GRADER = {
  regex: ['pattern', 'flags', 'match', 'target'],
  tool_used: ['tool', 'input_match', 'min', 'max'],
  tool_order: ['before', 'after'],
  file_exists: ['path', 'exists'],
  llm: ['criteria', 'focus'],
  baseline: ['baseline_file', 'criteria'],
};
const COMMON = ['type', 'weight', 'arm'];
const TARGETS = /^(?:last_message|trace|files|mock_calls|\{\s*source:\s*file,\s*path:\s*[^}]+\})$/;
const PREFIX = /^(?:v-gate-|v-|a-|c-|fb-|q-)/;

const errors = [];
const err = (where, msg) => errors.push(`${path.relative(process.cwd(), where)}: ${msg}`);
// The small YAML subset these files use: top-level `key: value` lines (values kept as raw text).
function frontmatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  if (!m) return null;
  const keys = {};
  for (const line of m[1].split(/\r?\n/)) { const k = /^([A-Za-z_][\w]*):\s?(.*)$/.exec(line); if (k) keys[k[1]] = k[2]; }
  return { keys, body: m[2] };
}
const unquote = (v) => (/^'.*'$/.test(v) ? v.slice(1, -1).replace(/''/g, "'") : /^".*"$/.test(v) ? JSON.parse(v) : v);

let cases = 0, graders = 0;
const names = new Set();
for (const name of fs.existsSync(dir) ? fs.readdirSync(dir).sort() : []) {
  const cdir = path.join(dir, name);
  if (!fs.statSync(cdir).isDirectory() || name === 'results') continue;
  const pfile = path.join(cdir, 'prompt.md'), yfile = path.join(cdir, 'case.yaml');
  if (!fs.existsSync(pfile) && !fs.existsSync(yfile)) continue;
  cases++;
  if (fs.existsSync(pfile)) {
    const fm = frontmatter(fs.readFileSync(pfile, 'utf8'));
    if (!fm) { err(pfile, 'no frontmatter'); continue; }
    for (const k of Object.keys(fm.keys)) if (!PROMPT_KEYS.has(k)) err(pfile, `unknown frontmatter key "${k}" (an unknown key is an error)`);
    if (!fm.body.trim()) err(pfile, 'empty prompt body');
    const nm = fm.keys.name || name;
    if (names.has(nm)) err(pfile, `duplicate case name ${nm}`);
    names.add(nm);
    for (const [k, max] of [['max_turns', 200], ['timeout_seconds', 3600], ['runs', 50]]) {
      if (fm.keys[k] !== undefined && !(Number(fm.keys[k]) >= 1 && Number(fm.keys[k]) <= max)) err(pfile, `${k} must be 1..${max}`);
    }
    if (fm.keys.plugins) {
      for (const p of JSON.parse(fm.keys.plugins.replace(/'/g, '"'))) {
        const abs = path.resolve(cdir, p);
        if (!fs.existsSync(path.join(abs, '.claude-plugin', 'plugin.json')) && !fs.existsSync(path.join(abs, 'plugin.json'))) err(pfile, `plugins: ${p} has no plugin manifest`);
      }
    }
    if (fm.keys.env && !/^\{\s*\}$/.test(fm.keys.env)) for (const k of fm.keys.env.match(/[A-Z_][A-Z0-9_]*(?=\s*:)/g) || []) if (!/^EVAL_[A-Z0-9_]*$/.test(k)) err(pfile, `env key ${k} must match EVAL_[A-Z0-9_]*`);
  }
  if (fs.existsSync(yfile)) {
    const text = fs.readFileSync(yfile, 'utf8');
    let section = null;
    for (const line of text.split(/\r?\n/)) {
      const top = /^([A-Za-z_]\w*):/.exec(line);
      if (top) { section = top[1]; if (!CASE_KEYS.has(section)) err(yfile, `unknown key "${section}"`); continue; }
      const sub = /^\s+([A-Za-z_]\w*):\s*(.*)$/.exec(line);
      if (sub && section === 'context') {
        if (!CONTEXT_KEYS.has(sub[1])) err(yfile, `unknown context key "${sub[1]}"`);
        if (sub[1] === 'scaffold_script') {
          const s = path.resolve(cdir, sub[2].trim());
          if (!s.startsWith(cdir + path.sep)) err(yfile, 'scaffold_script must stay inside the case directory');
          else if (!fs.existsSync(s)) err(yfile, `scaffold_script ${sub[2]} does not exist`);
        }
      }
    }
    if (!/^schema_version:\s*"1\.1"\s*$/m.test(text)) err(yfile, 'needs schema_version: "1.1"');
    if (!/^name:\s*\S/m.test(text)) err(yfile, 'needs name');
  }
  const gdir = path.join(cdir, 'graders');
  const gfiles = fs.existsSync(gdir) ? fs.readdirSync(gdir).filter((f) => f.endsWith('.md')) : [];
  if (!gfiles.length) err(cdir, 'no graders (a case without one fails to load)');
  for (const g of gfiles) {
    graders++;
    const gfile = path.join(gdir, g);
    const fm = frontmatter(fs.readFileSync(gfile, 'utf8'));
    if (!fm) { err(gfile, 'no frontmatter'); continue; }
    const type = fm.keys.type;
    if (!GRADER[type]) { err(gfile, `unknown type "${type}"`); continue; }
    for (const k of Object.keys(fm.keys)) if (!COMMON.includes(k) && !GRADER[type].includes(k)) err(gfile, `key "${k}" is not an option of ${type}`);
    if (fm.keys.arm && !['with-only', 'both'].includes(fm.keys.arm)) err(gfile, 'arm must be with-only or both');
    if (!PREFIX.test(g)) err(gfile, 'name must start with v-, v-gate-, a-, c-, fb- or q- (report.mjs reads it)');
    if (g.startsWith('c-') && fm.keys.arm !== 'with-only') err(gfile, 'c-* graders are kit indicators: arm: with-only');
    for (const k of ['target', 'focus']) if (fm.keys[k] && !TARGETS.test(fm.keys[k])) err(gfile, `${k} "${fm.keys[k]}" is not last_message|trace|files|mock_calls|{ source: file, path: ... }`);
    for (const k of ['pattern', 'input_match']) {
      if (fm.keys[k] === undefined) continue;
      try { new RegExp(unquote(fm.keys[k]), type === 'regex' ? unquote(fm.keys.flags || '') : ''); } catch (e) { err(gfile, `${k} is not a JavaScript regex: ${e.message}`); }
      if (/\(\?[imsx]+\)/.test(fm.keys[k])) err(gfile, `${k}: inline flags are not supported; use flags:`);
    }
    if (type === 'regex' && fm.keys.match && !/^(?:contains|not_contains|count:\d+)$/.test(fm.keys.match)) err(gfile, 'match must be contains|not_contains|count:N');
    if (type === 'regex' && !fm.keys.pattern) err(gfile, 'regex needs pattern');
    if (type === 'tool_used' && !fm.keys.tool) err(gfile, 'tool_used needs tool');
    if (type === 'llm' && !fm.body.trim()) err(gfile, 'llm grader needs a rubric body');
    if (type !== 'llm' && fm.body.trim()) err(gfile, 'only llm graders take a body');
    if (/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(fs.readFileSync(gfile, 'utf8'))) err(gfile, 'contains control characters');
  }
}
if (!cases) errors.push(`${dir}: no cases found`);
for (const e of errors) console.log(`check-suite: ${e}`);
console.log(`check-suite: ${cases} case(s), ${graders} grader(s) in ${path.relative(process.cwd(), dir) || '.'}: ${errors.length ? `${errors.length} problem(s)` : 'OK'}`);
process.exit(errors.length ? 1 : 0);
