# Issue #11 — A predator animal (foxes): implementation plan

Source: https://github.com/chezer1234/Evosim/issues/11

> "This is a rabbit eater. It should be scary. Maybe foxy. It should have some
> parameters that control how bitey it gets to be: speed, vision, camouflage,
> metabolism, desire to hunt, pack tendencies! Any other you think? There
> could be a better interface to allow spawning one of these creatures."

## Decisions

| Question | Decision |
|---|---|
| How is a fox "wired"? | An **explicit gene vector**, not a neural net. The issue asks for named parameters; genes make them legible and directly watchable as they drift. Rabbits keep their NN brain — two species, two representations, same evolutionary loop. |
| Which genes? | The six from the issue — speed, vision, camouflage, metabolism, desire to hunt (`bloodlust`), pack tendency — plus **stamina** (how long a chase can be pressed) and **fecundity** (how readily it breeds). Those last two were needed anyway to make chases and reproduction anything other than hardcoded constants. |
| What stops every gene evolving to 1? | An **upkeep surcharge**: big eyes, fast legs, a thick coat and deep lungs all cost energy per second (`foxStats().upkeepPerSec`). A maxed-out fox starves between kills, so each gene has to pay for itself. |
| Can rabbits respond? | Yes, or the feature is just a cull. Rabbit brains gain **three predator inputs** (fox dx/dy/distance) and a seventh output, **`flee`**. |
| Sexual reproduction / pairs? | No — cubs are asexual mutated copies, same as rabbits. Consistent with what's already there; pairing is a separate change. |

## Fox genes → sim units (`src/sim/fox.js`)

All genes are stored 0..1 and mapped by `foxStats()`:

| Gene | What it buys | Range |
|---|---|---|
| `speed` | tiles/tick prowling and sprinting | 0.30–0.60 prowl, ×2.05 sprinting (a running rabbit does 1.00) |
| `vision` | how far it spots prey | 4–12 tiles |
| `camouflage` | shrinks the range at which rabbits notice it | ×1.0 → ×0.22 of `PREY_ALERT_RADIUS` |
| `metabolism` | burn rate **and** energy per kill | 0.34–0.86/sec upkeep; 30–62 per kill |
| `bloodlust` | the energy below which it bothers to hunt | 46 → 130 (above max energy = hunts constantly) |
| `packTendency` | pack radius + chase speed bonus with a packmate | 6–18 tiles, +0–30% |
| `stamina` | sprint ticks before it must break off | 14–58 ticks |
| `fecundity` | breeding threshold and gestation length | 104→76 energy, 52s→34s |

Cubs inherit the parent's genes with a 30%-per-gene gaussian mutation
(σ 0.09), clamped to 0..1. Founder foxes are drawn near the middle of each
range (±0.34) so the first fox you place doesn't decide the run by spawn luck.

## Predation mechanics (`src/sim/simulation.js`)

- **Movement** is a fractional tiles-per-tick budget (`stepCredit`), unlike the
  rabbits' integer tick cadence — needed so a continuous speed gene actually
  varies continuously. Blocked diagonals slide along one axis so a fox never
  stalls on a coastline.
- **Hunting** = prey inside `visionRadius` *and* energy below the bloodlust
  threshold. Sprinting is rationed by stamina and only spent inside
  `FOX_SPRINT_RANGE`, where the burst can end in a pounce.
- **The pounce** takes any rabbit within Chebyshev distance 1 — adjacent, not
  same-tile, because both species move a whole tile at a time and would
  otherwise swap past each other without meeting.
- **Feeding** pins the fox in place for 1.8s after a kill. This is what stops
  one fast fox clearing a whole warren in seconds.
- **Pack tendency** does two things: idle foxes drift toward packmates, and a
  chase with support closes faster.

## Rabbit response (`src/sim/brain.js`, `brainInsight.js`)

- Inputs 7→10: fox dx, dy, distance (normalized by `PREY_ALERT_RADIUS`, and
  reading "nothing there" when the fox's camouflage keeps it unseen).
- Outputs 6→7: `flee`, biased toward "yes" in fresh brains
  (`FLEE_INITIAL_BIAS`) for the same reason `searchDrive` is — a founder
  population that has to *discover* running away is eaten before selection can
  act on it.
- Inside `PANIC_RADIUS` (2.5 tiles) fleeing is a hardwired reflex, matching the
  existing hunger override. Between panic range and the edge of detection it's
  the genome's call, and that's where the trade-off lives: bolting early is
  safe but burns energy and abandons food. A bolt is always a sprint, and
  terrain still applies — a rabbit can be cornered against water, which is
  where a fast fox earns its meal.
- New trait bar: **Skittishness**, alongside the existing five.

## Interface (`SpawnPalette.jsx`, `FoxInsights.jsx`, `PopulationPanel.jsx`)

The old single "🐇 Spawn rabbit" toggle doesn't scale to two species, so it's
now a **spawn palette**: pick the species, pick how many land per click
(×1/×3/×5/×10), click the map, or scatter that many across the island in one
go. Alongside it:

- **Fox inspector** — the gene bars *are* the genome, plus a "menace" score and
  the numbers those genes work out to ("sees prey 8.0 tiles away… needs a
  rabbit every ~46s to break even").
- **Population panel** — both populations on one axis (the predator/prey lag is
  the point), a kill counter, and average fox genes drifting over time next to
  the rabbit traits.
- **On the map** — foxes are drawn nose-first along their heading, bigger than
  rabbits; camouflage visibly fades them into the ground; a hunting fox's eyes
  glow red and it carries a menace glow; sprinting draws motion streaks;
  packmates get a violet arc; fleeing rabbits turn pink with an alarm ring.

## Observed behaviour after a couple of minutes of play

Both populations coexist and oscillate rather than one wiping out the other,
and fox genes visibly drift under selection: on a dense-warren island average
**vision fell to ~17%** (expensive, and unnecessary when prey is everywhere)
while **desire to hunt rose to ~75%**. That's the intended shape — the genes
are load-bearing, not decoration.

## Known gaps / next passes

- Foxes reproduce asexually; a real pack would pair up and den.
- No scent trails or memory: a fox that loses sight of prey reverts to a random
  sweep rather than tracking.
- Rabbits can't evolve *herd* behaviour (no rabbit-sees-rabbit input yet), so
  "safety in numbers" isn't available to them as a strategy.
- The boom/crash carrying-capacity question from issue #2 is still open, and
  predation now interacts with it.
