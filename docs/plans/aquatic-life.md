# Aquatic life: fish, crabs, and a fox that outlives the rabbits

## The problem

Every long run ended the same way. Apples fed rabbits, rabbits fed foxes, and
that was the whole of it — one chain, one bottleneck. A bad few minutes for
the warren was a death sentence for the pack a few minutes later, because
there was nothing else on the island to eat. "The rabbits crashed, so the
foxes starved" is not a predator/prey dynamic; it is a single population with
a delay line attached to it.

The ask was for "an aquatic creature or two", with the requirement that **the
foxes survive even without rabbits**. So the water — which until now was
terrain with a swim gene attached (`sim/water.js`) and nothing living in it —
grows a food chain of its own.

## The shape of it

Three new modules, mirroring how the existing species are put together:

| File | What it is |
| --- | --- |
| `sim/shallows.js` | The productive fringe: which water is sunlit (lake, or the coastal shelf), how far a tile is from water, and the `forage` resource — algae below the tideline, wrack above it |
| `sim/fish.js` | The fish genome: `speed`, `shoaling`, `wariness`, `fecundity` |
| `sim/crab.js` | The crab genome: `boldness`, `armour`, `speed`, `fecundity` |

The per-tick loops live in `sim/simulation.js` alongside the other two
species', because that is where cross-species interaction (a fox taking a
crab) has to happen anyway.

### Neither of them has a brain

Rabbits and foxes each carry a neural net because the interesting question
about them is *what they decide*. The interesting question about a fish is
what it can **do**, and that is hardware. So the shoreline species are a gene
vector and nothing else, and their behaviour is a few fixed rules: eat, hold
with the shoal, bolt; or eat, and get back in the water.

That is a design decision, not a shortcut. Two arguments for it:

- **They are the bottom of the food chain.** A bottom that thinks as hard as
  its predators do can out-evolve them and turn the shallows into a wall of
  uncatchable fish. What a shoal *can* evolve is being faster, twitchier and
  more tightly shoaled — an arms race with a fox that has learned to fish,
  fought entirely in genes.
- **The contrast is worth drawing.** Opening a crab and finding four bars
  where a fox has a body *and* a brain says something true about the world:
  not everything alive here thinks.

### The two habitats, and why there are two species

One species would not have worked. Almost no fox can swim — founders start
well below the waterline (`FOUNDER_MEAN.swimming = 0.22` against a
`SWIM_MIN_SKILL` of 0.35) — so a purely aquatic prey animal would have been
food for a lineage that had already solved the water, and scenery to everyone
else.

So the shoreline is split across the waterline:

- **Fish** live in the shallows and nowhere else. The deep is as much a wall
  to a fish as the beach is: it grows nothing. A fox can take one only where
  the water has a bank on it (`isBankside`) — or anywhere at all, if it can
  swim, which is one more thing the swim gene quietly buys.
- **Crabs** work the tideline. `boldness` is how many tiles of dry land a
  lineage will put between itself and the water: at 0 it never leaves the
  shallows and no landlocked fox can touch it; at the top of its range it
  works the full width of the wrack line, where the weed is uncontested by
  anything that swims and a fox can simply pick it up.

Crab boldness is the most legible gene in the simulation. It is a population's
average willingness to be somewhere dangerous, and every fox on the beach is
voting on it.

### What the fox learned

The fox brain gained one output (`forage`) and three inputs (the direction and
distance of the nearest reachable fish or crab). Founders start biased toward
taking what the shore offers, for the same reason they start biased toward
chasing rabbits: a fox that had to *discover* picking a crab up starves on an
island whose rabbits have already gone under, and the mechanic would never
show up in a run at all.

Priority order in `runFoxDecisionTick` is: chase a rabbit it can see → work
the shoreline → lie up → follow a scent → regroup with the pack. A rabbit is
worth about four crabs, so a rabbit in sight wins; but a crab in reach beats
lying up, following a smell, or catching up with the pack, all of which are
ways of *maybe* eating later.

