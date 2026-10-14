# Azure budget for {{PROJECT}} (${{USD}}/month)

Pay-as-you-go Azure has no hard cap; budgets alert. Free and credit-based subscriptions have a spending limit: keep it on.

You run it; the kit never does.

- Deploy: `az deployment sub create --location <region> --template-file budget.bicep --parameters alertEmail=<you> startDate=<YYYY-MM-01>`.
- Optional stop: create an action group that runs an automation (for example a runbook that deallocates VMs) and pass `actionGroupId=<id>`. Test it once by lowering the amount.

Then record it: type `fk-approve budget azure {{USD}}` as your whole message. Check it with `fk budget check`.
