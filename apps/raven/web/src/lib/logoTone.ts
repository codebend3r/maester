/**
 * Whether a loaded logo is mostly dark, its visible pixels' mean lightness
 * under a third, read from a small copy of it. A logo raven cannot read, as
 * where there is no canvas, counts as light.
 */
export const isDarkLogo = (image: HTMLImageElement): boolean => {
  const width = 48
  const height = Math.max(
    1,
    Math.round((width * image.naturalHeight) / Math.max(1, image.naturalWidth)),
  )
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) return false
  try {
    context.drawImage(image, 0, 0, width, height)
    const { data } = context.getImageData(0, 0, width, height)
    const { light, weight } = Array.from(
      { length: data.length / 4 },
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
    return weight > 0 && light / weight < 1 / 3
  } catch {
    return false
  }
}
