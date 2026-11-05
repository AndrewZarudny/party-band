// Layout math for the whole-lesson overview. Pure: no DOM.

export interface OvBar {
  bar: number
  row: number
  x: number
  w: number
}
export interface OvLayout {
  barsPerRow: number
  rowH: number
  bars: OvBar[]
  rows: number
  width: number
  height: number
}

export const OV_ROW_H = 112
export const OV_PAD = 8

/** Bars in rows: 4 per row from 720 px, 3 from 520 px, else 2. Equal widths, 8 px side padding. */
export function overviewLayout(bars: number, width: number): OvLayout {
  const barsPerRow = width >= 720 ? 4 : width >= 520 ? 3 : 2
  const w = Math.max(0, (width - 2 * OV_PAD) / barsPerRow)
  const out: OvBar[] = []
  for (let i = 0; i < bars; i++) {
    out.push({ bar: i, row: Math.floor(i / barsPerRow), x: OV_PAD + (i % barsPerRow) * w, w })
  }
  const rows = Math.ceil(bars / barsPerRow)
  return { barsPerRow, rowH: OV_ROW_H, bars: out, rows, width, height: rows * OV_ROW_H }
}

/** Where a chart beat sits: its row and x. Beats outside the chart are clamped to its ends. */
export function beatToPoint(l: OvLayout, beat: number): { row: number; x: number } {
  if (!l.bars.length) return { row: 0, x: OV_PAD }
  const total = l.bars.length * 4
  const b = Math.max(0, Math.min(total, beat))
  const i = Math.min(l.bars.length - 1, Math.floor(b / 4))
  const bar = l.bars[i]
  const inBar = b - i * 4
  return { row: bar.row, x: bar.x + 10 + (inBar / 4) * (bar.w - 16) }
}

/** The bar under a point, or null in the side gutters and below the last row. */
export function barAt(l: OvLayout, x: number, y: number): number | null {
  if (y < 0 || x < 0) return null
  const row = Math.floor(y / l.rowH)
  if (row >= l.rows) return null
  for (const b of l.bars) {
    if (b.row === row && x >= b.x && x < b.x + b.w) return b.bar
  }
  return null
}
