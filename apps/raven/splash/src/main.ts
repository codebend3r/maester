import '@fontsource/young-serif'
import '@fontsource-variable/instrument-sans/wdth.css'
import '@/styles/globals.scss'
import '@/styles/page.scss'

import { byId, el, link } from '@/dom'
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

// The menu lists the releases page until GitHub answers; the latest release's
// files replace it, the visitor's platform first and named on the button, and
// the line under it names the version.
const showLatestRelease = async (): Promise<void> => {
  const menu = byId({ id: IDS.menu })
  const note = byId({ id: IDS.note })
  const title = byId({ id: IDS.title })
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
      text: `Version ${latest.version} for ${platformList({ release: latest })}, released ${formatDate({ date: latest.date })}. `,
    }),
    link({ href: PATHS.versions, text: 'Every version' }),
  )
}

// A click outside the open menu, or Escape, closes it.
const closeMenuFromOutside = (): void => {
  const download = byId({ id: IDS.download })
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
