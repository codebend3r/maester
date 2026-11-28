import { encode } from 'uqr'

/** A QR code as one SVG path over a square of `size` units, a unit a module, with no quiet zone. */
export type QrDrawing = { size: number; path: string }

/**
 * The QR code holding `value`, at the middle error correction level: a TV shows it large and
 * clean, so the smaller, coarser code that level gives scans from farther off than a denser one.
 */
export const qrDrawingOf = (value: string): QrDrawing => {
  const { size, data } = encode(value, { ecc: 'M', border: 0 })
  const path = data
    .flatMap((row, y) => row.map((isDark, x) => (isDark ? `M${x} ${y}h1v1h-1z` : '')))
    .join('')
  return { size, path }
}
