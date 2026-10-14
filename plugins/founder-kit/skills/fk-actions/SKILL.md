---
name: fk-actions
description: "Use when something needs the founder (account, key, billing cap, deploy, gate relaxation): add it to the one batched checklist."
---

# Founder actions

One batched checklist in `docs/process/founder-actions.md`. Agents never do these items themselves (autonomy policy): accounts, payments, secrets, billing caps, production deploy or publish, relaxing a gate.

## Steps
1. Run `fk actions` (add `--provider <name>` for a provider the kit has not detected yet). It writes or refreshes the checklist and keeps earlier ticks and reasons.
2. Tell the founder in plain words, once, what is new on the list and where it is. Do not paste values; key names only.
3. After the founder says some are done, run `fk actions verify`. It ticks what the kit can confirm: `.env` has a value for a key name (the value is never read out), a budget is recorded and read back from the provider, no `ANTHROPIC_API_KEY` in the shell.
4. Report what is still open. Continue work that does not depend on open items.

## What goes on it
- Accounts to create, with sign-up links.
- Keys to put in `.env`, by name, from `.env.example`.
- Only for paid cloud or API services: billing caps per provider (from the catalog), with `fk budget plan <provider> <usd>` and the record line `fk-approve budget <provider> <usd> [hard-cap]`. Alert-only providers need a written reason.
- Claude billing: if `ANTHROPIC_API_KEY` is set, suggest a Console workspace with a monthly limit.
- Production deploys, store submissions, merges to main.
- Gate relaxations an agent asked for; the founder decides with `fk-override gate <reason>` or leaves it.

## Rules
- Never write a secret value into the checklist, chat, code or logs.
- Never tick an item for the founder that the kit cannot check; they tick it.
