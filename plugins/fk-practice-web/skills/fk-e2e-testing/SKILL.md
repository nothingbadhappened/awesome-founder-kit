---
name: fk-e2e-testing
description: Use when writing or stabilizing Playwright end-to-end or API tests - layout, page objects, locators, config, flaky-test fixes, CI artifacts and critical-flow safety.
---

# End-to-end and API testing (Playwright)

E2E tests cover critical user journeys only; logic belongs in unit and component tests. The project's test plan wins.

## Layout

```
tests/e2e/<area>/<flow>.spec.ts     e.g. auth/login.spec.ts, checkout/pay.spec.ts
tests/e2e/api/<resource>.spec.ts    HTTP contract tests via the request fixture
tests/pages/<Page>.ts               page objects
tests/fixtures/                     auth state, seeded data helpers
playwright.config.ts
```

## Page objects

- One class per page/component area holding `Locator`s and intent-level methods (`goto()`, `search(q)`, `addToCart(id)`).
- Locators by role/label first (`page.getByRole('button', { name: 'Save' })`), `data-testid` when no accessible handle exists; never brittle CSS chains.
- Wait for meaning, not time: `await expect(locator).toBeVisible()`, `page.waitForResponse(r => r.url().includes('/api/search') && r.ok())`.

## Test structure

- `test.describe` per feature, `beforeEach` navigates through the page object.
- Each test independent: creates its own data (API or fixture), never depends on another test's leftovers or order.
- Log in once via a setup project and reuse `storageState`, instead of logging in through the UI in every test.
- Assert outcomes users care about (text, URL, visible state), plus "no results" and error paths.

## API tests

- Use the `request` fixture against the running app: status code, error envelope, auth (401/403), validation (400/422), pagination.
- Keep them next to E2E so one CI job proves the contract.

## Config essentials

- `forbidOnly: !!process.env.CI`; `retries: CI ? 2 : 0`; fixed workers in CI if the app cannot take parallel load.
- `use: { baseURL, trace: 'on-first-retry', screenshot: 'only-on-failure', video: 'retain-on-failure', actionTimeout, navigationTimeout }`.
- `webServer` starts the app locally (`reuseExistingServer: !CI`).
- Browser projects: Chromium always; Firefox/WebKit/mobile if the product's audience needs them.
- Reporters: html for humans, junit for CI.

## Flaky tests

1. Reproduce: `playwright test <file> --repeat-each=10`.
2. Usual causes and fixes:
   - Clicking before ready -> use auto-waiting locators, not `page.click(selector)` on stale handles.
   - Arbitrary `waitForTimeout` -> wait for a response, URL or visible state.
   - Animations -> wait for the element's stable state; disable animations in test mode.
   - Shared data -> unique data per test.
3. Quarantine only with a tracked issue (`test.fixme(true, 'flaky - #123')`), never silently; the flaky list is reviewed, not left to grow.

## CI

- Install from the lock file, install browsers with system deps, run tests, upload the HTML report and traces with `if: always()`.
- Pin action versions; read target URLs and secrets from CI variables, never commit them.

## Critical flows (payments, money, irreversible actions)

- Run against test/sandbox environments and provider test modes only; skip or hard-fail if the target looks like production.
- Mock external wallets/payment providers at the boundary (init scripts, provider test cards); assert previews and confirmations before the irreversible step.

## Failure report

For each failure: test name, `file:line`, error, screenshot/trace path, suspected cause, proposed fix. Summarize totals: passed / failed / flaky / skipped.

_Source: adapted from ECC `skills/e2e-testing` (MIT); see NOTICE.md._
