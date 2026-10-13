// C4: resource-creating cloud commands need a recorded budget, then the founder's yes.
import { sanctionedJson, segments, shellTool } from '../lib.mjs';

export const name = 'cloud-guard';

const RULES = [
  ['aws', /^aws\s+\S+\s+(?:create-\S+|run-instances)\b/i],
  ['gcp', /^gcloud\s+.*\b(?:create|deploy)\b/i],
  ['azure', /^az\s+.*\bcreate\b/i],
  ['vercel', /^(?:npx\s+)?vercel\b.*--prod\b/i],
  ['fly', /^(?:fly|flyctl)\s+(?:launch|deploy|machines?\s+run)\b/i],
  ['railway', /^railway\s+up\b/i],
  ['supabase', /^(?:npx\s+)?supabase\s+projects\s+create\b/i],
  ['cloudflare', /^(?:npx\s+)?wrangler\s+(?:deploy|publish)\b/i],
  ['netlify', /^(?:npx\s+)?netlify\s+deploy\b.*--prod\b/i],
  ['terraform', /^(?:terraform|tofu)\s+apply\b/i],
];
const ALIASES = { gcp: ['gcp', 'gcloud', 'google'], azure: ['azure', 'az'], fly: ['fly', 'flyio', 'fly.io'], cloudflare: ['cloudflare', 'wrangler'] };

export function check({ root, tool, ti }) {
  if (!shellTool(tool)) return null;
  const hit = segments(ti.command).map((s) => RULES.find(([, re]) => re.test(s))).find(Boolean);
  if (!hit) return null;
  const provider = hit[0];
  const b = sanctionedJson(root, '.fk/budgets.json', {});
  const providers = b.providers || {};
  const key = (ALIASES[provider] || [provider]).find((k) => providers[k]);
  if (!key) return { decision: 'deny', reason: `fk cloud-guard: this creates paid ${provider} resources and no budget is recorded for ${provider}. Ask the founder in plain words (AskUserQuestion) for a monthly limit. To record it, the founder types: fk-approve budget ${provider} <usd/month> [hard-cap]` };
  const p = providers[key];
  const budget = p.monthly_usd != null ? `$${p.monthly_usd}/month` : 'a recorded budget';
  return { decision: 'ask', reason: `fk cloud-guard: this creates or deploys paid ${provider} resources. The recorded budget is ${budget}${p.hard_cap ? ' with a hard cap' : ' (alert only, no hard cap)'}. Approve only if this fits that budget.` };
}
