---
name: fk-react-patterns
description: Use when writing or reviewing React 18/19 components - hooks discipline, state location, server/client components, Suspense and error boundaries, form actions, data fetching, memoization.
---

# React patterns (18/19)

Project standards win. Cross-framework UI concerns: `fk-frontend-patterns`; tests: `fk-react-testing`.

## Core rules

1. **Render is pure**: derive values from props/state during render. Storing derived values via `useEffect` + `setState` adds a render, can desync, and hides data flow.
2. **Side effects** (network, subscriptions, mutations) live in event handlers or effects, never in the render body.
3. **Compose**, never inherit: `children`, slot props, compound components, hooks.

## Hooks discipline

- Call hooks at the top level only, never conditionally or in loops.
- Every effect that subscribes, listens or sets a timer returns a cleanup.
- Use the functional updater (`setCount(c => c + 1)`) when the next state depends on the previous one.
- Effect dependency arrays are complete; fix the cause instead of silencing the lint rule.
- Default: no memoization. Add `useMemo`/`useCallback`/`memo` only when a profiler or a dependency chain (effect deps, memoized child) proves it matters.
- Extract a custom hook when the same hook sequence appears in two or more components.

## Where state lives

```
one component                          -> useState in it
parent + a few descendants             -> lift to nearest common ancestor
distant branches, rarely changes       -> Context (theme, auth, locale)
shared and updates often               -> external store (Zustand, Jotai, Redux Toolkit) via useSyncExternalStore
comes from the server                  -> server components or TanStack Query / SWR
```

## Server and client components (App Router / RSC)

- Components are server components by default: async, data fetched on the server, no client JS for themselves.
- Add `"use client"` only to components that need state, effects, browser APIs or event handlers; keep them as leaves.
- Server -> client: pass serializable props or `children`. Never import a server component into a client file; compose through `children`.
- Client -> server: server actions via `<form action>` or from event handlers inside `startTransition`. Server actions validate input and check authorization like any endpoint.

## Suspense and error boundaries

- Wrap data-dependent regions: `<ErrorBoundary fallback={...}><Suspense fallback={<Skeleton/>}>...</Suspense></ErrorBoundary>`.
- Place Suspense close to the data to reveal content progressively, not one boundary at the route root.
- Error boundaries catch render/lifecycle errors only, not event handlers or async callbacks. Use `react-error-boundary` for a hook-friendly API.

## Forms

- New code: React 19 actions (`useActionState` for result/pending state, `useFormStatus` in submit buttons, `useOptimistic` for optimistic lists).
- Controlled inputs when the value drives other UI or needs per-keystroke formatting/validation.
- Multi-step, dynamic arrays, cross-field rules: React Hook Form or TanStack Form.

## Data fetching

| Need | Use |
|---|---|
| Per-request data in a server framework | server component `await` / loaders |
| Client cache, mutations, invalidation | TanStack Query |
| Lightweight client cache | SWR |
| Real-time | SSE / WebSocket / library subscription |
| One-off action | `fetch` in an event handler |

Avoid `useEffect` + `fetch` for application data.

## Performance

- `memo` helps only when a component re-renders often with equal props and its render is measurably expensive.
- Split contexts by concern; keep fast-changing state low in the tree.
- Stable `key`s from ids; virtualize long lists.
- Use transitions (`useTransition`, `useDeferredValue`) for expensive non-urgent updates.

## Accessibility

Semantic elements before `role`; every interactive element keyboard-reachable; inputs labelled; focus managed on route change and dialog open/close; run axe in component tests.

## Review checklist

- [ ] No derived state in effects; effects clean up; complete deps
- [ ] State at the right level per the table above
- [ ] `"use client"` only where needed; server actions validate and authorize
- [ ] Suspense + error boundary around async regions
- [ ] Memoization justified by measurement
- [ ] Accessible markup and focus handling

_Source: adapted from ECC `skills/react-patterns` (MIT); see NOTICE.md._
