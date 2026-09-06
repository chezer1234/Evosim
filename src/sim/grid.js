// A uniform spatial grid: the index that turns "the nearest thing within R"
// from a walk over every creature in the world into a walk over the handful
// standing nearby.
//
// Every per-tick sense in the simulation has that shape - a rabbit listening
// for alarm calls, a fox looking for prey or smelling for it, a fish
// checking whether a fox is close - and doing each of them by scanning the
// whole population made the sim quadratic in exactly the situation most
// worth watching: a prey boom (issue #21). At the tens of creatures normal
// play produces that cost nothing; at a few hundred rabbits `hearCalls`
// alone is tens of thousands of distance checks five times a second.
//
// The structure is the simplest one that fixes it. The map is cut into
// square buckets of CELL tiles, each creature lives in the bucket its tile
// falls in, and a query visits only the buckets overlapping its search box.
// There is no tree to rebalance and no per-tick rebuild: creatures move one
// tile at a time, so a step is at worst a pop from one bucket and a push to
// another.
//
// Three rules make it safe to rely on, and all three fail the same quiet
// way: not with an exception, but with a fox that cannot see a rabbit
// standing next to it.
//
//   - Every write to a creature's x/y must be followed by gridMoved(), or
//     the index silently disagrees with the world. In the simulation that is
//     enforced by funnelling all of them through one helper (moveCreature in
//     ./simulation.js).
//   - A visitor passed to forEachWithin() must not insert into or remove
//     from the grid it is walking. Marking a creature dead is fine - the
//     queries all check `alive` and the dead are swept out at the end of the
//     tick - but a spawn or a step during a visit is not.
//   - The radius handed to a query must be an upper bound on what that query
//     can actually reach. Half the senses here have a range that depends on
//     the candidate as much as the searcher, so their bound is *derived* -
//     the loudest voice the gene pool allows, the strongest a rabbit can
//     smell - and a derived bound is a promise about the range of its
//     inputs. Bounds over a gene are safe on their own: genes are clamped to
//     0..1 at birth and at every mutation, so HEARING_TILES[1] and its
//     kind are ceilings nothing can lift. A bound over a plain *constant* is
//     only safe while it stays constant. If a distance ever becomes
//     configurable - a per-run rule, a difficulty setting, a slider - every
//     query that searched on the old value has to search on the new one too,
//     or it quietly stops reaching the far half of the range. Distances are
//     the only dial with this problem; an energy, a duration or a
//     probability cannot shrink a search box.
//
// Buckets are unordered (removal swaps the last entry into the hole), so
// callers that used to depend on array order - "the first rabbit in range",
// "the nearest, ties going to the earlier one" - must break ties on `id`
// instead. Creature ids ascend with spawn order and the death sweep is
// order-preserving, so lowest-id *is* first-in-array-order, and the queries
// come out identical rather than merely equivalent.

// Tiles per bucket. The sim's search radii run from 1 tile (a pounce) to a
// couple of dozen (a fox's territory), so no single size is ideal for all of
// them; 8 keeps
// the common senses - 6 to 14 tiles - down to a handful of buckets without
// making the pounce scan a quarter of the island.
const CELL = 8

/** An empty grid covering a `size` x `size` tile map. */
export function createGrid(size, cell = CELL) {
  const cols = Math.max(1, Math.ceil(size / cell))
  const cells = new Array(cols * cols)
  for (let i = 0; i < cells.length; i++) cells[i] = []
  return { cell, cols, cells }
}

function cellIndex(grid, x, y) {
  const cx = Math.min(grid.cols - 1, Math.max(0, Math.floor(x / grid.cell)))
  const cy = Math.min(grid.cols - 1, Math.max(0, Math.floor(y / grid.cell)))
  return cy * grid.cols + cx
}

/** Add a creature at its current tile. Stamps the bookkeeping (`gridCell`,
 * `gridSlot`) it needs to be removed again in constant time. */
export function gridInsert(grid, entity) {
  const index = cellIndex(grid, entity.x, entity.y)
  const bucket = grid.cells[index]
  entity.gridCell = index
  entity.gridSlot = bucket.length
  bucket.push(entity)
}

/** Take a creature out. Swap-and-pop: the last entry fills the hole, which
 * is why bucket order is not a thing callers may rely on. */
export function gridRemove(grid, entity) {
  if (entity.gridCell < 0) return
  const bucket = grid.cells[entity.gridCell]
  const last = bucket.pop()
  if (last !== entity) {
    bucket[entity.gridSlot] = last
    last.gridSlot = entity.gridSlot
  }
  entity.gridCell = -1
  entity.gridSlot = -1
}

/** Call after writing a creature's x/y. Cheap when the step stayed inside
 * the same bucket, which - at 8 tiles a side and one tile a step - is most
 * of the time. */
export function gridMoved(grid, entity) {
  if (cellIndex(grid, entity.x, entity.y) === entity.gridCell) return
  gridRemove(grid, entity)
  gridInsert(grid, entity)
}

/** Refill the grid from `list`, discarding whatever was in it. Used once a
 * tick after the dead are swept out, where rebuilding is simpler than
 * unpicking each corpse and costs the same O(n) the sweep already spent. */
export function gridRebuild(grid, list) {
  for (const bucket of grid.cells) bucket.length = 0
  for (const entity of list) gridInsert(grid, entity)
}

/**
 * True as soon as any creature near (x, y) satisfies `test`, false if none
 * does. The short-circuiting sibling of forEachWithin, for the questions
 * that only want a yes or a no - is there a fox on this burrow mouth, is
 * another fox already denning here - where walking the rest of the
 * neighbourhood after the first hit is wasted work.
 */
export function someWithin(grid, x, y, radius, test) {
  const { cell, cols, cells } = grid
  const minX = Math.max(0, Math.floor((x - radius) / cell))
  const maxX = Math.min(cols - 1, Math.floor((x + radius) / cell))
  const minY = Math.max(0, Math.floor((y - radius) / cell))
  const maxY = Math.min(cols - 1, Math.floor((y + radius) / cell))
  for (let cy = minY; cy <= maxY; cy++) {
    const row = cy * cols
    for (let cx = minX; cx <= maxX; cx++) {
      const bucket = cells[row + cx]
      for (let i = 0; i < bucket.length; i++) if (test(bucket[i])) return true
    }
  }
  return false
}

/**
 * Visit every creature in the buckets overlapping the square of side 2*r
 * centred on (x, y).
 *
 * Deliberately a *superset* of what the caller wants: it does no distance
 * test of its own, because each caller's test is different - a circle for
 * most senses, that same square for a pounce, and several where the usable
 * range depends on the candidate as much as the searcher (how loud the
 * caller is, how strongly the rabbit smells). Keeping the filter at the call
 * site is what makes this a drop-in replacement for the loops it replaces,
 * with the same arithmetic in the same order per candidate.
 */
export function forEachWithin(grid, x, y, radius, visit) {
  const { cell, cols, cells } = grid
  const minX = Math.max(0, Math.floor((x - radius) / cell))
  const maxX = Math.min(cols - 1, Math.floor((x + radius) / cell))
  const minY = Math.max(0, Math.floor((y - radius) / cell))
  const maxY = Math.min(cols - 1, Math.floor((y + radius) / cell))
  for (let cy = minY; cy <= maxY; cy++) {
    const row = cy * cols
    for (let cx = minX; cx <= maxX; cx++) {
      const bucket = cells[row + cx]
      for (let i = 0; i < bucket.length; i++) visit(bucket[i])
    }
  }
}
