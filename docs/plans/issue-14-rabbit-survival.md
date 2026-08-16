# Issue #14 — Rabbits can't survive the foxes: implementation plan

Source: https://github.com/chezer1234/Evosim/issues/14

> "The population dynamics currently do not work - the foxes completely
> demolish the rabbits leaving them extinct."

The issue asks for two things at once: **detune the foxes** (they compound
faster than their food supply) and **give rabbits real defences** (ears,
voices, and somewhere to hide).

## The problem, measured

A headless run of the sim before this change — a 96×96 map at default
vegetation, 25 rabbits and 4 foxes, 15 minutes of sim time, 8 repetitions:

| | rabbits left (mean) | rabbit extinctions | foxes left (mean) | fox extinctions | rabbits caught |
|---|---|---|---|---|---|
| before | 0.0 | **8/8** | 0.0 | 8/8 | 80 |
| after | 81.6 | **0/8** | 2.0 | 3/8 | 37 |

The old failure mode is a single spike: the foxes eat every rabbit within a
few minutes, then starve themselves. Nothing about it is a *cycle* — the
run just ends. Afterwards both species persist, with the fox population
lagging the rabbits the way a predator/prey pair should.

## Decisions

| Question | Decision |
|---|---|
| How do you weight the foxes down without capping evolution? | A **founder mean** per gene (`FOUNDER_MEAN` in `fox.js`) rather than a clamp. Fresh foxes are drawn around slower/hungrier/less fecund values; mutation is untouched, so a lineage can still evolve back to fast legs or a short gestation. The issue asked for exactly this ("a slight weight when you initially spawn them in… this does not mean that mutations cannot happen"). |
| Where does the rabbit's hearing live? | A **new explicit gene vector** (`rabbit.js`), not the neural net. Ear size is hardware; a weight matrix can't express it, and a separate 0..1 gene is what makes it mutate and show up as a trend line. Rabbits now have both: a gene vector for their senses and a brain for their decisions. |
| Do rabbits get told about danger, or does it stay per-individual? | Alarm **calls carry positions**, and *making* one is a reflex while *listening* is evolvable. A founder population that had to discover reacting to the alarm would be eaten before selection could act — the same reasoning as the existing `PANIC_RADIUS` and flee-bias overrides. |
| What stops burrows being a free win? | You **can't eat underground**. Hunger forces a rabbit back up, and below the shelter-hunger line it refuses to take cover at all — otherwise a rabbit flaps between hunger pushing it out and fear pulling it back until it starves holding a slot. |
| Why do burrows link into networks? | So going to ground isn't a trap. A rabbit forced up while a fox sits on the entrance surfaces at a **connected burrow** instead. That's the only reason to dig near an existing warren. |

## The fox side (`src/sim/fox.js`)

| Change | Before | After |
|---|---|---|
| Founder speed | 0.5 | **0.34** |
| Founder metabolism | 0.5 | **0.54** (burns down faster) |
| Founder fecundity | 0.5 | **0.28** (breeds later, gestates longer) |
| Upkeep range | 0.34–0.86/sec | **0.38–0.92/sec** |
| Speed surcharge | `0.40 × speed` | **`0.30 × speed + 0.55 × speed²`** — at speed 1 it costs 0.85 where it used to cost 0.40 |
| Breed threshold | 104→76 energy | **112→84** |
| Gestation | 52s→34s | **110s→68s** |
| Energy per kill | 30–62 | **34–68** (a carcass is worth slightly more, since everything else got dearer) |
| Vision in forest | full | **×0.55** — the 45% drop the issue asked for, measured from the tile the fox is standing on |

The quadratic speed price is the load-bearing one: it means "evolve faster
legs" has to be paid for in rabbits caught, rather than being a free upgrade
every lineage drifts into.

## The rabbit side

**Ears (`src/sim/rabbit.js`).** Two new genes, mutated per birth like the fox
genome:

- `hearing` → 7–13 tiles, always longer than the 6 tiles of sight
  (`PREY_ALERT_RADIUS`). Camouflage is a *visual* trick and buys a fox
  nothing against ears — what beats them is moving quietly, so audible range
  is scaled by `foxNoiseFactor`: ×0.5–1.0 prowling (by the speed gene), ×1.25
  sprinting, ×0.6 standing over a carcass. A slow stalker can still get
  close; a sprinting fox announces itself.
- `voice` → 6–14 tiles of alarm call. Reach between two rabbits is the
  average of the caller's voice and the listener's ears, so a warren gets
  better at talking to itself over generations.

**Communication (`src/sim/simulation.js`).** A rabbit that detects a fox
calls it automatically, with the fox's position attached; a rabbit that goes
to ground broadcasts the burrow's position. Listeners get an `alarm` brain
input, and a loud call is a hardwired panic even for a rabbit that has
perceived nothing itself. What's evolvable is the response — `heedsAlarm` in
the trait panel is how much a lineage lets someone else's alarm move it.

**Burrows (`src/sim/burrow.js`).** Dug for **7 energy**, hold **5 rabbits**,
and while underground a rabbit can't be seen, hunted or pounced on — and
can't eat. Burrows within 9 tiles share a tunnel; connected components are
one warren. A rabbit surfacing into a fox uses the tunnels if the network
offers a safer mouth.

**Brain (`src/sim/brain.js`).** Inputs 10 → 14 (alarm strength, burrow
direction x/y, underground flag) and outputs 7 → 8 (`hide`). Fresh brains
start biased toward hiding for the same reason they start biased toward
fleeing. The burrow direction inputs are reported **only while a threat is
perceived** — an always-on extra signal running through random weights
flipped a large share of the population's breeding gate off and cut the
no-fox carrying capacity by two thirds.

## What you can see in the app

- Burrow entrances with a spoil heap and one pip per occupant (5 max), joined
  by dashed tunnel lines where they're networked.
- Purple sound-wave arcs over a rabbit that is calling.
- Two rings on a selected rabbit: yellow sight, blue hearing.
- A selected fox's vision ring visibly contracting when it steps into forest.
- `🕳 n burrows · n underground` in the population panel, plus **Hearing**
  and **Voice** trend lines beside the fox genes, and **Burrow instinct** /
  **Heeds alarm calls** in the rabbit traits.

## Not done

- Foxes cannot dig a rabbit out or wait cleverly at an entrance; they just
  happen to keep the rabbit down there while they're nearby.
- Burrows are permanent — nothing collapses or is abandoned.
- Rabbits don't share food or breed inside burrows; gestation continues
  underground but the kit is born above ground.
