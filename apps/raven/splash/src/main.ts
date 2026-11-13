import '@fontsource/young-serif'
import '@fontsource-variable/instrument-sans/wdth.css'
import '@/styles/globals.scss'
import '@/styles/page.scss'
import '@/styles/landing.scss'

import { SPLASH_COPY } from '@/copy'
import { el, link } from '@/dom'
import { fileItem } from '@/fileItem'
import {
  PATHS,
  downloadMenu,
  fetchReleases,
  formatDate,
  platformList,
  platformOf,
} from '@/releases'

const IDS = {
  menu: 'download-menu',
  note: 'release-note',
  download: 'download',
  title: 'download-title',
} as const
const EVENTS = { click: 'click', keydown: 'keydown' } as const
const ESCAPE = 'Escape'

/*
 * The menu lists the releases page until GitHub answers; the latest release's
 * files replace it, the visitor's platform first and named on the button, and
 * the line under it names the version.
 */
const showLatestRelease = async (): Promise<void> => {
  const menu = document.getElementById(IDS.menu)
  const note = document.getElementById(IDS.note)
  const title = document.getElementById(IDS.title)
  if (menu === null || note === null || title === null) return
  const [latest] = await fetchReleases()
  if (latest === undefined) return
  const offer = downloadMenu({
    release: latest,
    platform: platformOf({ userAgent: navigator.userAgent }),
  })
  title.textContent = offer.title
  menu.replaceChildren(...offer.files.map((file) => fileItem({ file })))
  note.replaceChildren(
    el({
      tag: 'span',
      text: SPLASH_COPY.versionLine({
        version: latest.version,
        platforms: platformList({ release: latest }),
        date: formatDate({ date: latest.date }),
      }),
    }),
    link({ href: PATHS.versions, text: SPLASH_COPY.everyVersion }),
  )
}

// A click outside the open menu, or Escape, closes it.
const closeMenuFromOutside = (): void => {
  const download = document.getElementById(IDS.download)
  if (!(download instanceof HTMLDetailsElement)) return
  document.addEventListener(EVENTS.click, (event) => {
    if (download.open && event.target instanceof Node && !download.contains(event.target)) {
      download.open = false
    }
  })
  document.addEventListener(EVENTS.keydown, (event) => {
    if (event.key === ESCAPE) download.open = false
  })
}

closeMenuFromOutside()
await showLatestRelease()
