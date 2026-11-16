import { SPLASH_COPY } from '@/copy'
import { el, link } from '@/dom'
import { fileItem } from '@/fileItem'
import { fetchReleases, formatDate } from '@/releases'
import type { Catalog, Release } from '@/releases'

const CLASSES = {
  version: 'version',
  heading: 'version-heading',
  date: 'version-date',
  files: 'version-files',
  notes: 'version-notes',
} as const

type VersionItemProps = {
  release: Release
}

const versionItem = ({ release }: VersionItemProps): HTMLElement =>
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
      link({ href: release.notesUrl, className: CLASSES.notes, text: SPLASH_COPY.whatsNew }),
    ],
  })

const IDS = { versions: 'versions', status: 'versions-status' } as const

type ShowVersionsProps = {
  catalogs: readonly Catalog[]
  emptyText: string
}

/** Fills the page's version list, or says why it is empty in the status line. */
export const showVersions = async ({ catalogs, emptyText }: ShowVersionsProps): Promise<void> => {
  const list = document.getElementById(IDS.versions)
  const status = document.getElementById(IDS.status)
  if (list === null || status === null) return
  const releases = await fetchReleases({ catalogs })
  if (releases.length === 0) {
    status.textContent = emptyText
    return
  }
  status.remove()
  list.replaceChildren(...releases.map((release) => versionItem({ release })))
}
