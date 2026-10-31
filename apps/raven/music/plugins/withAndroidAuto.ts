import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { type ConfigPlugin, withAndroidManifest, withDangerousMod } from 'expo/config-plugins'

/** The meta-data Android Auto looks for, naming what the app does in the car. */
const CAR_APPLICATION = 'com.google.android.gms.car.application'

const AUTOMOTIVE_DESCRIPTION = 'automotive_app_desc'

/** A media app: Auto browses `@raven/audio`'s `MediaLibraryService`. */
const AUTOMOTIVE_XML = `<?xml version="1.0" encoding="utf-8"?>
<automotiveApp>
  <uses name="media" />
</automotiveApp>
`

const withAutomotiveXml: ConfigPlugin = (config) =>
  withDangerousMod(config, [
    'android',
    async (mod) => {
      const folder = join(mod.modRequest.platformProjectRoot, 'app/src/main/res/xml')
      await mkdir(folder, { recursive: true })
      await writeFile(join(folder, `${AUTOMOTIVE_DESCRIPTION}.xml`), AUTOMOTIVE_XML)
      return mod
    },
  ])

/** Wren in Android Auto: the description, and the meta-data that points Auto at it. */
export const withAndroidAuto: ConfigPlugin = (config) =>
  withAndroidManifest(withAutomotiveXml(config), (mod) => {
    const { manifest } = mod.modResults
    const [main, ...rest] = manifest.application ?? []
    if (main === undefined) return mod
    const carMetaData = {
      $: { 'android:name': CAR_APPLICATION, 'android:resource': `@xml/${AUTOMOTIVE_DESCRIPTION}` },
    }
    const metaData = (main['meta-data'] ?? []).filter(
      ({ $ }) => $['android:name'] !== CAR_APPLICATION,
    )
    const application = [{ ...main, 'meta-data': [...metaData, carMetaData] }, ...rest]
    return { ...mod, modResults: { ...mod.modResults, manifest: { ...manifest, application } } }
  })
