---
name: fk-frontend-patterns
description: Use when building or reviewing web UI code (React/Next.js or similar) - component composition, state placement, data fetching, forms, performance, error states, animation and accessibility.
---

# Frontend patterns

The project's design system (`design-system/`, the `<project>-design` skill) and standards win. React-specific rules: `fk-react-patterns`; tests: `fk-react-testing`, `fk-e2e-testing`.

## 1. Components

- Compose small components through `children` and named slot props (`header`, `sidebar`) instead of configuration-flag explosions.
- Compound components (`<Tabs>`, `<Tabs.List>`, `<Tabs.Panel>`) share state through a context that throws a clear error when used outside its parent.
- Props are typed; variants are unions (`'primary' | 'secondary'`), not free strings; defaults in the parameter list.
- One component per file for anything reused; presentational components receive data, containers fetch it.

## 2. State

- Derive values during render instead of syncing them into extra state.
- Keep state as close to its use as possible; lift only to the nearest common parent.
- Context for low-frequency, app-wide values (theme, auth, locale); split contexts by concern so one change does not re-render everything.
- High-frequency shared state: an external store (Zustand, Jotai, Redux Toolkit). Server data: a server-state library (TanStack Query, SWR) or server components.
- Reducers for state with several related transitions; actions are a typed union.

## 3. Data fetching

- Do not hand-roll fetch-in-effect for application data (races, no cache, no retry). Use the framework's server data loading or a server-state library.
- Every fetch has loading, empty, error and success UI; errors offer retry.
- Debounce user-driven requests (search ~300-500 ms) and cancel stale ones.

## 4. Forms

- Simple forms: native form + framework actions or controlled inputs with schema validation (zod, valibot) shared with the server when possible.
- Complex forms (multi-step, arrays, cross-field rules): a form library (React Hook Form, TanStack Form).
- Show field errors next to fields, disable submit while pending, keep user input on server errors.
- Client validation is for UX; the server validates again.

## 5. Performance

- Measure first (profiler, Lighthouse, Web Vitals); memoize (`memo`, `useMemo`, `useCallback`) only where a measurement shows wasted work.
- Code-split heavy, below-the-fold or route-level components (`lazy` + `Suspense` with a skeleton fallback).
- Virtualize long lists (roughly 50+ non-trivial rows) with `@tanstack/react-virtual` or `react-window`.
- Stable keys from data ids, never array indexes for reorderable lists.
- Optimize images (framework image component, explicit sizes, modern formats) and fonts (subset, `font-display: swap`).

## 6. Errors

- Error boundaries around independent regions (page, widget) with a fallback and a retry action; report to the error tracker.
- Boundaries do not catch event-handler or async errors; handle those where they occur and show feedback.

## 7. Motion

- Animate with purpose (feedback, continuity), short durations (150-300 ms), `transform`/`opacity` only.
- Respect `prefers-reduced-motion`; animation libraries (Framer Motion, etc.) only if the project already uses one.

## 8. Accessibility

- Semantic HTML first (`button`, `a`, `nav`, `main`, `label`); ARIA only to fill gaps.
- Everything works by keyboard: visible focus, logical tab order, Escape closes overlays, arrow keys in menus/listboxes.
- Dialogs: move focus in on open, trap it, restore it on close; `role="dialog"` + `aria-modal`.
- Every input has a label; images have alt text (empty for decorative); colour contrast meets WCAG AA.
- Announce async results (`role="status"` / `role="alert"`).

## 9. Review checklist

- [ ] Matches design-system tokens and components
- [ ] No derived state stored separately; state lives at the lowest common owner
- [ ] Loading / empty / error states present
- [ ] Forms validated client and server side
- [ ] No unmeasured memoization; heavy parts split; long lists virtualized
- [ ] Keyboard and screen-reader basics pass (axe clean)

_Source: adapted from ECC `skills/frontend-patterns` (MIT); see NOTICE.md._
