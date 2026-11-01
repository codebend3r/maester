import { Platform } from 'react-native'

/**
 * The web's two faces, as `--font-display` and `--font-body` set them: Young Serif for display
 * text (headings, titles, big letters) and Instrument Sans for everything that runs on or is
 * interface chrome. Both platforms bundle both natively, so they are there at the first frame
 * and nothing waits for them: Android copies `assets/fonts` into its project, where the family
 * is the file's name (`withAndroidFonts`; `InstrumentSans_bold.ttf` is the body's bold), and
 * Apple registers the files through `expo-font`'s plugin in `app.config.ts`, under the family
 * name inside each. Young Serif has a single regular weight, so display text never asks for bold
 * (see `Text`).
 */
const FAMILIES = {
  android: { body: 'InstrumentSans', display: 'YoungSerif' },
  apple: { body: 'Instrument Sans', display: 'Young Serif' },
} as const

const families = Platform.OS === 'android' ? FAMILIES.android : FAMILIES.apple

export const BODY_FONT = families.body

export const DISPLAY_FONT = families.display
