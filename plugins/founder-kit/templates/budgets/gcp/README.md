# Google Cloud budget for {{PROJECT}} (${{USD}}/month)

Google Cloud has no hard cap. This creates a budget that publishes to Pub/Sub, and a function that unlinks billing when actual cost reaches the budget. Unlinking billing stops every paid service in the project and can delete resources, so it starts in simulation (`dry_run = "true"`).

You run it; the kit never does.

1. Replace `REPLACE_WITH_PROJECT_ID` and `REPLACE_WITH_BILLING_ACCOUNT_ID` in `main.tf` (find the billing account with `gcloud billing accounts list`).
2. Enable the APIs: `gcloud services enable cloudbilling.googleapis.com billingbudgets.googleapis.com cloudfunctions.googleapis.com run.googleapis.com eventarc.googleapis.com pubsub.googleapis.com cloudbuild.googleapis.com`.
3. `terraform init && terraform apply`.
4. Simulate once: `gcloud pubsub topics publish {{PROJECT}}-fk-budget --message='{"costAmount": {{USD}}, "budgetAmount": {{USD}}}'`, then read the function log: it must say `DRY RUN would disable billing`.
5. Set `dry_run = "false"` and apply again.

Then record it: type `fk-approve budget gcp {{USD}}` as your whole message. Check it with `fk budget check`.
