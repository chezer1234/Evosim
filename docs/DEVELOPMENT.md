# Development

Technical reference for working on Evosim. For what the project *is*, see the [README](../README.md).

**Stack:** React + Vite + Tailwind CSS. No backend — it's a static single-page app.

## Project structure

```
src/
  worldgen/       Procedural map generation and the Home → Settings → Game screens
    mapgen.js       Seeded Perlin fBm island generation, lake carving, and canvas rendering
                     (framework-agnostic — no React here)
    viewport.js     The map view's pan/zoom/pinch maths (framework-agnostic too)
    useIsCompact.js Media queries behind the responsive layout: compact chrome,
                     touch wording, and where the floating panels dock
    *.jsx            Screens and UI that drive mapgen.js
  sim/            The evolution simulation, layered on top of a generated map
    brain.js         Tiny hand-rolled feedforward neural net (each rabbit's "genome")
    rabbit.js        The rabbit's *sense* genes: how far it hears, how far its alarm
                     call carries, and what those map to in tiles
    fox.js           The fox genome: named 0..1 genes, their mutation, and the sim
                     units they map to (speed, vision, camouflage, metabolism, …)
    burrow.js        The warren: capacity, digging rules, and the tunnel network
                     rabbits can move through (framework-agnostic, pure functions)
    simulation.js    Entity state, both species' per-tick decision loops, predation,
                     hearing/alarm calls, sheltering, energy/lifecycle, reproduction
    brainInsight.js  Derives human-readable trait summaries from a brain's raw weights
    render.js        Draws rabbits, foxes and burrows onto the map canvas
```

The two species are deliberately modelled differently: a rabbit's *behaviour* is an
opaque neural net that has to be *interpreted* (`brainInsight.js`), while a fox is an
explicit gene vector you can read straight off the panel. See
[`docs/plans/issue-11-predator-foxes.md`](plans/issue-11-predator-foxes.md) for why.

A rabbit has both halves, though: its decisions live in the net, but its *senses* are
an explicit gene vector (`rabbit.js`) in the same style as the fox's — ear size is
hardware, not an opinion a weight matrix can hold. See
[`docs/plans/issue-14-rabbit-survival.md`](plans/issue-14-rabbit-survival.md), which
also covers the predator/prey rebalance and the burrow model.

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

Tests live alongside the source they cover (`*.test.js`) and run on [Vitest](https://vitest.dev). They focus on the pure logic — map-generation invariants, the brain's forward pass and mutation, the fox genome (mutation bounds, founder weighting, and every gene's mapping to sim units), the rabbit's sense genes and burrow model, the rabbit lifecycle (movement bounds, eating, energy depletion/death, reproduction), predation (hunting, pouncing, fleeing, camouflage, forest cover, pack behaviour), the issue #14 survival kit (hearing beyond sight, alarm calls between rabbits, digging/capacity/sheltering), and the map view's pan/zoom/pinch maths (`worldgen/viewport.js`) — since that's the code with real behavior to get wrong. Rendering and React components aren't covered yet.

Balance changes are worth checking against the whole ecosystem rather than a unit
test: a headless script that runs `stepSimulation` for several simulated minutes
across a handful of maps, counting how often each species goes extinct, is what
caught both the fox rebalance overshooting *and* a regression where peacetime
digging cut the rabbits' no-fox carrying capacity by two thirds. See the numbers in
[`docs/plans/issue-14-rabbit-survival.md`](plans/issue-14-rabbit-survival.md).

## Responsive layout

The app has to work on a phone as well as a desktop (see
[`docs/plans/issue-7-mobile-support.md`](plans/issue-7-mobile-support.md)).
Nothing branches on user-agent: `worldgen/useIsCompact.js` exposes media
queries for how much *room* there is, and the layout follows from that —
compact toolbars below 640px wide (or 560px tall), and floating panels that
dock as corner overlays, a bottom sheet, or a side panel depending on the
shape of the viewport. Test layout changes by resizing the browser window;
rotating a phone is the same thing.

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
