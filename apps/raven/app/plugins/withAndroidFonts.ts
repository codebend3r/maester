import { copyFileSync, mkdirSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import { type ConfigPlugin, withDangerousMod } from 'expo/config-plugins'

const FONTS = {
  source: join('assets', 'fonts'),
  target: join('app', 'src', 'main', 'assets', 'fonts'),
  extension: '.ttf',
} as const

/**
 * Puts the web's fonts in the Android project's assets, where React Native finds a family by
 * its file name: `InstrumentSans.ttf` is the family and `InstrumentSans_bold.ttf` its bold.
 */
export const withAndroidFonts: ConfigPlugin = (config) =>
  withDangerousMod(config, [
    'android',
    (mod) => {
      const source = join(mod.modRequest.projectRoot, FONTS.source)
      const target = join(mod.modRequest.platformProjectRoot, FONTS.target)
      mkdirSync(target, { recursive: true })
      readdirSync(source)
        .filter((file) => file.endsWith(FONTS.extension))
        .forEach((file) => copyFileSync(join(source, file), join(target, file)))
      return mod
    },
  ])
