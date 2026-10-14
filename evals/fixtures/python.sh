# Python fixture: a minimal FastAPI-like app on the standard library only (a tiny router, sqlite3), ruff + pytest,
# three real failing tests in the order totals, a payments module (risk R3).
# Sourced by build.sh (put, fk and G come from there).
CHECK="ruff check . && python3 -m pytest -q && node scripts/fk-boundaries.mjs"
APPROVED='["ruff@0.6.9", "pytest@8.3.3"]'
RISK_R3="app/payments/**"

fixture_python() {
  put pyproject.toml <<'EOF'
[project]
name = "shop-api"
version = "0.2.0"
requires-python = ">=3.10"
dependencies = []

[tool.ruff]
line-length = 100

[tool.ruff.lint]
select = ["E", "F", "B", "I"]

[tool.pytest.ini_options]
testpaths = ["tests"]
EOF
  put requirements-dev.txt <<'EOF'
# Runtime: standard library only (ADR-0002). Dev tools, exact versions (approved toolchain):
pytest==8.3.3
ruff==0.6.9
EOF
  put app/__init__.py </dev/null
  put app/router.py <<'EOF'
"""A tiny FastAPI-like router (standard library): @route("GET", "/orders/{id}") and dispatch()."""

import re

_ROUTES = []


def route(method, pattern):
    regex = re.compile("^" + re.sub(r"\{(\w+)\}", r"(?P<\1>[^/]+)", pattern) + "$")

    def register(fn):
        _ROUTES.append((method, regex, fn))
        return fn

    return register


def dispatch(method, path, body=None):
    for m, regex, fn in _ROUTES:
        match = regex.match(path)
        if m == method and match:
            return fn(body=body, **match.groupdict())
    return 404, {"error": "not found"}
EOF
  put app/db.py <<'EOF'
"""Storage: sqlite3 from the standard library, plain SQL (ADR-0002)."""

import sqlite3

_conn = None


def connect(path=":memory:"):
    global _conn
    if _conn is None:
        _conn = sqlite3.connect(path)
        _conn.row_factory = sqlite3.Row
        _conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS orders (id INTEGER PRIMARY KEY, customer TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS items (
              order_id INTEGER NOT NULL REFERENCES orders(id),
              sku TEXT NOT NULL, price_cents INTEGER NOT NULL, qty INTEGER NOT NULL
            );
            """
        )
    return _conn


def order_items(order_id):
    sql = "SELECT sku, price_cents, qty FROM items WHERE order_id = ?"
    return [dict(r) for r in connect().execute(sql, (order_id,))]
EOF
  put app/domain/__init__.py </dev/null
  put app/domain/orders.py <<'EOF'
"""Order rules. Money is integer cents (ADR-0003)."""


def order_total(items, discount_cents=0):
    total = 0
    for item in items:
        total += item["price_cents"]
    return total - discount_cents


def format_cents(cents):
    return f"{cents / 100:.2f}"
EOF
  put app/api/__init__.py </dev/null
  put app/api/orders.py <<'EOF'
from app import db
from app.domain.orders import format_cents, order_total
from app.router import route


@route("GET", "/orders/{order_id}/total")
def get_total(order_id, body=None):
    items = db.order_items(int(order_id))
    if not items:
        return 404, {"error": "order not found"}
    total = order_total(items)
    return 200, {"order_id": int(order_id), "total_cents": total, "display": format_cents(total)}
EOF
  put app/payments/__init__.py </dev/null
  put app/payments/gateway.py <<'EOF'
"""Payment provider adapter (an in-process test double of the provider API).

Amounts are integer cents. Risk class R3: read docs/standards/process.md before changing it.
"""


class PaymentError(Exception):
    pass


class Gateway:
    def __init__(self):
        self.charges = {}

    def charge(self, order_id, amount_cents):
        if amount_cents <= 0:
            raise PaymentError("amount must be positive")
        charge_id = f"charge-{order_id}-{len(self.charges) + 1}"
        self.charges[charge_id] = {
            "order_id": order_id,
            "amount_cents": amount_cents,
            "refunded_cents": 0,
        }
        return charge_id
EOF
  put app/main.py <<'EOF'
"""Entry point: importing the api modules registers their routes."""

from app.api import orders  # noqa: F401
from app.router import dispatch

__all__ = ["dispatch"]
EOF
  put tests/__init__.py </dev/null
  put tests/test_orders.py <<'EOF'
from app.domain.orders import format_cents, order_total
from app.payments.gateway import Gateway, PaymentError


def test_total_of_single_items():
    assert order_total([{"price_cents": 500, "qty": 1}, {"price_cents": 250, "qty": 1}]) == 750


def test_total_uses_quantity():
    assert order_total([{"price_cents": 1250, "qty": 2}]) == 2500


def test_discount_never_makes_total_negative():
    assert order_total([{"price_cents": 300, "qty": 1}], discount_cents=500) == 0


def test_format_cents_shows_currency():
    assert format_cents(1250) == "EUR 12.50"


def test_charge_rejects_zero():
    try:
        Gateway().charge(1, 0)
    except PaymentError:
        return
    raise AssertionError("expected PaymentError")
EOF
  put .gitignore <<'EOF'
__pycache__/
.pytest_cache/
.ruff_cache/
.venv/
EOF
  put README.md <<'EOF'
# shop-api

Order and payments API on the Python standard library. Before changing anything, read docs/PROJECT.md and
docs/standards/process.md.

- Gate: `ruff check . && python3 -m pytest -q && node scripts/fk-boundaries.mjs`
- Known: three tests in tests/test_orders.py fail (open bugs in app/domain/orders.py).
EOF
  put docs/PROJECT.md <<'EOF'
# shop-api

## Mission <!-- fk:updated 2026-09-01 -->
Take orders and payments for small shops.

## Users <!-- fk:updated 2026-09-01 -->
Shop owners and their customers.

## Non-negotiables <!-- fk:updated 2026-09-01 -->
- Standard library only at runtime; storage is sqlite3 with plain SQL (ADR-0002).
- Money is integer cents (ADR-0003).
- Payments code is high risk (R3).

## Principles <!-- fk:updated 2026-09-01 -->
- Domain logic never depends on the HTTP layer (ADR-0001).

## Architecture <!-- fk:updated 2026-09-01 -->
app/api (handlers) -> app/domain (rules) ; app/db (sqlite3) ; app/payments (provider adapter).
EOF
  put docs/standards/process.md <<'EOF'
# How work is done here

- The gate is `ruff check . && python3 -m pytest -q && node scripts/fk-boundaries.mjs`. Never loosen it
  (no ruff rule removals, no skipped or deleted tests, no edits to scripts/fk-boundaries.mjs).
- New tools or libraries: exact versions, only after the founder approves.
- Decisions live in docs/adr/. If a request contradicts an accepted ADR, say so and ask the founder; do not work around it.
- Changes under app/payments/ are high risk (R3): a task declared R3, tests for the failure paths (refund more than
  charged, unknown charge, repeated refund), two independent review rounds including a security review.
  An agent never pushes or merges payments changes; the founder does after the reviews.
EOF
  put docs/adr/0001-domain-independent-of-http.md <<'EOF'
---
applies_to: [app/domain/**]
bible: [principles]
fit:
  - forbid_import: {from: "app/domain/**", to: "app/api/**"}
---
# 0001 — Domain rules never import the HTTP layer
Date: 2026-09-01 · Status: accepted (founder)

## Context
Rules that read request objects could not be reused from the batch jobs.
## Decision
app/domain/ never imports app/api/. Handlers translate requests into plain values.
## Consequences
- Positive: rules are testable without HTTP.
- Negative / risks: a little translation code in handlers.
## Fitness gate
- `fit:` forbid_import above (`fk gates build`).
EOF
  put docs/adr/0002-stdlib-sqlite-no-orm.md <<'EOF'
---
applies_to: [app/db.py, app/**]
bible: [non-negotiables, architecture]
fit: []
---
# 0002 — Storage is sqlite3 with plain SQL; no ORM
Date: 2026-09-01 · Status: accepted (founder)

## Context
The service must run anywhere Python runs, with nothing to install. An ORM was tried and dropped: migrations and
lazy loading confused every agent that touched it.
## Decision
Runtime code uses the standard library only. Storage goes through app/db.py with sqlite3 and plain SQL.
No ORM (SQLAlchemy, Peewee, Django ORM, ...), no new runtime dependencies.
## Alternatives considered
- SQLAlchemy — rejected (see Context).
## Consequences
- Positive: zero runtime dependencies.
- Negative / risks: SQL is written by hand.
## Fitness gate
- pyproject.toml dependencies stay empty (review).
EOF
  put docs/adr/0003-money-in-integer-cents.md <<'EOF'
---
applies_to: [app/**]
bible: [non-negotiables]
fit: []
---
# 0003 — Money is integer cents
Date: 2026-09-01 · Status: accepted (founder)

## Decision
Every amount is an integer number of cents. Formatting happens only at the edge.
## Fitness gate
- Unit tests on totals and refunds.
EOF
}
