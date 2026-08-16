# Evosim

**An evolution simulator.** Generate a procedural island, drop in a population, and watch it evolve — tile by tile, generation by generation — as it learns to survive whatever the land throws at it.

### 🏝️ [Play the live site → evosim.onrender.com](https://evosim.onrender.com)

No install, no sign-up — it just opens and runs in your browser.

## What's in it right now

- **A new island every time.** Every "Play" generates a fresh, seeded coastline — tune its size, terrain roughness, lake count, and vegetation from Settings.
- **Rabbits** — the first species. Each one is steered by its own small "brain" that decides when to forage, rest, sprint, or reproduce. Energy drains over time, food restores it, and reproduction passes a mutated copy of a rabbit's brain to its offspring — so populations drift and adapt across generations, entirely from selection pressure rather than anything hand-scripted.
- **Foxes** — the predator, and now the other half of the evolutionary loop. A fox has a **body** (heritable dials: speed, vision & nose, camouflage, metabolism, pack instinct, stamina, fecundity) *and* a **brain** — its own neural net deciding when to commit to a chase, when to spend stamina on it, whether to follow a scent to prey it can't see, whether to run with the pack, when to lie up and save energy, and when to turn a full belly into cubs. Click one to see both: the gene bars, the instincts read off its net, and the literal wiring. Every gene costs energy to run, so a fox that's good at everything starves.
- **Foxes hunt by nose as well as by eye.** Sight says where a rabbit is; scent only says roughly which way to walk — and it's the sense that survives the forest canopy, so woodland is where a fox hunts by smell and open ground is where it hunts by sight. A bolting rabbit leaves a hot trail, a still one barely registers, and one underground leaves nothing at all.
- **Both species evolve, and they hold each other in check.** Foxes are long-lived and slow to breed: they can wait out a lean spell lying up on half rations, but territory and a recovery period between litters mean their numbers answer a rabbit boom slowly instead of instantly. Drop five of each and it's a genuinely open question which way the island goes — watch the fox instincts drift in the Population panel as the pack learns what this island rewards.
- **Rabbits can see them coming.** Their brains gained predator inputs and a `flee` output, so bolting early versus holding your nerve is something a lineage evolves, not something we scripted. A fox at point-blank range triggers panic regardless.
- **…and hear them, warn each other, and dig in.** Rabbits hear further than they can see (7–13 tiles against 6, and camouflage doesn't fool ears — only moving quietly does), **thump an alarm call** that carries the fox's position to rabbits who've spotted nothing themselves, and **dig burrows**: 7 energy each, five rabbits per hole, no fox can reach you and nothing to eat down there. Burrows dug near each other share tunnels, so a rabbit cornered underground can surface somewhere else. Ear size and voice are heritable genes like the fox's, and they drift under pressure — watch them in the Population panel.
- **Water is a skill, not a shortcut.** Both species carry a heritable **swimming** gene, and below a threshold the shoreline is simply a wall — most founders can't get their feet wet. Learn it and a lake becomes crossable at a cost in pace and energy; learn it before the foxes do and it becomes an escape they can't follow you into. Get out of your depth and you flounder for the nearest bank, or drown. Watch the "can swim" count in the Population panel climb (or not) depending on what your island actually rewards.
- **Movement that reads like an animal.** Rabbits hop — an arc off the ground, shadow shrinking underneath, ears sweeping back — and foxes trot with alternating legs and a counterweighting tail. In water they do neither: they ride low with their back end under the surface, bob on their own stroke, and drag ripples and a wake behind them. The simulation still thinks in whole tiles; only the drawing is continuous.
- **Spawn palette** — pick a species, drop 1–10 per click, or scatter them across the island, then watch both populations rise and fall against each other in the Population panel.
- **Works on a phone.** Pinch to zoom, drag to pan, tap a creature to read its brain or its genes. The controls rearrange themselves into a thumb-height tab bar and the panels become bottom sheets (or side panels, held sideways) — same simulation, same detail, just laid out for the screen you're on.

More species and interactions are on the way.

## Contributing

Want to poke at the code, run it locally, or send a pull request? See [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md) for the technical setup, project structure, testing, and deployment details.
