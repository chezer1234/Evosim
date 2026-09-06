# Development

Technical reference for working on Evosim. For what the project *is*, see the [README](../README.md).

**Stack:** React + Vite + Tailwind CSS. No backend — it's a static single-page app.

**Where the reasoning lives:** in the code, at the top of each file and beside the
constant it explains. This document is a map of the territory, not a second copy of it —
if you want to know *why* a fox's speed gene is priced quadratically or why fish don't
have brains, the answer is in `sim/fox.js` and `sim/fish.js`, next to the thing it
governs, where it can't drift out of date.

## Project structure

```
src/
  worldgen/       Procedural world generation and the Home → Settings/Scenario → Game screens
    mapgen.js       Seeded Perlin fBm terrain, one falloff per island, lake carving, and
                     canvas rendering — including the zoomed-out atlas view
                     (framework-agnostic — no React here)
    biomes.js       The tile vocabulary and what each biome *is*: classification from
                     altitude/moisture/temperature, the climate model, and the two things
                     the sim reads off a biome (cover, and whether it bears fruit)
    islands.js      Which landmass is which, the shallow shelf around every coast, and
                     which islands are close enough to swim between (pure array work)
    viewport.js     The map view's pan/zoom/pinch maths (framework-agnostic too)
    useIsCompact.js Media queries behind the responsive layout: compact chrome,
                     touch wording, and where the floating panels dock
    usePersistentSettings.js  The localStorage-backed settings pattern both setup
                     screens use (useMapSettings, useScenarioSettings)
    *.jsx            Screens and UI that drive mapgen.js
  sim/            The evolution simulation, layered on top of a generated map
    scenario.js      The rules of a run: the player-facing dial set behind the
                     Scenario screen, the presets, and createRules() - which turns
                     one into the `sim.rules` every genome and brain reads
    net.js           The feedforward net both brains are built from: creation, the
                     forward pass, and gaussian mutation (shared so two species can
                     never inherit by subtly different rules)
    brain.js         The rabbit's brain: layer sizes, founder biases, and what each
                     output means
    foxBrain.js      The fox's brain: when to chase, sprint, track a scent, run with
                     the pack, work the shoreline, lie up and breed
    rabbit.js        The rabbit's *sense* genes: how far it hears, how far its alarm
                     call carries, and what those map to in tiles
    fox.js           The fox's *body*: named 0..1 genes, their mutation, and the sim
                     units they map to (speed, vision & nose, camouflage, metabolism, …)
    shallows.js      The second food chain's terrain: which water is sunlit, how far a
                     tile is from water, and the forage (algae/wrack) on the fringe
    fish.js          The fish genome: speed, shoaling, wariness, fecundity
    crab.js          The crab genome: boldness (how far up the shore it will feed),
                     armour, speed, fecundity
    burrow.js        The warren: capacity, digging rules, and the tunnel network
                     rabbits can move through (framework-agnostic, pure functions)
    water.js         Swimming: the shared skill curve behind both land species' swim
                     genes, the two thresholds (a lake, and the far higher one the
                     sea asks for), which tiles anything may enter, and the
                     nearest-land search a floundering creature steers by
    motion.js        The visual layer over the tile grid: interpolated positions,
                     hop/glide easing, and the pose (lift, shadow, stride, stroke)
                     the renderer draws each frame
    simulation.js    Entity state, every species' per-tick decision loops, predation,
                     hearing/alarm calls, scent, sheltering, foraging the tideline,
                     energy/lifecycle, breeding
    brainInsight.js  Derives human-readable trait summaries from a rabbit's raw weights
    foxInsight.js    The same for a fox's brain: aggression, nose for prey, idleness…
    render.js        Draws all four species, burrows and both larders onto the map
                     canvas - two distinct animations per land species, on land and in
                     the water, and a fish drawn *under* the surface rather than on it
scripts/
  ecosystem.mjs     Headless, seeded balance harness - runs the real sim across a batch
                     of islands and reports what happened to each species
```

## How a species is modelled

Rabbits and foxes come in two halves: an **explicit gene vector** for the parts of an
animal a weight matrix cannot express (ear size is hardware, not an opinion), and an
**opaque neural net** for its decisions, which has to be *interpreted* for the UI
(`brainInsight.js`, `foxInsight.js`). A rabbit's genes are its senses; a fox's are its
whole body.

Fish and crabs are deliberately only the first half — genes, no net. They are the
bottom of the food chain, and a bottom that thinks as hard as its predators do can
out-evolve them.

Two food chains meet at the fox: apples → rabbits → foxes, and algae/wrack → fish and
crabs → foxes. The second one is what keeps a pack alive on an island whose rabbits
have crashed.

Swimming is a gene shared by both land species (`water.js`), and the only way a
population ever leaves the island it was born on. The tile grid is unchanged by any of
it: what moves smoothly is a separate visual position maintained by `motion.js`, which
cannot affect where anything actually is.

## Starting conditions

