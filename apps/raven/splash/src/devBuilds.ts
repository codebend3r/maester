import '@/pageBase'
import '@/styles/versions.scss'
import '@/styles/devBuilds.scss'

import { SPLASH_COPY } from '@/copy'
import { CATALOGS } from '@/releases'
import { showVersions } from '@/versionList'

await showVersions({ catalogs: Object.values(CATALOGS), emptyText: SPLASH_COPY.devBuildsFailed })
