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
// Baseplate styles (gridfinity-rebuilt-openscad baseplate styles)
// ---------------------------------------------------------------------------

/** Floor of a 'solid' or 'skeletonized' plate when nothing else asks for more (Rebuilt h_skel). */
export const BP_MIN_FLOOR = 1;

/**
 * Weighted baseplate (Rebuilt bp_h_bot / bp_cut_* / bp_rcut_*): a 6.4 mm floor
 * with a square weight pocket under each cell and four rounded channels from it.
 */
export const WEIGHTED = {
  floor: 6.4,
  /** Square pocket in the middle of each cell. */
  pocket: 21.4,
  pocketDepth: 4,
  /** Channels toward the four cell edges: width, straight length, depth. */
  channelWidth: 8.5,
  channelLength: 4.25,
  channelDepth: 2,
  /** Distance from the cell center to the middle of a channel's straight part. */
  channelAt: 10,
} as const;

/**
 * Skeletonized baseplate (Rebuilt profile_skeleton): the floor is cut through
 * between the corner bosses that hold the magnets and screws.
 */
export const SKELETON = {
  /** Rounding of the cut's outside corners. */
  radius: 2,
  /** Boss material left around the largest hole at each corner. */
  boss: 2,
} as const;

// ---------------------------------------------------------------------------
// Magnet pocket extras
// ---------------------------------------------------------------------------

/** Press-fit ribs inside the pocket (Rebuilt crush_ribs: 8 ribs, 5.9 mm inner for a 6 mm magnet). */
export const CRUSH_RIBS = {
  count: 8,
  /** Rib tips sit this far inside the magnet's radius. */
  squeeze: 0.05,
  /** Rib roots sit at least this far outside the magnet's radius. */
  relief: 0.25,
} as const;
/** 45° chamfer at the pocket mouth (Rebuilt CHAMFER_ADDITIONAL_RADIUS). */
export const MAGNET_CHAMFER = 0.8;
/** Side slot to pry a magnet out (toward the cell center): width, and reach past the pocket wall. */
export const MAGNET_SLOT = { width: 2, reach: 2.5 } as const;

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

/**
 * Filament pins: horizontal holes across a seam for pins cut from 1.75 mm
 * filament. Each hole runs half the pin length into each piece and sits in the
 * vertical band of the wall (4.3 mm wide), centered `z` above the receptacle's
 * bottom clearance.
 */
export const PIN = {
  hole: 1.9,
  /** Total hole length across the seam; cut pins 0.5 mm shorter. */
  length: 16,
  z: 1.6,
} as const;

/**
 * Puzzle tabs: a jigsaw knob on the left / front piece of a seam, with a
 * matching socket (with clearance) in the piece across it. They sit in the
 * wall that crosses the seam, from the bottom up to just below the top of the
 * wall's vertical band; the socket is open underneath, so the neighbor is
 * lowered onto the tab.
 */
export const PUZZLE = {
  neck: 1.8,
  /** Round head: diameter, and its center's distance from the seam. */
  head: 2.8,
  headAt: 3.2,
  /** Clearance around the tab, per side. */
  gap: 0.15,
  /** How far the tab reaches back into its own piece, so the two fuse. */
  overlap: 0.5,
  /** Space between the tab top and the socket ceiling, and between the ceiling and the band top. */
  topGap: 0.2,
} as const;
/** How far a puzzle tab sticks out past its piece's edge. */
export const PUZZLE_PROTRUSION = PUZZLE.headAt + PUZZLE.head / 2;

/**
 * Screw-together joints (after Rebuilt's "screw together" baseplate): a
 * horizontal M3 hole across the seam, 3 mm above the bottom, with a head slot
 * in one piece and a hex-nut slot (or a heat-set insert hole) in the other.
 * Both slots are open underneath. Needs a 7 mm floor, which is enforced.
 */
export const SCREW_JOIN = {
  floor: 7,
  z: 3,
  hole: 3.4,
  /** Material between each slot and the seam. */
  seat: 3.5,
  /** Head slot: width, length (an M3×10 and its head drop in), height above the hole axis. */
  headWidth: 6,
  headLength: 14,
  headTop: 3,
  /** Hex nut slot (M3: 5.5 mm across flats, 2.4 thick, corners up). */
  nutWidth: 5.9,
  nutThick: 2.8,
  nutTop: 3.4,
  /** Hole past the nut for the screw tip. */
  tip: 2.5,
  /** Heat-set insert hole from the seam face. */
  insertHole: 4,
  insertLength: 7,
  screw: 'M3×10',
} as const;

// ---------------------------------------------------------------------------
// Piece numbers (debossed on the underside)
// ---------------------------------------------------------------------------

export const PIECE_NUMBER = {
  /** Digit heights to try, largest first (the smallest fits a wall's underside); stroke = height / 6. */
  heights: [10, 6, 3.6],
  depth: 0.4,
  /** Solid material kept around the digits. */
  margin: 0.8,
} as const;
