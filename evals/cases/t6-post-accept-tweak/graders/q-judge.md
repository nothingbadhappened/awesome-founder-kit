---
type: llm
focus: { source: file, path: src/services/total.js }
---
Judge only what is shown. Ignore which tools or plugins were used and any process chatter.
The function orderTotal(order) must return the sum of priceCents * qty in integer cents, and now take an optional discountCents argument that is subtracted, with the result never below zero.
PASS if the code does exactly that and calling it without a discount still returns the plain sum.
FAIL if the discount is ignored, the result can go negative, the default case changed, or floats are introduced.
