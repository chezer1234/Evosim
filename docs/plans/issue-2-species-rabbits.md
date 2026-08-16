# Issue #2 — Species (Rabbits): implementation plan

Source: https://github.com/chezer1234/Evosim/issues/2

## Decisions locked in with the user

| Question | Decision |
|---|---|
| Rabbit decision-making | Neural-network "genome" brain. No training/backprop this issue — weights are random at spawn, mutated copies pass to children. Selection happens implicitly through who survives/reproduces. |
| Food regrowth | Apple-bearing trees regrow on a timer after being eaten. |
| "Running" (costlier movement) | An AI decision (network output), not manual player control. No predators yet, so it's used opportunistically (e.g. sprinting for food) rather than fleeing. |
| Movement | Discrete tile-stepping (hop tile-center to tile-center on each sim tick), not continuous px movement. |
| Brain outputs | `moveDir(x,y)`, `run`, `rest`, `reproduceDesire` — four outputs, all learned/weighted rather than hardcoded. |

## Genome / brain spec (default, tunable)

- Plain JS feedforward net, no ML library. Per rabbit: inputs → 1 hidden layer (8 neurons, tanh) → outputs.
- **Inputs:** bias, `energy/100`, dx/dy to nearest visible apple (normalized by vision radius, 0 if none visible), distance to nearest visible apple (normalized, 1 if none), `onWater` flag, one random-noise input (for wander variety).
- **Outputs:** `moveX, moveY` (tanh, picks step direction), `run` (sigmoid, >0.5 = sprint), `rest` (sigmoid, >0.5 = stay put, overrides movement), `reproduceDesire` (sigmoid, >0.5 = attempt reproduction, only evaluated when energy > 75).
- **Genome = flattened weight/bias arrays.** Starter rabbits: random weights. Child: parent's weights + per-weight mutation (~15% chance per weight, gaussian noise, clamped).
- Runs once per **sim tick**, not per render frame.

## Other mechanics (from the issue, as written)

- Energy starts at 100, depletes 1 per 2.5s normally, 1 per 1s while running (`rest` output pauses depletion-triggering movement but energy still ticks down passively — TBD exact interaction, see open items below).
- Eating an apple: apple disappears from its tree, energy +10.
- Death at energy 0.
- Reproduction: requires energy > 75, costs 10 energy (paid at gestation start), 30s gestation, then child appears (mutated genome, placed on a valid adjacent tile).
- Vision: rabbit can see apples within a 5-tile radius.
- No rabbits at world start. A "Spawn Rabbit" button toggles placement mode; click a tile to place one.
- Clicking a rabbit shows its vision radius overlay.
- Apples appear on 10% of FOREST tiles (tile-level flag, seeded off the map's seed — not per individual drawn canopy, since canopies are cosmetic-only today).

## Phased build order

1. **Sim foundations** (`src/sim/`): rabbit entity shape, apple-tile assignment at map-gen time, sim clock (real-time delta accumulation off the existing rAF loop, independent of render FPS).
2. **Brain module**: tiny feedforward net (create/forward/mutate), genome utilities.
3. **Rendering**: apple accent on flagged FOREST tiles; rabbit sprite layer in `drawMap`.
4. **Spawn UI**: button + click-to-place, restricted to non-ocean tiles.
5. **Movement & foraging loop**: per-tick brain evaluation → tile-step, vision-radius apple detection, water-slowdown.
6. **Energy/lifecycle**: depletion ticks, eating, death/removal.
7. **Reproduction**: gestation timer, mutation, child placement.
8. **Inspect UI**: click a rabbit → vision radius + energy readout.
9. **Regrowth & balancing pass**: apple regrow timer, tune all constants by playtesting.

## Addendum: "Brains" insights panel (beyond the original issue)

Since rabbits think via an opaque NN genome, added a side panel (`src/sim/brainInsight.js` + `src/worldgen/RabbitInsights.jsx`) that translates raw weights into plain language:

- **Per-rabbit**: 5 named traits (Food drive, Wanders randomly, Boldness, Restfulness, Broodiness) derived from summed input→output weight pathways, a one-sentence blurb, and short notes on how energy modulates its run/rest/breed instincts.
- **Population-wide**: generation range of the living population, plus a sparkline trend of average Food drive / Boldness / Broodiness sampled every ~5s of sim time - this is the "how have they changed" view, since individual genomes drift via mutation across generations.
- Caveat noted in the code: the "pathway" numbers are a cheap sum-of-weighted-paths approximation, not a true saliency/gradient measure - good enough to describe tendencies, not a precise behavior predictor.

## Open items to confirm as we go (non-blocking, using sensible defaults for now)

- Exact apple regrow delay (defaulting to ~45s, easy to retune).
- Exact interaction between `rest` output and the fixed energy-depletion cadence.
- Sim tick rate (defaulting to ~5 ticks/sec for decisions; energy/gestation timers use real elapsed time regardless of tick rate).
