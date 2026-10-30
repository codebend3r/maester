import { copyFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

import { type ConfigPlugin, withDangerousMod } from 'expo/config-plugins'

/** Android's density folders, and the banner `scripts/tv_banner.sh` draws for each. */
const DENSITIES = ['mdpi', 'hdpi', 'xhdpi', 'xxhdpi', 'xxxhdpi'] as const

const BANNER = 'tv_banner.png'
const BANNERS_FOLDER = join('assets', 'images', 'tv_banner')
const RESOURCES = join('app', 'src', 'main', 'res')

/**
 * Puts the banner drawn for each density in its `drawable-<density>` folder. config-tv copies
 * the one 320 by 180 file into every folder, which a launcher then scales up; this runs after
 * it (it is applied before the plugins list, and the last mod added runs first), so each
 * density gets its own.
 */
export const withTvBannerDensities: ConfigPlugin = (config) =>
  withDangerousMod(config, [
    'android',
    (modded) => {
      const resources = join(modded.modRequest.platformProjectRoot, RESOURCES)
      DENSITIES.map((density) => {
        const folder = join(resources, `drawable-${density}`)
        mkdirSync(folder, { recursive: true })
        copyFileSync(
          join(modded.modRequest.projectRoot, BANNERS_FOLDER, `${density}.png`),
          join(folder, BANNER),
        )
        return folder
      })
      return modded
    },
  ])
