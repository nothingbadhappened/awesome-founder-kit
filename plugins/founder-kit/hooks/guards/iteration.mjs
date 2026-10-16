// C6: work the founder judges by taste (images, video, audio, copy, designs) has no gate to say "done", so an agent
// can regenerate and "improve" it forever. Producing calls (generate/render/export tools) need a confirmed brief once
// per session, then stop for a founder check-in every `limit` calls. The count resets whenever the founder speaks:
// a typed prompt or an answered AskUserQuestion. Code work is untouched: edits, tests and builds never count.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { activeOverride, globToRegex, loadConfig, sanctionedJson, segments, shellTool, stateDir } from '../lib.mjs';

export const name = 'iteration-guard';
export const DEFAULT_LIMIT = 3;

// The part of an MCP tool name after mcp__<server>__ that marks a call producing a new output...
const MCP_VERB = /(?:^|_)(?:generate|render|export|synthesi[sz]e|upscale|compose|imagine|variations?|propose_variants)(?:_|$)/i;
// ...unless it reads state or produces developer artifacts (status polls, type and migration generators, compose_up).
const NOT_MEDIA = /(?:^|_)(?:get|list|status|search|query|poll|check|delete|remove|cancel|jobs?|types?|typescript|migrations?|embeddings?|index|cache|locators?|logs?|csv|json|sql|schema|templates?|config|up|down|tests?|report|sitemap|code|uuid|ids?|client|sdk|api|data|markdown|docs?|readme|commit|diff|patch|page|token|password|hash|keys?)(?:_|$)/i;
const SHELL = [
  /^(?:npx\s+|bunx\s+)?remotion\s+render\b/i,
  /^manim\b/i,
  /^blender\b(?=.*\s(?:-b|--background)\b).*\s(?:-f|-a|--render-frame|--render-anim)\b/i,
];

// .fk/config.json `producers`: more tool-name globs (mcp__studio__*) or `cmd:<prefix>` for shell commands;
// `not_producers`: tool-name globs never counted (checked first).
function producing(root, tool, ti) {
  const isShell = shellTool(tool);
  const mcp = /^mcp__.+?__(.+)$/.exec(tool);
  const cfg = loadConfig(root);
  const strings = (v) => (Array.isArray(v) ? v.filter((p) => typeof p === 'string' && p.trim()) : []);
  const extra = strings(cfg.producers);
  if (!isShell && !mcp && !extra.length) return false;
  if (isShell) {
    const prefixes = extra.filter((p) => p.startsWith('cmd:')).map((p) => p.slice(4).trim().toLowerCase()).filter(Boolean);
    return segments(ti.command).some((s) => SHELL.some((re) => re.test(s))
      || prefixes.some((p) => { const l = s.toLowerCase(); return l === p || (l.startsWith(p) && /\s/.test(l[p.length])); }));
  }
  if (strings(cfg.not_producers).some((p) => globToRegex(p).test(tool))) return false;
  if (extra.some((p) => !p.startsWith('cmd:') && globToRegex(p).test(tool))) return true;
  return !!mcp && MCP_VERB.test(mcp[1]) && !NOT_MEDIA.test(mcp[1]);
}

// .fk/iteration.json is written only by the founder's typed `fk-approve rounds <n|off>` line (snapshot-checked).
export const limitOf = (root) => {
  const v = sanctionedJson(root, '.fk/iteration.json', {}).limit;
  return v === 0 ? 0 : Number.isInteger(v) && v > 0 ? v : DEFAULT_LIMIT;
};

