import { formatBytes, plural } from '@raven/core'

type QuestionProps = { title: string; files: string; bytes: number }
type RoomProps = { free: number; computer: string }
type ShortProps = { bytes: number; free: number }

export const DOWNLOAD_DIALOG_COPY = {
  title: 'Download to Raven',
  movies: (n: number) => plural({ n, one: 'movie', many: 'movies' }),
  question: ({ title, files, bytes }: QuestionProps) =>
    `Download ${title} (${files}, ${formatBytes(bytes)})?`,
  room: ({ free, computer }: RoomProps) => `${formatBytes(free)} free on this ${computer}.`,
  short: ({ bytes, free }: ShortProps) => `Needs ${formatBytes(bytes)}; ${formatBytes(free)} free.`,
  alreadyDownloaded: (title: string) => `${title} is already downloaded.`,
  locked: "This title is in a locked library, so it can't be downloaded.",
  signInFirst: 'Sign in to raven to download from it, then download again.',
} as const
