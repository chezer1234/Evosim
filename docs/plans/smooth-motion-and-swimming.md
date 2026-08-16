# Smooth motion, swimming as a skill, and a water animation — implementation plan

> "The graphics for bunnies and foxes are very jumpy and not smooth. I want
> them to move smoothly and the ability to swim needs to be a thing or not —
> maybe it's something they must learn and they shouldn't be able to just move
> freely in water without some skill. Lastly the animation in water needs to be
> different than when I'm on land."

Three requests, and they turn out to be one change: creatures need a visual
state that is separate from their grid position, water needs to be something a
creature can be *bad at*, and the renderer needs to draw those two facts
differently.

## The problem

**Jumpy.** Both species live on a tile grid and think on a fixed 200ms decision
cadence (`TICK_MS`). A walking rabbit steps a whole tile every second tick, so
it teleports two and a half times a second and reads as a stuttering dot. The
sim was right; the drawing was a direct readout of it.

**Water was free.** `isPlaceable` let anything except the open ocean be walked
on, and a lake cost a flat 3 ticks a tile for a rabbit and a flat ×0.55 for a
fox. Nothing could be *unable* to cross, so a lake never decided anything: not
where a warren could live, not whether a chase ended.

## Decisions

| Question | Decision |
|---|---|
| Interpolate positions, or move the sim off the grid? | **Interpolate.** The grid is what keeps vision radii, hearing, pouncing and burrow adjacency honest, and it's what every existing test is written against. A new `sim/motion.js` maintains a purely visual `renderX`/`renderY` that walks toward the tile the sim already moved to. Nothing in it can change where a creature *is*. |
| Where does the step duration come from? | The **sim tells the motion layer how long the step should take** — a rabbit's cadence (`stepEvery × TICK_MS`), a fox's fractional pace (`TICK_MS / tilesPerTick`). A step therefore lands exactly as the next one is issued, so movement is continuous rather than "jump, then wait". |
| How is swimming learned? | A **heritable `swimming` gene on both species**, in the same 0..1 style as the rest of the fox genome and the rabbit's senses — not a brain output. Whether an animal *can* swim is hardware, the same argument `rabbit.js` already makes about ear size. |
| Can everything swim a bit? | **No — there's a threshold** (`SWIM_MIN_SKILL = 0.35`). Below it the shoreline is a wall. A gradient alone would have meant everything still crossed everything, just slower, which is the mechanic we already had. |
| Do founders start able? | **No.** Founder means are 0.28 (rabbits) and 0.22 (foxes), both under the threshold, so roughly a third of the rabbits and a quarter of the foxes you drop on the island can enter water at all. Swimming is something a lineage arrives at. Mutation is untouched, exactly as with the fox founder weights from issue #14. |
| Why is the fox's founder mean lower than the rabbit's? | So the water starts out as **prey's advantage**. A lake is only a refuge while the predator is still landlocked; foxes have to earn their way in afterwards. |
| Does the brain get a "can I swim" input? | **No.** The gene and the brain are inherited together, so a lineage's response to the existing `In water` input co-evolves with its own swim gene without widening the input layer — and the flee/hide/search bias constants in `brain.js` are calibrated against the current input count. |
| What happens to something dropped in a lake it can't swim? | It **flounders**: it can only splash toward the nearest shore, burns energy faster than the worst swimmer, and drowns if the bank is too far. The alternative — refusing to move at all — is a trap, not a mechanic. |
| Is the open ocean swimmable at high skill? | **No.** It stays the edge of the world for everything. Lakes are the challenge; the sea is the boundary. |

## Smooth motion (`src/sim/motion.js`)

Each creature carries a small visual state alongside its tile:

| Field | What it is |
|---|---|
| `renderX` / `renderY` | Where it is *drawn*, in fractional tiles |
| `moveFrom*` / `moveTo*` / `moveElapsed` / `moveDuration` | The step currently being travelled |
| `moveStyle` | `HOP` or `SWIM` — which curve and which animation |
| `facing` / `renderFacing` | Direction, smoothed with a short-way-round angle lerp |
| `gaitPhase` / `breathPhase` / `stepParity` | Free-running cycles for paddling, breathing and alternating legs |

