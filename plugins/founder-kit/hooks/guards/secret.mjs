// C1: no secret-shaped strings in files or commands; no reading .env* (except examples).
import path from 'node:path';
import { shellTool, segments, tokens } from '../lib.mjs';

export const name = 'secret-guard';

const KEY_PATTERNS = [
  [/\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/, 'an AWS access key'],
  [/\bgh[pousr]_[A-Za-z0-9]{36,}\b/, 'a GitHub token'],
  [/\bgithub_pat_[A-Za-z0-9_]{60,}\b/, 'a GitHub token'],
  [/\bxox[abprs]-[A-Za-z0-9-]{10,}\b/, 'a Slack token'],
  [/\b[sr]k_live_[A-Za-z0-9]{20,}\b/, 'a Stripe live key'],
  [/\bAIza[0-9A-Za-z_-]{35}\b/, 'a Google API key'],
  [/\bsk-ant-[A-Za-z0-9_-]{20,}/, 'an Anthropic API key'],
  [/\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}/, 'an OpenAI-style API key'],
  [/-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----/, 'a private key'],
];
// Code: only a quoted literal counts (`password: user.password` is not a secret).
const ASSIGN = /\b([A-Za-z0-9_]*(?:_KEY|_SECRET|SECRET_KEY|TOKEN|PASSWORD|PASSWD|_PWD|APIKEY)|api[_-]?key|secret|password|token)\b["']?\s*[:=]\s*["']([^"'\s]{8,})["']/gi;
// Shell only: the unquoted `export NAME_KEY=value` form.
const SHELL_ASSIGN = /^\s*(?:export\s+|set\s+|\$env:)?([A-Z][A-Z0-9_]*(?:KEY|SECRET|TOKEN|PASSWORD))=(\S{8,})/m;
const PLACEHOLDER = /^(?:\$|<|\{|%|process\.env|os\.environ|env\(|getenv|your|redacted|\*{3})|test|fake|mock|sample|dummy|fixture|example|placeholder|changeme|correct-horse|xxx|<[^>]*>|\$\{/i;
// Local-dev passwords (docker-compose POSTGRES_PASSWORD: "postgres", MYSQL_ROOT_PASSWORD: "localdev1") are not secrets.
const DEV_PASSWORD = /^(?:postgres|mysql|mariadb|redis|root|admin|password|secret|guest|local\w*|dev\w*)$/i;
// Test code and fixtures hold made-up credentials by design: there only real key formats (KEY_PATTERNS) count.
const TEST_PATH = /(?:^|[\\/])(?:tests?|__tests__|spec|fixtures|testdata)[\\/]|\.(?:test|spec)\.[^\\/]+$/i;
const EXAMPLE_ENV = /^\.env\.(?:example|sample|template|dist|defaults)$/i;
const ENV_TOKEN = /(?:^|[\s"'`/\=<>(:])(\.env(?:\.[\w.*-]+)?)(?=$|[\s"'`;&|)<>*])/g;
// Commands that may name a .env file without printing it (git only for these subcommands).
const ENV_SAFE = /^(?:ls|dir|test|\[|stat|touch|rm|mv|test-path|remove-item)$/i;
const ENV_SAFE_GIT = new Set(['add', 'rm', 'mv', 'status', 'check-ignore']);

function entropy(s) {
  const f = {};
  for (const c of s) f[c] = (f[c] || 0) + 1;
  return Object.values(f).reduce((h, n) => h - (n / s.length) * Math.log2(n / s.length), 0);
}

const secretValue = (name, v) => !PLACEHOLDER.test(v) && !DEV_PASSWORD.test(v)
  && (/pass|pwd/i.test(name) ? entropy(v) >= 2.5 : v.length >= 12 && entropy(v) >= 3);

export function findSecret(text, shell = false, file = '') {
  if (!text) return null;
  for (const [re, what] of KEY_PATTERNS) if (re.test(text)) return what;
  if (file && TEST_PATH.test(String(file))) return null;
  for (const m of String(text).matchAll(ASSIGN)) if (secretValue(m[1], m[2])) return `a secret value assigned to ${m[1]}`;
  if (shell) {
    for (const seg of segments(text)) {
      const m = SHELL_ASSIGN.exec(seg);
      if (m && secretValue(m[1], m[2].replace(/^["']|["']$/g, ''))) return `a secret value assigned to ${m[1]}`;
    }
  }
  return null;
}

// True when a shell segment names a non-example .env file and its command is not a list/test/move.
function envInShell(cmd) {
  for (const seg of segments(cmd)) {
    if (![...seg.matchAll(ENV_TOKEN)].some((m) => !EXAMPLE_ENV.test(m[1]))) continue;
    const tok = tokens(seg);
    while (tok.length > 1 && /^\w+=/.test(tok[0])) tok.shift(); // VAR=x cmd
    const c = path.basename(String(tok[0] || '')).replace(/\.exe$/i, '');
    if (ENV_SAFE.test(c)) continue;
    // Writing the name (echo ".env" >> .gitignore) or loading the file into a process (--env-file, dotenv -e, source)
    // keeps the values out of the conversation; only commands that print, copy or redirect it are a leak.
    if (/^(?:echo|printf)$/i.test(c) && !/[(`]/.test(seg)) continue; // no $(...), `...`, or PowerShell (Get-Content ...)
    if (loadsEnv(c, tok, seg)) continue;
    // Listing names (find . -name ".env*") and writing .env (vercel env pull) is how env setup works.
    if (/^find$/i.test(c) && !/\s-(?:exec|execdir|ok|okdir|fprint\w*)\b/.test(seg) && !/\bxargs\b/.test(cmd)) continue;
    if (/^vercel$/i.test(/^(?:npx|bunx)$/i.test(c) ? tok[1] : c) && /\benv\s+pull\b/i.test(seg)) continue;
    if (exampleCopy(c, tok.slice(1))) continue; // cp .env.example .env
    if (/^git$/i.test(c) && ENV_SAFE_GIT.has(String(tok.slice(1).find((t) => !t.startsWith('-')) || '').toLowerCase())) continue;
    return true;
  }
  return false;
}

// A segment that only hands a .env file to a process: --env-file[=].env, dotenv -e .env, source .env, . .env.
const ENV_LEAK = />|<|\b(?:cat|type|grep|less|more|head|tail|cp|copy)\b/i;
// Every .env name in the segment must be such an argument (not one inside a script: node -e "...readFileSync('.env')").
function loadsEnv(c, tok, seg) {
  if (ENV_LEAK.test(seg)) return false;
  const named = [...seg.matchAll(ENV_TOKEN)].filter((m) => !EXAMPLE_ENV.test(m[1])).length;
  const loaded = tok.filter((t, i) => {
    const v = t.replace(/^--env-file=/i, '');
    return isEnvFile(v) && (v !== t || ['--env-file', '-e'].includes(tok[i - 1]) || (i === 1 && /^(?:source|\.)$/.test(c)));
  }).length;
  return loaded > 0 && loaded === named;
}

// Only `cp|copy|Copy-Item [-Path] <.env.example|.sample|.template> [-Destination] <.env*>`: no other flags, no extra tokens.
function exampleCopy(c, a) {
  if (!/^(?:cp|copy|copy-item)$/i.test(c)) return false;
  const ps = /^copy-item$/i.test(c);
  if (ps && /^-path$/i.test(a[0] || '')) a = a.slice(1);
  const [src = '-', ...rest] = a;
  if (ps && /^-destination$/i.test(rest[0] || '')) rest.shift();
  const base = (p) => path.basename(String(p || '').replace(/\\/g, '/'));
  return rest.length === 1 && !src.startsWith('-') && /^\.env\.(?:example|sample|template)$/i.test(base(src))
    && !rest[0].startsWith('-') && /^\.env(?:\.[\w.-]+)?$/i.test(base(rest[0]));
}

const isEnvFile = (p) => {
  const b = path.basename(String(p || '').replace(/\\/g, '/'));
  return /^\.env(\..+)?$/i.test(b) && !EXAMPLE_ENV.test(b);
};

export function check({ tool, ti }) {
  const deny = (r) => ({ decision: 'deny', reason: `fk secret-guard: ${r}` });
  if (tool === 'Read' || tool === 'Grep') {
    if (isEnvFile(ti.file_path || ti.path)) return deny('reading .env files is blocked; secrets stay out of the conversation. Use .env.example for names, or ask the founder for the value you need.');
    return null;
  }
  if (shellTool(tool)) {
    if (envInShell(ti.command)) return deny('commands that read or copy .env files are blocked; secrets stay out of the conversation. Use .env.example for names.');
  }
  const text = tool === 'Write' ? ti.content
    : tool === 'Edit' ? ti.new_string
    : tool === 'MultiEdit' ? (ti.edits || []).map((e) => e.new_string).join('\n')
    : tool === 'NotebookEdit' ? ti.new_source
    : shellTool(tool) ? ti.command
    : tool.startsWith('mcp__') ? JSON.stringify(ti) : null;
  const what = findSecret(text, shellTool(tool), ti.file_path || ti.notebook_path || '');
  return what ? deny(`this would put ${what} into a file or command. Read it from an environment variable instead and keep the value in .env (never committed).`) : null;
}
