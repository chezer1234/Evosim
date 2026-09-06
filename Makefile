# Evosim task runner. Thin wrappers over the npm scripts, so there is one
# obvious command for each thing you might want to do and `make check` runs
# exactly what CI runs.
#
# Balance work has its own targets: `make ecosystem` runs the real
# simulation headlessly across a batch of seeded islands and prints what
# happened to each species. Use it (not the app, and not intuition) to judge
# anything that touches energy, breeding or the senses - see
# docs/DEVELOPMENT.md.

.DEFAULT_GOAL := help
.PHONY: help install dev build preview lint test test-watch check ecosystem ecosystem-scatter ecosystem-boom ecosystem-shore ecosystem-full ecosystem-presets ecosystem-json

help: ## Show this help
	@grep -hE '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-20s\033[0m %s\n", $$1, $$2}'

install: ## Install dependencies
	npm install

dev: ## Run the dev server (http://localhost:5173)
	npm run dev

build: ## Production build into dist/
	npm run build

preview: ## Serve the production build
	npm run preview

lint: ## Lint with oxlint
	npm run lint

test: ## Run the test suite once (what CI runs)
	npm test

test-watch: ## Run the test suite in watch mode
	npm run test:watch

check: lint test build ## Everything CI does: lint, test, build

# ---------------------------------------------------------------- balance --
# Every run is seeded, so these are reproducible: the same target on the same
# commit always prints the same numbers, and two branches can be compared on
# identical islands.

ecosystem: ## Headless balance run (defaults: 5 rabbits, 5 foxes, 15 min, 8 seeds)
	npm run ecosystem

ecosystem-scatter: ## The default scatter scenario, 20 seeds - the headline balance number
	npm run ecosystem -- --rabbits 5 --foxes 5 --minutes 15 --runs 20

ecosystem-boom: ## A heavier prey seeding, where predators can overshoot
	npm run ecosystem -- --rabbits 20 --foxes 5 --minutes 20 --runs 12

ecosystem-shore: ## Foxes, fish and crabs and no rabbits at all - can a pack live off the water's edge?
	npm run ecosystem -- --rabbits 0 --foxes 4 --fish 25 --crabs 25 --minutes 15 --runs 8

ecosystem-full: ## All four species together: the whole food web on one island
	npm run ecosystem -- --rabbits 8 --foxes 4 --fish 25 --crabs 25 --minutes 15 --runs 8

ecosystem-presets: ## Every starting-conditions preset (issue #18) on identical seeds
	@for preset in balanced predator boom fast; do \
		npm run --silent ecosystem -- --preset $$preset --rabbits 8 --foxes 4 --minutes 12 --runs 8 | tail -6; \
		echo; \
	done

ecosystem-json: ## Machine-readable summary, for diffing two branches
	@npm run --silent ecosystem -- --json
