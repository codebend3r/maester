import { Platform } from 'react-native'

/**
 * The web's fonts, bundled on Android as `assets/fonts` (the family is the file's name, and
 * React Native finds its bold in `InstrumentSans_bold.ttf`). Other platforms keep the system's
 * until their fonts are bundled, so a family is undefined there.
 */
const FAMILIES = { body: 'InstrumentSans', display: 'YoungSerif' } as const

const isBundled = Platform.OS === 'android'

export const BODY_FONT = isBundled ? FAMILIES.body : undefined

export const DISPLAY_FONT = isBundled ? FAMILIES.display : undefined
