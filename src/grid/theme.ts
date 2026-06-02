// Visual tokens for the canvas renderer (tech-design §13): colours, font, and the
// handful of pixel constants that were previously magic numbers scattered through
// `render()`. Naming them once documents intent and gives a single place to retune.

export const COLORS = {
  cellText: '#1a1a1a',
  gridline: '#e3e3e3',
  gutterBg: '#f6f6f6',
  gutterText: '#555',
  gutterBorder: '#cfcfcf',
  accent: '#1a73e8', // active-cell outline + active header
  accentBg: '#e8f0fe', // active header background
  flatBg: '#fef7e0', // subtle tint marking a fiber-covered cell (§13)
  pageBg: '#fff',
} as const;

export const FONT = '13px system-ui, -apple-system, sans-serif';

/** Left inset from a cell's edge to where its text starts. */
export const CELL_PAD_X = 6;

/** The active-cell outline: stroked `inset` px inside the cell so the 2px-wide ring
 *  reads as sitting just within the gridlines rather than straddling them. */
export const ACTIVE_OUTLINE = { inset: 1, width: 2 } as const;
