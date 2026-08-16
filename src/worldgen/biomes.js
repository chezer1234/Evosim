// What a patch of land *is*, and what that means to something living on it.
//
// Before this the whole world was one climate: moisture alone decided between
// grass, shrub and forest, so every island looked the same and the only thing
// terrain ever said was "there is more cover here". A world big enough to hold
// several separated populations (see islands.js) needs the ground under them
// to differ too - otherwise "the northern island" and "the southern island"
// are the same island twice, and a lineage that migrates arrives somewhere it
// is already adapted to.
//
// So a tile is classified from three fields rather than one: how high it is,
// how wet it is, and how warm it is. Temperature is the new one - it runs
// north-to-south across the world and drops with altitude, which is what puts
// pine and tundra at the top of a big map, savanna and desert at the bottom,
// and snow on anything tall enough anywhere.
//
// Nothing here knows about noise, canvases or the simulation: it is the shared
// vocabulary all three use (mapgen.js generates it, mapgen's renderer draws
// it, and sim/ reads it for cover and food).

/** Sea level in normalized elevation, and how far above it the beach runs.
 *  Shared with mapgen's shoreline rendering, which interpolates between the
 *  two rather than snapping to tiles. */
export const SEA_LEVEL = 0.35
export const BEACH_WIDTH = 0.045

// Tile ids are persisted in a Uint8Array per map and read by the sim, so the
// original six keep their numbers - only additions go on the end.
export const TILE = {
  OCEAN: 0,
  LAKE: 1,
  BEACH: 2,
  GRASS: 3,
  SHRUB: 4,
  FOREST: 5,
  MARSH: 6,
  SAVANNA: 7,
  DESERT: 8,
  TAIGA: 9,
  TUNDRA: 10,
  ROCK: 11,
  SNOW: 12,
}

/**
 * Per-biome display data and, more importantly, what the biome *does*.
 *
 * `cover` is the one the simulation actually reads: it means "a fox has to
 * get closer here, and a rabbit's scent hangs about less" (see
 * FOREST_VISION_FACTOR in sim/fox.js). `fruit` is the share of tiles that can
 * bear an apple - the only food in the world - so it is what makes one biome
 * worth living in and another worth crossing quickly.
 */
export const BIOME = {
  [TILE.OCEAN]: { key: 'ocean', label: 'Ocean', water: true, cover: false, fruit: 0, blurb: 'Open sea. Only a very strong swimmer crosses the shallows between close islands.' },
  [TILE.LAKE]: { key: 'lake', label: 'Lake', water: true, cover: false, fruit: 0, blurb: 'Fresh water. A barrier to anything that cannot swim, and a refuge for anything that can.' },
  [TILE.BEACH]: { key: 'beach', label: 'Beach', color: [196, 178, 140], cover: false, fruit: 0, blurb: 'Bare sand. Nothing grows, and nothing hides.' },
  [TILE.GRASS]: { key: 'grass', label: 'Grassland', color: [120, 150, 90], cover: false, fruit: 0, blurb: 'Open temperate grass. Easy going, and nowhere to hide from a fox.' },
  [TILE.SHRUB]: { key: 'shrub', label: 'Scrub', color: [94, 128, 70], cover: false, fruit: 0.015, blurb: 'Low bushes between the grass and the trees, with the odd berry among them.' },
  [TILE.FOREST]: { key: 'forest', label: 'Forest', color: [58, 96, 56], cover: true, fruit: 0.1, blurb: 'Broadleaf woodland: the apple trees, and the best cover on the map.' },
  [TILE.MARSH]: { key: 'marsh', label: 'Marsh', color: [74, 104, 78], cover: true, fruit: 0.04, blurb: 'Coastal reedbed. Good cover, poor feeding, and it only forms just above the tideline.' },
  [TILE.SAVANNA]: { key: 'savanna', label: 'Savanna', color: [158, 152, 84], cover: false, fruit: 0.03, blurb: 'Hot dry grass with the odd fruiting tree. Sparse feeding and long sightlines.' },
  [TILE.DESERT]: { key: 'desert', label: 'Desert', color: [206, 182, 124], cover: false, fruit: 0, blurb: 'Hot sand. No food, no cover - somewhere to cross, not to live.' },
  [TILE.TAIGA]: { key: 'taiga', label: 'Taiga', color: [52, 84, 68], cover: true, fruit: 0.05, blurb: 'Cold conifer forest. Cover as good as the broadleaf woods, but half the fruit.' },
  [TILE.TUNDRA]: { key: 'tundra', label: 'Tundra', color: [138, 144, 122], cover: false, fruit: 0, blurb: 'Frozen ground and moss. Open, exposed and barren.' },
  [TILE.ROCK]: { key: 'rock', label: 'Rock', color: [126, 122, 116], cover: false, fruit: 0, blurb: 'Bare upland rock above the treeline.' },
  [TILE.SNOW]: { key: 'snow', label: 'Snowfield', color: [228, 234, 242], cover: false, fruit: 0, blurb: 'Permanent snow on the high ground and the far north.' },
}