`beginMove()` starts a step **from where the creature is currently drawn**, not
from the tile it logically left — those differ whenever a sprinting fox takes
its second tile of a tick, and starting from the tile would snap it backwards a
whole cell. `advanceMotion()` is called once per creature per frame with the
same speed-scaled `dt` the sim gets, so at 4× the animation runs at 4× too.

`motionPose()` turns that state into what the renderer needs: `lift`, `scale`,
`shadow`, `stroke` and `stride`, all in multiples of the sprite radius.

## Swimming (`src/sim/water.js`)

One shared curve, two species' units:

| | at the threshold (0.35) | at 1.0 |
|---|---|---|
| Pace, as a fraction of overland | 0.28 | 0.95 |
| Energy burn, as a multiple | ×3.2 | ×1.3 |
| Rabbit cadence (ticks per tile) | 7 | 2 |
| Floundering (out of your depth) | ×0.2 pace, ×4.2 burn | — |

The skill is re-scaled across the *usable* part of the range rather than 0..1,
so a creature that has only just learned swims like it.

Consequences that fall out of the threshold, rather than being coded as special
cases:

- A rabbit cornered against a lake either crosses it or is caught, depending on
  one gene.
- A landlocked fox breaks off at the bank. A lake is an escape *until foxes
  evolve into the water too*.
- A weak swimmer that tries a wide crossing drowns halfway — the energy cost is
  what stops "live in the lake" from being a free way to dodge predators.
- Non-swimmers no longer wander into water at all, which is why the rabbit
  population comes out slightly *higher* after this change.

Movement gating is on **entering** water, not on being in it: something already
out of its depth has to be able to move through water to reach a bank.

## Two animations (`src/sim/render.js`)

| | On land | In water |
|---|---|---|
| Vertical | Hop arc; the body swells at the top of it | Bob on the stroke cycle |
| Underneath | Ground shadow, staying put and shrinking as it rises | No shadow — expanding ripples and a V of wake |
| Silhouette | Full sprite; ears up; tail out the back | Clipped at the waterline; only head and shoulders show, with the submerged mass showing through the water |
| Ears / tail | Ears sweep back mid-hop | Rabbit's ears flat along the surface; fox's brush tail trails on it |
| Fox legs | Diagonal pairs alternate every step — a trot | Under the surface entirely |
| Distress | — | Floundering adds splashes, at 1.4× ripple strength |

The "waterline" is a clip in the sprite's **own rotated space**: top-down there
is no horizon, so what the surface cuts across is the body's own axis — the
animal's back end is under, whichever way it is pointing. Swimming rabbits are
rotated to face their direction of travel for the first time (on land they are
drawn radially symmetric, which is fine for something that hops in place, not
for something with a wake).

## Ecosystem check

Per `docs/DEVELOPMENT.md`, balance is checked against the whole ecosystem
rather than a unit test. 12 generated maps, 24 rabbits and 3 foxes scattered on
each, 8 minutes of sim time:

| | rabbit extinctions | mean rabbits left | mean peak rabbits | fox extinctions | drowned |
|---|---|---|---|---|---|
| before | 0/12 | 20.3 | 48.5 | 7/12 | — |
| after | **0/12** | 23.4 | 48.1 | 5/12 | 22 |

Both species persist at the same rate. The small rise in surviving rabbits is
the expected consequence of non-swimmers no longer wandering into lakes and
burning energy there, and the drownings are the new cost landing on the
lineages that do get in the water. Average swim gene after 8 minutes ranged
from 0.12 to 0.39 across the twelve islands — selection pushing in different
directions depending on how much water each map actually has.

## Tests

- `motion.test.js` — interpolation lands exactly on the tile and never
  overshoots, a new step starts from the drawn position, hop vs glide easing,
  short-way-round turning, and the pose split (lift/shadow on land, bob and no
  shadow in water).
- `water.test.js` — the threshold, monotonic pace/drain curves, the
  usable-range rescale, and the nearest-land search a floundering creature
  steers by.
- `simulation.test.js` — a non-swimmer is cornered at the shore, a swimmer
  crosses, a landlocked fox breaks off (and a swimming one doesn't), water
  costs more energy than the same time on land, drowning is counted, a rabbit
  dropped in a lake flounders back to the bank, and drawn positions stay
  glued to their tiles.
- `render.test.js` — new: a recording canvas stub proves a land creature gets a
  ground shadow and no clip, a swimming one gets the waterline clip and no
  shadow, and that sprites are drawn at the interpolated position.
