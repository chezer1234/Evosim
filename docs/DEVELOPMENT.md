# Development

Technical reference for working on Evosim. For what the project *is*, see the [README](../README.md).

**Stack:** React + Vite + Tailwind CSS. No backend — it's a static single-page app.

## Project structure

```
src/
  worldgen/       Procedural map generation and the Home → Settings → Game screens
    mapgen.js       Seeded Perlin fBm island generation, lake carving, and canvas rendering
                     (framework-agnostic — no React here)
    *.jsx            Screens and UI that drive mapgen.js
  sim/            The evolution simulation, layered on top of a generated map
    brain.js         Tiny hand-rolled feedforward neural net (each rabbit's "genome")
    simulation.js    Entity state, the per-tick decision loop, energy/lifecycle, reproduction
    brainInsight.js  Derives human-readable trait summaries from a brain's raw weights
    render.js        Draws rabbits onto the map canvas
```

`docs/plans/` holds the implementation plans written for each feature/issue, kept for context on *why* something works the way it does.

## Setup

```bash
npm install
npm run dev
```

Open http://localhost:5173.

## Testing

```bash
npm test          # run once (used by CI)
npm run test:watch
```

Tests live alongside the source they cover (`*.test.js`) and run on [Vitest](https://vitest.dev). They focus on the pure simulation logic — map-generation invariants, the brain's forward pass and mutation, and the rabbit lifecycle (movement bounds, eating, energy depletion/death, reproduction) — since that's the code with real behavior to get wrong. Rendering and React components aren't covered yet.

## Linting

```bash
npm run lint
```

Uses [oxlint](https://oxc.rs/docs/guide/usage/linter.html).

## Build

```bash
npm run build
npm run preview
```

## CI

Every pull request and push to `main` runs [`.github/workflows/ci.yml`](../.github/workflows/ci.yml): install, lint, test, then build. A PR can't be merged with a red check, so `main` is always in a state that's safe to deploy.

## Deploy (Render)

Deployed as a Render **Static Site** ([live dashboard service: `Evosim`](https://dashboard.render.com)):

- **Branch:** `main`
- **Build Command:** `npm install; npm run build`
- **Publish Directory:** `dist`

Auto-Deploy is on, so every push to `main` (i.e. every merged PR) redeploys automatically — which is why CI gating PRs matters: by the time a change reaches `main`, it's already passed lint/test/build once in GitHub Actions.

To set this up from scratch on a new Render account: **New → Static Site**, connect the GitHub repo, and use the settings above.
