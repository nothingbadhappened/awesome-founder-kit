---
name: fk-react-testing
description: Use when writing or fixing tests for React components, hooks or pages - Testing Library queries, userEvent, MSW network mocks, axe checks, and when to move a test to Playwright.
---

# React testing

Test what the user sees and does, not implementation details. The project's runner and coverage policy win.

## Setup (once per repo)

1. One runner: Vitest (Vite/modern ESM) or Jest (where already established). Do not add a second component-test lane without a clear split.
2. `test-utils.tsx` exporting `renderWithProviders(ui)` that wraps the production providers (query client with `retry: false`, router, theme) and re-exports Testing Library.
3. MSW server in the test setup: `server.listen({ onUnhandledRequest: 'error' })`, `resetHandlers()` after each test, `close()` after all. Unmocked requests must fail loudly.
4. `jest-axe` or `vitest-axe` registered for accessibility assertions.

## Writing a test

1. Render with the same providers as production.
2. Query by priority: `getByRole` (with `name`), `getByLabelText`, `getByPlaceholderText`, `getByText`, `getByDisplayValue`; then `getByAltText`/`getByTitle`; `getByTestId` only as a last resort.
   - `getBy*` throws when missing; `queryBy*` returns null (assert absence); `findBy*` awaits async appearance.
3. Interact with `const user = userEvent.setup()` once per test and `await user.type(...)`, `await user.click(...)`. Prefer `userEvent` over `fireEvent`.
4. Assert visible output and observable effects (callback called with args, request sent, text shown).
5. Async: `await screen.findBy...`, `await waitFor(() => expect(...))`, `await waitForElementToBeRemoved(...)`. Never sleep with timers.
6. Override network per test with `server.use(http.get(..., () => new HttpResponse(null, { status: 500 })))` to cover error states.

## Hooks

- `renderHook(() => useThing(args), { wrapper })`; wrap state changes in `act`.
- Create the `QueryClient` once per test outside the wrapper, otherwise cache state resets on each render and tests flake.
- Test through the hook's public return value only.

## Accessibility

- `expect(await axe(container)).toHaveNoViolations()` for every interactive component. JSDOM has no real CSS, so contrast checks belong in browser tests.

## What to cover per component

Happy path; empty state; loading state; error state (MSW 4xx/5xx); validation messages; keyboard interaction for interactive widgets; error boundary fallback (silence and restore `console.error` around the expected throw).

## Snapshot tests

Avoid DOM snapshots of components: they break on styling and get rubber-stamped. Acceptable for pure serializers or generated config. Visual regression belongs in Playwright screenshots or a visual-diff service.

## When to use a real browser instead

JSDOM cannot do real layout, CSS transitions, scrolling, drag-and-drop, clipboard, iframes, popups, downloads, or cross-origin flows.

- Hook, presentational component, form logic -> Testing Library.
- Layout-dependent component or missing browser API -> Playwright component testing.
- Multi-page user flow -> Playwright end-to-end (`fk-e2e-testing`).

## Coverage

Use the project's thresholds. If the project has none, propose them in its standards (a common starting point: utilities and hooks high, containers lower, pages via E2E) rather than inventing a gate.

## Anti-patterns

- `container.querySelector` instead of accessible queries.
- Asserting render counts, internal state or props passed to children.
- Mocking React or framework hooks; mocking child components by default.
- Ignoring `act()` warnings (they flag real bugs).
- Shared mutable state between tests; `.skip`/`.only` left in.

## Commands

`vitest run [file]`, `vitest run --coverage`, `jest [file]`, `jest --coverage`; CI uses the one-shot form.

_Source: adapted from ECC `skills/react-testing` (MIT); see NOTICE.md._
