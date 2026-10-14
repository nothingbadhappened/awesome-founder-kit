# Unlinks billing from the project when actual cost reaches the budget. DRY_RUN=true only logs.
import base64
import json
import os

import functions_framework
from googleapiclient import discovery

PROJECT_ID = os.environ.get("GCP_PROJECT_ID", "")
DRY_RUN = os.environ.get("DRY_RUN", "true").lower() != "false"


@functions_framework.cloud_event
def stop_billing(cloud_event):
    data = json.loads(base64.b64decode(cloud_event.data["message"]["data"]).decode("utf-8"))
    cost, budget = float(data.get("costAmount", 0)), float(data.get("budgetAmount", 0))
    if budget <= 0 or cost < budget:
        print(f"fk: cost {cost} below budget {budget}; nothing to do")
        return
    name = f"projects/{PROJECT_ID}"
    billing = discovery.build("cloudbilling", "v1", cache_discovery=False)
    info = billing.projects().getBillingInfo(name=name).execute()
    if not info.get("billingEnabled"):
        print("fk: billing already disabled")
        return
    if DRY_RUN:
        print(f"fk: DRY RUN would disable billing for {name} (cost {cost} >= budget {budget})")
        return
    billing.projects().updateBillingInfo(name=name, body={"billingAccountName": ""}).execute()
    print(f"fk: billing disabled for {name} (cost {cost} >= budget {budget})")
