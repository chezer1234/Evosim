# Development

Technical reference for working on Evosim. For what the project *is*, see the [README](../README.md).

**Stack:** React + Vite + Tailwind CSS. No backend — it's a static single-page app.

## Project structure

```
src/
  worldgen/       Procedural world generation and the Home → Settings → Game screens
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
    *.jsx            Screens and UI that drive mapgen.js
  sim/            The evolution simulation, layered on top of a generated map
    net.js           The feedforward net both species' brains are built from: creation,
                     the forward pass, and gaussian mutation (shared so the two species
                     can never inherit by subtly different rules)
    brain.js         The rabbit's brain: layer sizes, founder biases, and what each
                     output means
    foxBrain.js      The fox's brain: when to chase, sprint, track a scent, run with
                     the pack, lie up and breed
    rabbit.js        The rabbit's *sense* genes: how far it hears, how far its alarm
                     call carries, and what those map to in tiles
    fox.js           The fox's *body*: named 0..1 genes, their mutation, and the sim
                     units they map to (speed, vision & nose, camouflage, metabolism, …)
    burrow.js        The warren: capacity, digging rules, and the tunnel network
                     rabbits can move through (framework-agnostic, pure functions)
    water.js         Swimming: the shared skill curve behind both species' swim
                     genes, the two thresholds (a lake, and the far higher one the
                     sea asks for), which tiles anything may enter, and the
                     nearest-land search a floundering creature steers by
    motion.js        The visual layer over the tile grid: interpolated positions,
                     hop/glide easing, and the pose (lift, shadow, stride, stroke)
                     the renderer draws each frame
    simulation.js    Entity state, both species' per-tick decision loops, predation,
                     hearing/alarm calls, scent, sheltering, energy/lifecycle, breeding
    brainInsight.js  Derives human-readable trait summaries from a rabbit's raw weights
    foxInsight.js    The same for a fox's brain: aggression, nose for prey, idleness…
    render.js        Draws rabbits, foxes and burrows onto the map canvas - two
                     distinct animations per species, on land and in the water
scripts/
  ecosystem.mjs     Headless, seeded balance harness - runs the real sim across a batch
                     of islands and reports what happened to each species
```

Both species are modelled the same way, in two halves: an **explicit gene vector** for
the parts of an animal a weight matrix cannot express (ear size is hardware, not an
opinion), and an **opaque neural net** for its decisions, which has to be *interpreted*
for the UI (`brainInsight.js`, `foxInsight.js`). A rabbit's genes are its senses; a
fox's are its whole body. See
[`docs/plans/fox-neural-nets.md`](plans/fox-neural-nets.md) for why the fox went from a
gene vector plus an if/else ladder to a brain of its own, and
[`docs/plans/issue-11-predator-foxes.md`](plans/issue-11-predator-foxes.md) for how the
fox genome started out. Also see
[`docs/plans/issue-14-rabbit-survival.md`](plans/issue-14-rabbit-survival.md), which
also covers the predator/prey rebalance and the burrow model.

Swimming is a gene in the same sense, shared by both species (`water.js`), and the
one place where the *drawing* of a creature diverges completely from its land pose.
It is also the only way a population ever leaves the island it was born on: see
[`docs/plans/big-worlds-islands-biomes.md`](plans/big-worlds-islands-biomes.md) for
multi-island worlds, biomes, the shallow-shelf crossing rule, and the atlas view.
The tile grid the sim reasons about is unchanged by any of it: what moves smoothly is
a separate visual position maintained by `motion.js`, which cannot affect where
anything actually is. See
[`docs/plans/smooth-motion-and-swimming.md`](plans/smooth-motion-and-swimming.md).

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
make check        # lint + test + build, i.e. everything CI does
```

`make help` lists every target.

Tests live alongside the source they cover (`*.test.js`) and run on [Vitest](https://vitest.dev). They focus on the pure logic — map-generation invariants, both species' forward pass and mutation (`brain.test.js`, `foxBrain.test.js`), the fox's body genes (mutation bounds, founder weighting, and every gene's mapping to sim units), the rabbit's sense genes and burrow model, the rabbit lifecycle (movement bounds, eating, energy depletion/death, reproduction), predation (hunting, pouncing, fleeing, camouflage, forest cover, pack behaviour), the fox's brain-driven decisions (chasing, tracking a scent, lying up, breeding), the issue #14 survival kit (hearing beyond sight, alarm calls between rabbits, digging/capacity/sheltering), swimming (both thresholds, pace/energy curves, drowning, floundering back to shore, and crossing — or failing to cross — to another island), biome classification and the climate model (`worldgen/biomes.test.js`), island labelling and strait detection (`worldgen/islands.test.js`), the motion layer's interpolation and poses, and the map view's pan/zoom/pinch maths (`worldgen/viewport.js`) — since that's the code with real behavior to get wrong.

`sim/render.test.js` is the one exception to "rendering isn't covered": it runs the draw path against a recording canvas stub to pin down the *choice* between the land and water animations (shadow versus waterline clip) and that sprites are drawn at their interpolated position, not their tile. React components still aren't covered.

### Balance: the ecosystem harness

Unit tests pin one mechanic each; they cannot tell you whether the island still has
two species on it in ten minutes. `scripts/ecosystem.mjs` can — it runs the real
simulation headlessly across a batch of islands and reports what happened to each
species:

```bash
make ecosystem              # 5 rabbits, 5 foxes, 15 sim-minutes, 8 seeds
make ecosystem-scatter      # the headline scenario, 20 seeds
make ecosystem-boom         # heavier prey seeding, where predators can overshoot
npm run ecosystem -- --rabbits 20 --foxes 5 --minutes 20 --runs 12 --seed 40
npm run ecosystem -- --json # machine-readable, for diffing two branches
```

Every run seeds `Math.random`, which the sim and the map generator both draw from, so
runs are **reproducible** and two configurations can be compared on identical islands.
That matters more than it sounds: outcomes vary so much between islands that an
unseeded eight-run A/B is mostly measuring the map, not the change. Reproduce a single
interesting run with `npm run ecosystem -- --seed <n> --runs 1`.

**Run it for anything touching energy, breeding, the senses or the decision loops.**
It is what caught the fox rebalance overshooting, a regression where peacetime digging
cut the rabbits' no-fox carrying capacity by two thirds, and an alarm-relay loop that
kept whole warrens underground until they starved. `src/sim/ecosystem.test.js` runs a
small seeded batch in CI, so "the foxes all died again" is now a test failure rather
than something you notice by eye a month later; its assertions are deliberately loose,
guarding against collapse rather than pinning today's numbers. See
[`docs/plans/fox-neural-nets.md`](plans/fox-neural-nets.md) and
[`docs/plans/issue-14-rabbit-survival.md`](plans/issue-14-rabbit-survival.md) for the
numbers it has produced.

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
