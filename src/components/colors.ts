/** Distinct hues for baseplate pieces (cycled). */
const PIECE_COLORS = ['#e9a23b', '#5aa9e6', '#7fc98f', '#e57373', '#b39ddb', '#f0d06b', '#4fc3c3', '#f29b7a', '#9ccc65', '#90a4ae'];

export function pieceColor(id: number) {
  return PIECE_COLORS[(id - 1) % PIECE_COLORS.length];
}

export const BASEPLATE_COLOR = '#8b94a3';
export const BIN_COLOR = '#d7dce3';
export const KEY_COLOR = '#5f6b7a';