/** Biomes in the order a legend should list them: wet to dry, cold to hot. */
export const BIOME_ORDER = [
  TILE.OCEAN, TILE.LAKE, TILE.BEACH, TILE.MARSH, TILE.FOREST, TILE.TAIGA,
  TILE.SHRUB, TILE.GRASS, TILE.SAVANNA, TILE.DESERT, TILE.TUNDRA, TILE.ROCK, TILE.SNOW,
]

/** Water of either kind - the two tiles a creature has to be able to swim in. */
export function isWaterType(tile) {
  return tile === TILE.OCEAN || tile === TILE.LAKE
}

/** Tiles that hide a rabbit: a fox sees less far in them and scent lingers
 *  less. The simulation asks this rather than testing for FOREST, so a
 *  lineage that moves north into the pines keeps its cover. */
export function hasCover(tile) {
  return BIOME[tile]?.cover === true
}

/** Share of this biome's tiles that may bear fruit, 0 for most of them. */
export function fruitFraction(tile) {
  return BIOME[tile]?.fruit ?? 0
}

// ------------------------------------------------------------ classification
// Thresholds are in *altitude above the shore* (0 at the beach, 1 at the
// highest ground), not raw elevation, so a low flat island and a mountainous
// one both get their biomes from where the ground is relative to its own
// coast rather than from the map-wide min/max stretch.

const SNOW_ALT = 0.88 // the very tops: bare rock, or snow where it is cold
const ROCK_ALT = 0.76 // treeline: dry or cold ground up here goes bare
const MARSH_ALT = 0.1 // marsh only forms on the flat just above the tideline
const COLD = 0.32
const HOT = 0.68

/**
 * Which land biome sits at a point.
 *
 * @param {number} alt  height above sea level, 0..1 (0 = shoreline)
 * @param {number} moisture 0..1
 * @param {number} temp 0..1 (cold to hot), already including the altitude lapse
 */
export function classifyLand(alt, moisture, temp) {
  if (alt > SNOW_ALT) return temp < 0.42 ? TILE.SNOW : TILE.ROCK
  if (alt > ROCK_ALT) {
    if (temp < COLD) return TILE.SNOW
    if (moisture < 0.45 || temp > HOT) return TILE.ROCK
  }
  if (alt < MARSH_ALT && moisture > 0.62 && temp >= COLD) return TILE.MARSH
  if (temp < COLD) return moisture > 0.45 ? TILE.TAIGA : TILE.TUNDRA
  if (temp > HOT) {
    if (moisture > 0.62) return TILE.FOREST
    if (moisture > 0.36) return TILE.SAVANNA
    return TILE.DESERT
  }
  if (moisture > 0.55) return TILE.FOREST
  if (moisture > 0.35) return TILE.SHRUB
  return TILE.GRASS
}

/**
 * Temperature at a tile: a north-south gradient, softened or exaggerated by
 * the world's `climate` setting, plus a regional wobble and the drop with
 * altitude that puts snow on any tall enough peak.
 *
 * At climate 0 the whole world sits at one temperate value and biomes come
 * from moisture alone - i.e. exactly the old behaviour. At 1 the top of the
 * map is arctic and the bottom is desert.
 */
export function temperatureAt(latitude, regional, alt, climate) {
  const band = 0.5 + (latitude - 0.5) * climate
  // The lapse is measured against mid-altitude rather than sea level, so
  // raising it cools the mountains without quietly freezing the whole world:
  // the lowlands keep the temperature their latitude says they should have.
  return band + (regional - 0.5) * 0.3 * climate - (Math.max(0, alt) - 0.35) * 0.28
}