Hunger overrides the brain, exactly as it does for resting: a fox down to its
last reserves takes the certain mouthful whatever its instincts say about
beachcombing. That override is what makes "the foxes survive without rabbits"
a property of the simulation rather than of whichever lineage happened to
evolve a taste for shellfish.

Unlike the pounce, a grab can **miss**: a fish flicks away (its `speed` gene
buys `evasion`), a shell turns the paw (`armour` buys `toughness`). That is
the whole difference between the two food sources — a rabbit is rare, fast and
worth a great deal when it works; the tideline is constant, slow, worth a
mouthful, and works often enough to live on.

## Numbers

Per meal, as a share of what the same fox gets off a rabbit: a fish is 0.5, a
crab 0.32. Handling time is 700ms against 1800ms for a carcass. A fox living
entirely off the shoreline eats constantly and breeds slowly, which is exactly
the marginal existence it should be.

The shallows carry a population ceiling scaled to how much of the world can
grow anything (`FISH_CAP_PER_FORAGE_TILE`, `CRAB_CAP_PER_FORAGE_TILE`), so a
pond holds a handful of fish and an archipelago holds a lot of them. Both
species breed on a cooldown and their young are born on the clock — without
that, a fish that eats two patches of algae spawns, and so does everything it
spawned, and a founder shoal hits its ceiling in ten seconds. As it stands a
scatter of 30 takes about three minutes to fill the water.

## What the harness says

`scripts/ecosystem.mjs` grew `--fish` and `--crabs`, plus reporting for both
populations, shore catches, and the shoreline genes (`make ecosystem-shore`,
`make ecosystem-full`).

**Foxes with no rabbits at all** (4 foxes, 25 fish, 25 crabs, 15 sim-minutes,
6 seeds): 4.2 foxes left on average, **extinct in 0/6**, ~82 shore catches per
run, and cubs born in most runs. The same scenario before this change is a
stopwatch: with nothing to hunt, every founder starves.

**The whole food web** (8 rabbits, 4 foxes, 25 fish, 25 crabs, 10 sim-minutes,
6 seeds): rabbits 11.7 and foxes 7.7 left, both species alive in 6/6. Against
the same seeds with a dead shoreline: rabbits 15.0, foxes 5.5. So a productive
shore carries about half again as many foxes, and costs the rabbits something
without threatening them — on an 8-minute 3-seed batch, rabbit survival is
11.3 (no shore) against 10.7 (with one).

Selection shows up in the shoreline genes within a few generations: crab
boldness drifts down toward the water on beaches the foxes actually work, and
fished shoals get quicker.

## Tests

- `sim/fish.test.js`, `sim/crab.test.js` — the genomes: bounds, determinism,
  mutation drift, and every gene's mapping to sim units (including the two
  that must never reach 1: a fish's evasion and a crab's toughness).
- `sim/shallows.test.js` — which water is shallows, where the tideline is,
  what counts as bankside, the shore-distance flood, and that the forage
  layout is a property of the map rather than a draw from the global rng.
- `sim/aquatic.test.js` — the behaviour: a fish never leaves the water, a
  timid crab never leaves it either, a bold one goes exactly as far as its
  gene allows and walks back to the water when it is dropped somewhere it
  cannot live, a fox fishes from the bank without getting its feet wet, a
  landlocked fox does not stalk a fish it could never reach, and a starving
  one takes what it can get whatever its instincts say.
- `sim/ecosystem.test.js` — two new batches: an island whose shoreline is
  alive (the rabbits still make it), and an island with no rabbits at all
  (the foxes still make it, and do not fish the shallows empty).

## Things deliberately not done

- **No third predator.** An otter or a heron eating the fish would be a
  fourth species with nothing to say that the fox does not already say.
- **No per-island tally for fish and crabs.** The atlas view counts rabbits
  and foxes per island because the interesting fact there is which
  populations have met each other. Fish are in every stretch of water on the
  map; counting them per island is noise.
- **Forage does not starve the shallows out.** The population ceiling is what
  bounds the shoals. What the forage itself decides is finer-grained and more
  interesting than a number: which patch of water is worth being in, whether
  a crab has to leave the water to find weed no fish has taken, and who
  starves when a stretch of shore has been stripped.
