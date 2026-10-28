import '@fontsource/young-serif'
import '@fontsource-variable/instrument-sans/wdth.css'
import '@/styles/globals.scss'
import '@/styles/page.scss'
import '@/styles/versions.scss'

import { byId, el, link } from '@/dom'
import { fileItem } from '@/fileItem'
import { fetchReleases, formatDate } from '@/releases'
import type { Release } from '@/releases'

const IDS = { versions: 'versions', status: 'versions-status' } as const
const CLASSES = {
  version: 'version',
  heading: 'version-heading',
  date: 'version-date',
  files: 'version-files',
  notes: 'version-notes',
} as const

const versionItem = (release: Release): HTMLElement =>
  el({
    tag: 'li',
    className: CLASSES.version,
    children: [
      el({ tag: 'h2', className: CLASSES.heading, text: release.version }),
      el({ tag: 'p', className: CLASSES.date, text: formatDate({ date: release.date }) }),
      el({
        tag: 'ul',
        className: CLASSES.files,
        children: release.files.map((file) => fileItem({ file })),
      }),
      link({ href: release.notesUrl, className: CLASSES.notes, text: "What's new on GitHub" }),
    ],
  })

const showVersions = async (): Promise<void> => {
  const list = byId({ id: IDS.versions })
  const status = byId({ id: IDS.status })
  if (list === null || status === null) return
  const releases = await fetchReleases()
  if (releases.length === 0) {
    status.textContent =
      'GitHub did not answer with the list. Try again in a minute, or open the releases on GitHub.'
    return
  }
  status.remove()
  list.replaceChildren(...releases.map(versionItem))
}

await showVersions()
