/**
 * Gridfinity dimensions.
 *
 * Values follow the community spec (https://gridfinity.xyz/specification/) as
 * implemented by gridfinity-rebuilt-openscad (MIT), which is the de-facto
 * reference most generators agree with.
 */

/** Grid pitch in mm (X and Y). */
export const GRID = 42;
/** One height unit ("u") in mm. */
export const HEIGHT_UNIT = 7;

// ---------------------------------------------------------------------------
// Bin base
// ---------------------------------------------------------------------------

/** Footprint of one bin base unit at its widest point. 0.5 mm smaller than the grid. */
export const BASE_TOP = 41.5;
/** Corner radius at the top of each base unit. */
export const BASE_TOP_RADIUS = 3.75;
/** Base profile from the bottom: 45° chamfer, vertical, 45° chamfer. */
export const BASE_PROFILE = { chamfer1: 0.8, vertical: 1.8, chamfer2: 2.15 } as const;
export const BASE_PROFILE_HEIGHT =
  BASE_PROFILE.chamfer1 + BASE_PROFILE.vertical + BASE_PROFILE.chamfer2; // 4.75
/** Horizontal depth of the base profile (how far the bottom is inset from the top). */
export const BASE_PROFILE_DEPTH = BASE_PROFILE.chamfer1 + BASE_PROFILE.chamfer2; // 2.95
/** Height of the base including the bridge that ties units together = top of the floor. */
export const BASE_HEIGHT = 7;

// ---------------------------------------------------------------------------
// Bin body
// ---------------------------------------------------------------------------

export const WALL = 0.95;
export const DIVIDER = 1.2;
/** Interior corner radius; equals BASE_TOP_RADIUS - WALL so walls stay uniform. */
export const INNER_RADIUS = BASE_TOP_RADIUS - WALL; // 2.8

/** Stacking lip profile from the inner tip upward: 45° out, vertical, 45° out. */
export const LIP_PROFILE = { chamfer1: 0.7, vertical: 1.8, chamfer2: 1.9 } as const;
export const LIP_HEIGHT = LIP_PROFILE.chamfer1 + LIP_PROFILE.vertical + LIP_PROFILE.chamfer2; // 4.4
export const LIP_DEPTH = LIP_PROFILE.chamfer1 + LIP_PROFILE.chamfer2; // 2.6
/** Vertical section under the lip's inner tip so it isn't a knife edge. */
export const LIP_SUPPORT_HEIGHT = 1.2;
/** Flat left on top of the lip instead of a knife edge (mm, horizontal). */
export const LIP_TOP_FLAT = 0.4;

/** Label tab (gridfinity-rebuilt defaults). */
export const TAB_DEPTH = 15.85;
export const TAB_SUPPORT_ANGLE_DEG = 36;
export const TAB_TIP_HEIGHT = 1.2;
export const TAB_WIDTH_NOMINAL = 42;

// ---------------------------------------------------------------------------
// Holes
// ---------------------------------------------------------------------------

export const MAGNET_HOLE_DIAMETER = 6.5;
export const MAGNET_HOLE_DEPTH = 2.4;
export const SCREW_HOLE_DIAMETER = 3;
export const SCREW_HOLE_DEPTH = 6;
/** Hole centers are 8 mm in from the bin edge => 13 mm from the cell center. */
export const HOLE_OFFSET = GRID / 2 - 8;

// ---------------------------------------------------------------------------
// Baseplate
// ---------------------------------------------------------------------------

/** Baseplate receptacle profile from the bottom: 45° chamfer, vertical, 45° chamfer. */
export const BP_PROFILE = { chamfer1: 0.7, vertical: 1.8, chamfer2: 2.15 } as const;
export const BP_PROFILE_HEIGHT = BP_PROFILE.chamfer1 + BP_PROFILE.vertical + BP_PROFILE.chamfer2; // 4.65
export const BP_PROFILE_DEPTH = BP_PROFILE.chamfer1 + BP_PROFILE.chamfer2; // 2.85
/**
 * Vertical clearance below the profile so a seated bin's chamfers actually
 * touch the baseplate's chamfers (spec baseplate height = 4.65 + 0.35 = 5).
 */
export const BP_BOTTOM_CLEARANCE = 0.35;
/** Outer corner radius of a baseplate cell (top of the receptacle). */
export const BP_CELL_RADIUS = 4;

// ---------------------------------------------------------------------------
// Connectors (bowtie keys that lock split baseplate pieces together)
// ---------------------------------------------------------------------------

/**
 * Bowtie pocket cut into the bottom of the baseplate, centered on a seam and
 * spanning across it. Walls are 4.3 mm wide in the vertical band of the
 * profile, so a 3 mm pocket leaves 0.65 mm on each side.
 */
export const BOWTIE = {
  /** Across the seam, half in each piece. */
  length: 10,
  /** Width at the two ends. */
  width: 3,
  /** Width at the seam. */
  neck: 1.6,
  /** Pocket depth from the bottom of the baseplate. */
  depth: 2,
  /** 45° flare at the pocket mouth so elephant foot doesn't close it up. */
  mouthChamfer: 0.4,
} as const;
/** Keys are this much smaller than the pocket on every side. */
export const BOWTIE_CLEARANCE = 0.15;
/** Keys are this much thinner than the pocket is deep, so the plate still sits flat. */
export const BOWTIE_KEY_RECESS = 0.2;
/** 45° chamfer on the key's bottom edges (elephant-foot relief). */
export const BOWTIE_KEY_CHAMFER = 0.3;
/** Thinnest wall left between a pocket and a receptacle or an outside edge. */
export const CONNECTOR_MIN_WALL = 0.6;
/** One connector per this much length of solid margin along a seam. */
export const CONNECTOR_SPACING = GRID;
