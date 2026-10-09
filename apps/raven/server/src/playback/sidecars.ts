import { readdir } from 'node:fs/promises'
import { basename, dirname, extname, join } from 'node:path'
import { isKnownLanguage, languageTag } from '@raven/core'

/** A subtitle file beside a video, and what its name says about it. */
export type Sidecar = {
  path: string
  /** The extension: 'srt', 'vtt', 'ass' or 'ssa'. */
  codec: string
  language: string | null
  title: string | null
  forced: boolean
  hearingImpaired: boolean
}

const SIDECAR_EXTENSIONS: ReadonlySet<string> = new Set(['srt', 'vtt', 'ass', 'ssa'])
const HEARING_IMPAIRED: ReadonlySet<string> = new Set(['sdh', 'cc', 'hi'])

const FLAGS: ReadonlySet<string> = new Set(['forced', 'default', ...HEARING_IMPAIRED])

/**
 * What a sidecar's name says, or null when it does not belong to the
 * video. `Movie (2020).en.forced.srt` beside `Movie (2020).mkv` is English
 * and forced; the words between the video's name and the extension can
 * come in any order, and the ones that are not a language or a flag
 * become the title.
 */
export const parseSidecarName = ({
  videoFileName,
  fileName,
}: {
  videoFileName: string
  fileName: string
}): Omit<Sidecar, 'path'> | null => {
  const base = basename(videoFileName, extname(videoFileName))
  const extension = extname(fileName).slice(1).toLowerCase()
  const belongs = fileName.toLowerCase().startsWith(`${base.toLowerCase()}.`)
  if (!belongs || !SIDECAR_EXTENSIONS.has(extension)) return null

  const middle = fileName.slice(base.length + 1, fileName.length - extension.length - 1)
  const words = middle.split('.').filter((word) => word.trim() !== '')
  const lower = words.map((word) => word.toLowerCase())
  const language = words.find((word) => !FLAGS.has(word.toLowerCase()) && isKnownLanguage(word))
  const title = words.filter((word) => word !== language && !FLAGS.has(word.toLowerCase()))
  return {
    codec: extension,
    language: language == null ? null : languageTag(language),
    title: title.length > 0 ? title.join(' ') : null,
    forced: lower.includes('forced'),
    hearingImpaired: lower.some((word) => HEARING_IMPAIRED.has(word)),
  }
}

/** Every sidecar beside `videoPath`, sorted by name so their ids stay put. */
export const findSidecars = async (videoPath: string): Promise<Sidecar[]> => {
  const folder = dirname(videoPath)
  const videoFileName = basename(videoPath)
  const names = await readdir(folder).catch(() => [])
  return names
    .toSorted((a, b) => a.localeCompare(b))
    .flatMap((fileName) => {
      const parsed = parseSidecarName({ videoFileName, fileName })
      return parsed ? [{ ...parsed, path: join(folder, fileName) }] : []
    })
}