// Per-session append-only event log (asked | brief | call | reset), one line per event, so parallel hook processes
// never tear or overwrite each other's state. Check-and-reserve runs under a short exclusive lock.
const KEEP_MS = 7 * 24 * 60 * 60 * 1000;
const sessionFile = (root, input) => path.join(stateDir(root), `iteration-${crypto.createHash('sha256').update(String(input.session_id || 'none')).digest('hex').slice(0, 16)}.log`);
const events = (file) => { try { return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean); } catch { return []; } };
const append = (file, ev) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.appendFileSync(file, ev + '\n'); };
function state(file) {
  const ev = events(file);
  const last = Math.max(ev.lastIndexOf('reset'), ev.lastIndexOf('brief'));
  return { asked: ev.includes('asked'), briefed: ev.includes('brief'), count: ev.slice(last + 1).filter((e) => e === 'call').length };
}
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
function locked(file, fn) {
  const lock = file + '.lock';
  fs.mkdirSync(path.dirname(file), { recursive: true });
  for (let i = 0; i < 100; i++) {
    try { fs.mkdirSync(lock); } catch {
      try { if (Date.now() - fs.statSync(lock).mtimeMs > 5000) fs.rmSync(lock, { recursive: true, force: true }); } catch { /* gone */ }
      sleep(10); continue;
    }
    try { return fn(); } finally { fs.rmSync(lock, { recursive: true, force: true }); }
  }
  throw new Error('iteration state busy');
}
function prune(root) {
  try {
    for (const n of fs.readdirSync(stateDir(root))) {
      const f = path.join(stateDir(root), n);
      if (/^iteration-[0-9a-f]+\.log$/.test(n) && Date.now() - fs.statSync(f).mtimeMs > KEEP_MS) fs.rmSync(f, { force: true });
    }
  } catch { /* best effort */ }
}

const BRIEF = 'Before the first one in this session, show the founder the cheapest preview this medium allows (an outline, storyboard, thumbnails, a short sample or a few options) and ask in one AskUserQuestion: is this the direction, what makes it done, and how many attempts before you check back. Fix the plan, not the final output. Use only the direction the founder gave: ideas from other chats or memory are options to offer, never to apply. If you are a subagent, stop and report this to the main agent.';

// PreToolUse. Iteration-guard runs last among the PreToolUse guards, so an allowed call reserves its slot here:
// a parallel batch of producing calls cannot all see the same count.
export function check({ root, input, tool, ti }) {
  if (!producing(root, tool, ti)) return null;
  const limit = limitOf(root);
  if (!limit) return null;
  const file = sessionFile(root, input);
  return locked(file, () => {
    const s = state(file);
    if (!s.briefed) {
      // Only a denial that stands asks for a brief; under a founder override nothing is recorded.
      if (!s.asked && !activeOverride(root, name, input.session_id)) { append(file, 'asked'); prune(root); }
      return { decision: 'deny', reason: `fk iteration-guard: this call produces work the founder judges by taste. ${BRIEF}` };
    }
    if (s.count >= limit) return { decision: 'deny', reason: `fk iteration-guard: ${s.count} producing calls (generate, render, export…) since the founder last spoke (limit ${limit}). Stop and show the founder what you have: each attempt, what changed, and what you would change next. Fix only what breaks the agreed brief; offer further polish as options. Ask (AskUserQuestion) whether to continue and for how many more attempts; the answer resets the count. The founder can change the limit by typing: fk-approve rounds <n|off>` };
    append(file, 'call');
    return null;
  });
}

// PostToolUse: an answered AskUserQuestion is a check-in. It confirms the brief only once the guard has asked for one,
// so an unrelated earlier question (a setup choice, an update prompt) does not count as agreeing a creative direction.
export function observe({ root, input, tool }) {
  if (tool !== 'AskUserQuestion') return;
  const file = sessionFile(root, input);
  locked(file, () => {
    const s = state(file);
    if (s.asked && !s.briefed) { append(file, 'brief'); prune(root); } else if (s.count) append(file, 'reset');
  });
}

// UserPromptSubmit: the founder typed something, so this is a check-in. The brief still needs its one question.
export function founderSpoke(root, input) {
  const file = sessionFile(root, input);
  if (!fs.existsSync(file)) return;
  locked(file, () => { if (state(file).count) append(file, 'reset'); });
}
