import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import {
  type AndroidConfig,
  type ConfigPlugin,
  withAndroidManifest,
  withDangerousMod,
} from 'expo/config-plugins'

/** The meta-data Android Auto looks for, naming what the app does in the car. */
const CAR_APPLICATION = 'com.google.android.gms.car.application'

const MANIFEST_KEYS = {
  metaData: 'meta-data',
  name: 'android:name',
  resource: 'android:resource',
} as const

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

type ManifestApplication = AndroidConfig.Manifest.ManifestApplication

/** The application with the car's meta-data, held once, whatever it already had. */
export const withCarMetaData = (application: ManifestApplication): ManifestApplication => {
  const carMetaData = {
    $: {
      [MANIFEST_KEYS.name]: CAR_APPLICATION,
      [MANIFEST_KEYS.resource]: `@xml/${AUTOMOTIVE_DESCRIPTION}`,
    },
  }
  const metaData = (application[MANIFEST_KEYS.metaData] ?? []).filter(
    ({ $ }) => $[MANIFEST_KEYS.name] !== CAR_APPLICATION,
  )
  return { ...application, [MANIFEST_KEYS.metaData]: [...metaData, carMetaData] }
}

/** Wren in Android Auto: the description, and the meta-data that points Auto at it. */
export const withAndroidAuto: ConfigPlugin = (config) =>
  withAndroidManifest(withAutomotiveXml(config), (mod) => {
    const { manifest } = mod.modResults
    const [main, ...rest] = manifest.application ?? []
    if (main === undefined) return mod
    const application = [withCarMetaData(main), ...rest]
    return { ...mod, modResults: { ...mod.modResults, manifest: { ...manifest, application } } }
  })
