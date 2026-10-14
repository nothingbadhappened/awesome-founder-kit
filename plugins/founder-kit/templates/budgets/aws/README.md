# AWS budget for {{PROJECT}} (${{USD}}/month)

AWS has no hard cap on a paid account. This sets an alert budget plus a Budget Action that attaches a deny policy (no new compute, NAT gateways, IPs, databases or model calls) when actual spend reaches 100%. Resources already running keep billing until you stop them.

Pick one way to apply it. You run it; the kit never does.

- **Terraform:** replace `REPLACE_WITH_ALERT_EMAIL` and `REPLACE_WITH_DEPLOY_ROLE` in `budget.tf`, then `terraform init && terraform apply`.
- **CLI (alerts only):** replace the email in `notifications.json`, then
  `aws budgets create-budget --account-id <your account id> --budget file://budget.json --notifications-with-subscribers file://notifications.json`.
  Add the Budget Action in the console: Budgets > {{PROJECT}}-monthly > Actions > attach `deny-policy.json` at 100%.

Test once: set `approval_model = "MANUAL"`, confirm the action shows as pending when triggered, then switch to `"AUTOMATIC"`.

Then record it: type `fk-approve budget aws {{USD}}` as your whole message. Check it with `fk budget check`.
