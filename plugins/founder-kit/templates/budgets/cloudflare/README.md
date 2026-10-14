# Cloudflare budget for {{PROJECT}} (${{USD}}/month)

The paid Workers plan has no automatic pause; overage bills. Two parts:

1. **Alert:** dashboard > Manage Account > Billing > Billable Usage > Budget alerts (or Notifications > Add > Budget Alert) at ${{USD}}, plus one at half of it.
2. **Kill switch:** `kill-switch.js` wraps your Worker so one command stops all traffic. Create the KV namespace, add the binding (see the file header), wrap your handler.
   Test once: put `KILL on` in a preview environment, confirm 503, delete it.

You run these; the kit never does. Then record it: type `fk-approve budget cloudflare {{USD}}` as your whole message.
