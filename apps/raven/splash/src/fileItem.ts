import { el, link } from '@/dom'
import { formatBytes } from '@/releases'
import type { ReleaseFile } from '@/releases'

const CLASSES = { link: 'file-link', size: 'file-size' } as const

type FileItemProps = {
  file: ReleaseFile
}

/** A release file as one list item: its label and its size, linking to the download. */
export const fileItem = ({ file }: FileItemProps): HTMLElement =>
  el({
    tag: 'li',
    children: [
      link({
        href: file.url,
        className: CLASSES.link,
        children: [
          el({ tag: 'span', text: file.label }),
          el({ tag: 'span', className: CLASSES.size, text: formatBytes({ bytes: file.bytes }) }),
        ],
      }),
    ],
  })
