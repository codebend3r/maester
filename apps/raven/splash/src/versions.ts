import '@/pageBase'
import '@/styles/versions.scss'

import { SPLASH_COPY } from '@/copy'
import { CATALOGS } from '@/releases'
import { showVersions } from '@/versionList'

await showVersions({ catalogs: [CATALOGS.desktop], emptyText: SPLASH_COPY.versionsFailed })
