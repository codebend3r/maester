/** How a logo reads: mostly dark, mostly light, or in colours that read on either ground. */
export const LOGO_TONES = { dark: 'dark', light: 'light', mixed: 'mixed' } as const

export type LogoTone = (typeof LOGO_TONES)[keyof typeof LOGO_TONES]

/**
 * How pixels read, as RGBA bytes in a row: by the visible ones' mean
 * lightness, dark under a third, light over two thirds. With none visible,
 * mixed.
 */
export const toneOfPixels = (data: ArrayLike<number>): LogoTone => {
  const { light, weight } = Array.from(
    { length: Math.floor(data.length / 4) },
    (_, pixel) => pixel * 4,
  ).reduce(
    (sum, at) => {
      const alpha = (data[at + 3] ?? 0) / 255
      const lightness =
        (0.2126 * (data[at] ?? 0) + 0.7152 * (data[at + 1] ?? 0) + 0.0722 * (data[at + 2] ?? 0)) /
        255
      return { light: sum.light + lightness * alpha, weight: sum.weight + alpha }
    },
    { light: 0, weight: 0 },
  )
  if (weight <= 0) return LOGO_TONES.mixed
  const mean = light / weight
  if (mean < 1 / 3) return LOGO_TONES.dark
  return mean > 2 / 3 ? LOGO_TONES.light : LOGO_TONES.mixed
}

/**
 * How a loaded logo reads, from a small copy of it. A logo raven cannot
 * read, as where there is no canvas, counts as mixed and is left as drawn.
 */
export const logoTone = (image: HTMLImageElement): LogoTone => {
  const width = 48
  const height = Math.max(
    1,
    Math.round((width * image.naturalHeight) / Math.max(1, image.naturalWidth)),
  )
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) return LOGO_TONES.mixed
  try {
    context.drawImage(image, 0, 0, width, height)
    return toneOfPixels(context.getImageData(0, 0, width, height).data)
  } catch {
    return LOGO_TONES.mixed
  }
}
