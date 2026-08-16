# Evosim

**An evolution simulator.** Generate a procedural island, drop in a population, and watch it evolve — tile by tile, generation by generation — as it learns to survive whatever the land throws at it.

### 🏝️ [Play the live site → evosim.onrender.com](https://evosim.onrender.com)

No install, no sign-up — it just opens and runs in your browser.

## What's in it right now

- **A new island every time.** Every "Play" generates a fresh, seeded coastline — tune its size, terrain roughness, lake count, and vegetation from Settings.
- **Rabbits** — the first species. Each one is steered by its own small "brain" that decides when to forage, rest, sprint, or reproduce. Energy drains over time, food restores it, and reproduction passes a mutated copy of a rabbit's brain to its offspring — so populations drift and adapt across generations, entirely from selection pressure rather than anything hand-scripted.

More species and interactions are on the way.

## Contributing

Want to poke at the code, run it locally, or send a pull request? See [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md) for the technical setup, project structure, testing, and deployment details.
