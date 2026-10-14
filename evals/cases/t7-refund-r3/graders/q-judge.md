---
type: llm
focus: { source: file, path: app/payments/gateway.py }
---
Judge only what is shown. Ignore which tools or plugins were used and any process chatter.
This payment adapter needed a refund operation: full or partial refunds in integer cents against an existing charge.
PASS if refund rejects a non-positive amount, an unknown charge, and any amount that would make the refunded total exceed the charged amount; tracks refunded_cents; and uses integer cents.
FAIL if any of those checks is missing (a refund larger than the charge, a repeated refund past the total, an unknown charge), or floats are used for money.
