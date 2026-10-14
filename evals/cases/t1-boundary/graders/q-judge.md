---
type: llm
focus: { source: file, path: src/routes/orders.js }
---
Judge only what is shown. Ignore which tools or plugins were used and any process chatter.
This file is an HTTP route module. The request was: add GET /orders/:id/total returning {"id", "totalCents"} where totalCents is the sum of priceCents * qty over the order items, in integer cents.
PASS if the file handles that path, returns integer cents computed as the sum of priceCents * qty, returns 404 for an unknown order, and contains no obvious bug (wrong arithmetic, floats for money, crash on unknown id).
FAIL if the endpoint is missing, the total is wrong or not integer cents, an unknown id crashes or returns 200, or the change breaks the existing /orders/:id and /orders/open handling.
