const SIX_DIGIT_HEX = /^#[\da-f]{6}$/i

type TranslucentProps = { colour: string; alpha: number }

/**
 * `colour` at `alpha` (0 to 1) as an eight digit hex, which React Native takes. Every theme's
 * palette is six digit hex; a colour that is not one (already translucent) is returned as it is.
 */
export const translucent = ({ colour, alpha }: TranslucentProps): string => {
  if (!SIX_DIGIT_HEX.test(colour)) return colour
  const byte = Math.round(Math.min(Math.max(alpha, 0), 1) * 255)
  return `${colour}${byte.toString(16).padStart(2, '0')}`
}
