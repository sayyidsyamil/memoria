# ADR-0249: Nativewind and React Native Reusables for Mobile Primitives

## Status

Accepted

## Context

The mobile UI foundation needs to stay close to Memoria's desktop shadcn/ui design language while still using native React Native surfaces. The first fixture-driven mock used handwritten `StyleSheet` primitives, which was useful for establishing state coverage but risked drifting from the desktop component vocabulary and required too many one-off styling decisions.

Memoria already treats desktop shadcn/ui components as local application-owned primitives under `src/components/ui`. The mobile app needs the same ownership model: reusable primitives can be imported from an external registry, but Memoria should own the local files and compose product-specific surfaces from them.

## Decision

Adopt Nativewind and React Native Reusables for mobile UI primitives.

The mobile app will keep RNR-derived primitive components under `apps/mobile/src/components/ui`. Screens and Memoria-specific helpers should depend on local Memoria components, not on generated registry code scattered through feature files. Product-specific surfaces such as note rows, folder trees, editor chrome, properties panels, and Bear-inspired phone navigation remain Memoria compositions that use the shared primitives underneath.

Use Nativewind for the shadcn-style class and variant model. Keep Memoria semantic colors in the mobile Tailwind config so RNR defaults map to Memoria's visual language instead of unthemed Tailwind defaults.

## Consequences

- Mobile primitive work now follows the same local-wrapper pattern as desktop shadcn/ui.
- Codex can port more UI intent from desktop because buttons, text, badges, and future controls share a familiar variant/class vocabulary.
- Nativewind adds Metro, Babel, Tailwind, and CSS setup to the mobile app. Screenshot QA must remain part of every mobile UI iteration to catch build or styling regressions.
- Portal-heavy controls such as dialogs, dropdowns, and selects should be adopted in focused follow-up batches with iOS/Android interaction QA, not silently introduced inside large visual rewrites.
