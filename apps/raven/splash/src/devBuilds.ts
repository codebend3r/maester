import '@fontsource/young-serif'
import '@fontsource-variable/instrument-sans/wdth.css'
import '@/styles/globals.scss'
import '@/styles/page.scss'
import '@/styles/versions.scss'
import '@/styles/devBuilds.scss'

import { SPLASH_COPY } from '@/copy'
import { CATALOGS } from '@/releases'
import { showVersions } from '@/versionList'

await showVersions({ catalog: CATALOGS.devices, emptyText: SPLASH_COPY.devBuildsFailed })
