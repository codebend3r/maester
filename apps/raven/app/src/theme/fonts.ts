import { Platform } from 'react-native'

/**
 * The web's fonts. Android bundles them as `assets/fonts`, where the family is the file's name
 * and React Native finds its bold in `InstrumentSans_bold.ttf`. Apple bundles only Young Serif
 * (`expo-font`'s plugin in `app.config.ts`), under the family name inside the file; its body
 * text keeps the system's until Instrument Sans is bundled there too.
 */
const FAMILIES = {
  body: 'InstrumentSans',
  displayAndroid: 'YoungSerif',
  displayApple: 'Young Serif',
} as const

const isAndroid = Platform.OS === 'android'

export const BODY_FONT = isAndroid ? FAMILIES.body : undefined

export const DISPLAY_FONT = isAndroid ? FAMILIES.displayAndroid : FAMILIES.displayApple
