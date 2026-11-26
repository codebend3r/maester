/*
 * Wren's two faces, by PostScript name, the phone app's own files. Each file is named by its
 * face's PostScript name, which is the family on both platforms: tvOS finds a face by its
 * PostScript name and Android TV by its file, so each weight is a family and no style sets
 * `fontWeight`. app.config.ts reads this file by relative path, so it imports nothing.
 */

export const FONTS = {
  display: 'YoungSerif-Regular',
  body: 'InstrumentSans-Regular',
  bodyMedium: 'InstrumentSans-Medium',
  bodySemiBold: 'InstrumentSans-SemiBold',
} as const

/** The font files app.config.ts embeds, one per face, from the phone app's `assets/fonts`. */
export const FONT_FILES = Object.values(FONTS).map((face) => `../wren-app/assets/fonts/${face}.ttf`)
