# Evosim

**An evolution simulator.** Generate a procedural island, drop in a population, and watch it evolve — tile by tile, generation by generation — as it learns to survive whatever the land throws at it.

### 🏝️ [Play the live site → evosim.onrender.com](https://evosim.onrender.com)

No install, no sign-up — it just opens and runs in your browser.

## What's in it right now

- **A new island every time.** Every "Play" generates a fresh, seeded coastline — tune its size, terrain roughness, lake count, and vegetation from Settings.
- **Rabbits** — the first species. Each one is steered by its own small "brain" that decides when to forage, rest, sprint, or reproduce. Energy drains over time, food restores it, and reproduction passes a mutated copy of a rabbit's brain to its offspring — so populations drift and adapt across generations, entirely from selection pressure rather than anything hand-scripted.
- **Foxes** — the predator. Where a rabbit thinks with a neural net, a fox is a set of named, heritable dials: **speed, vision, camouflage, metabolism, desire to hunt, pack tendency, stamina and fecundity**. They stalk, sprint, pounce and feed; camouflaged ones get closer before the rabbits notice; pack-minded ones hunt together. Every gene costs energy to run, so a fox that's good at everything starves — click one to see its genome and what it works out to in practice.
- **Rabbits can see them coming.** Their brains gained predator inputs and a `flee` output, so bolting early versus holding your nerve is something a lineage evolves, not something we scripted. A fox at point-blank range triggers panic regardless.
- **…and hear them, warn each other, and dig in.** Rabbits hear further than they can see (7–13 tiles against 6, and camouflage doesn't fool ears — only moving quietly does), **thump an alarm call** that carries the fox's position to rabbits who've spotted nothing themselves, and **dig burrows**: 7 energy each, five rabbits per hole, no fox can reach you and nothing to eat down there. Burrows dug near each other share tunnels, so a rabbit cornered underground can surface somewhere else. Ear size and voice are heritable genes like the fox's, and they drift under pressure — watch them in the Population panel.
- **Water is a skill, not a shortcut.** Both species carry a heritable **swimming** gene, and below a threshold the shoreline is simply a wall — most founders can't get their feet wet. Learn it and a lake becomes crossable at a cost in pace and energy; learn it before the foxes do and it becomes an escape they can't follow you into. Get out of your depth and you flounder for the nearest bank, or drown. Watch the "can swim" count in the Population panel climb (or not) depending on what your island actually rewards.
- **Movement that reads like an animal.** Rabbits hop — an arc off the ground, shadow shrinking underneath, ears sweeping back — and foxes trot with alternating legs and a counterweighting tail. In water they do neither: they ride low with their back end under the surface, bob on their own stroke, and drag ripples and a wake behind them. The simulation still thinks in whole tiles; only the drawing is continuous.
- **Spawn palette** — pick a species, drop 1–10 per click, or scatter them across the island, then watch both populations rise and fall against each other in the Population panel.
- **Works on a phone.** Pinch to zoom, drag to pan, tap a creature to read its brain or its genes. The controls rearrange themselves into a thumb-height tab bar and the panels become bottom sheets (or side panels, held sideways) — same simulation, same detail, just laid out for the screen you're on.

More species and interactions are on the way.

## Contributing

Want to poke at the code, run it locally, or send a pull request? See [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md) for the technical setup, project structure, testing, and deployment details.