Anything the player can set before a run lives in `sim/scenario.js`, and reaches the
simulation exactly one way: `createSimulation(map, scenario)` resolves it into
`sim.rules` once, and every founder built, cub mutated and apple eaten in that run
reads those rules. A run cannot change its own physics halfway through.

Three layers, and the split is the thing to keep straight:

- **Baselines** stay in the file that owns the mechanic — `FOX_BASE` in `sim/fox.js`,
  `RABBIT_BASE` in `sim/rabbit.js`, the founder biases in the two brain files,
  `NET_BASE` in `sim/net.js` — next to the paragraph explaining why the number is what
  it is. `scenario.js` imports them; it never restates one.
- **A scenario** is the flat dial set: one number per slider, persisted to
  localStorage, defined by the `SCENARIO_GROUPS` table (which is also what renders the
  screen, so a dial cannot exist in the sim without being reachable in the UI).
- **Rules** are what the sim reads. Every genome and brain function takes its fragment
  as a trailing argument that defaults to the baseline, which is why nothing outside
  the sim loop had to change when this landed.

**Adding a dial:** add it to the right group in `SCENARIO_GROUPS` (label, range, and
the plain-English hint), map it in `createRules`, and read it off `sim.rules` where the
constant used to be. The default must reproduce today's balance — `scenario.test.js`
asserts that, and every other test in the repo assumes it.

**Presets are the product, not the sliders.** Twenty raw dials mostly produce dead
islands. Anything added to `SCENARIO_PRESETS` has to be balance-checked headlessly
before it ships — `make ecosystem-presets` runs the real sim across a batch of seeded
islands for each one, and `sim/ecosystem.test.js` keeps a short version of that in CI.

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
make check        # lint + test + build, i.e. everything CI does
```

`make help` lists every target.

Tests live alongside the source they cover (`*.test.js`) and run on
[Vitest](https://vitest.dev). They cover the pure logic — map generation, both nets'
forward pass and mutation, every genome's mapping to sim units, the lifecycle and
decision loops of all four species, predation and the shoreline food chain, swimming,
biomes, island/strait detection, the motion layer and the viewport maths. React
components aren't covered; `sim/render.test.js` is the one rendering exception, running
the draw path against a recording canvas stub to pin down *which* animation a creature
gets and that sprites are drawn at their interpolated position.

**Seed anything that runs the sim or the map generator.** Both draw from `Math.random` —
search headings, brain noise, mutation, catch rolls, the map seed itself — so a test that
steps the world for a few seconds and asserts an outcome is sampling, not deciding. The
sim test files pin `Math.random` to a fixed stream in a `beforeEach` and restore it after;
do the same rather than leaving a test that fails once every twenty runs for reasons
nobody can reproduce.

### Balance: the ecosystem harness

Unit tests pin one mechanic each; they cannot tell you whether the island still has
two species on it in ten minutes. `scripts/ecosystem.mjs` can — it runs the real
simulation headlessly across a batch of islands and reports what happened to each
species:

```bash
make ecosystem              # 5 rabbits, 5 foxes, 15 sim-minutes, 8 seeds
make ecosystem-scatter      # the headline scenario, 20 seeds
make ecosystem-boom         # heavier prey seeding, where predators can overshoot
make ecosystem-shore        # foxes, fish and crabs and no rabbits at all
make ecosystem-full         # all four species on one island
npm run ecosystem -- --rabbits 20 --foxes 5 --fish 25 --crabs 25 --minutes 20 --runs 12 --seed 40
npm run ecosystem -- --preset boom          # one of the Scenario screen's presets
make ecosystem-presets                      # every preset, on identical seeds
npm run ecosystem -- --json # machine-readable, for diffing two branches
```

Every run seeds `Math.random`, which the sim and the map generator both draw from, so
runs are **reproducible** and two configurations can be compared on identical islands.
That matters more than it sounds: outcomes vary so much between islands that an
unseeded eight-run A/B is mostly measuring the map, not the change. Reproduce a single
interesting run with `npm run ecosystem -- --seed <n> --runs 1`.

**Run it for anything touching energy, breeding, the senses or the decision loops.**
It is what caught the fox rebalance overshooting, a regression where peacetime digging
cut the rabbits' no-fox carrying capacity by two thirds, an alarm-relay loop that kept
whole warrens underground until they starved, and a shoreline whose fish doubled every
few seconds until they hit their ceiling inside a minute. `src/sim/ecosystem.test.js`
runs a small seeded batch in CI, so "the foxes all died again" is a test failure rather
than something you notice by eye a month later; its assertions are deliberately loose,
guarding against collapse rather than pinning today's numbers.

## Responsive layout

The app has to work on a phone as well as a desktop. Nothing branches on user-agent:
`worldgen/useIsCompact.js` exposes media queries for how much *room* there is, and the
layout follows from that — compact toolbars below 640px wide (or 560px tall), and
floating panels that dock as corner overlays, a bottom sheet, or a side panel depending
on the shape of the viewport. Test layout changes by resizing the browser window;
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
