/** The systems the desktop app is offered for, as `?os=` names them. */
export const OPERATING_SYSTEMS = ['mac', 'windows', 'linux'] as const

export type OperatingSystem = (typeof OPERATING_SYSTEMS)[number]

export const isOperatingSystem = (value: unknown): value is OperatingSystem =>
  OPERATING_SYSTEMS.some((system) => system === value)

/** A file a release holds for a system: who it is for, and what kind of file it is. */
type ReleaseFile = { label: string; kind: string }

type Platform = {
  system: OperatingSystem
  name: string
  /** What it needs, on its card. */
  needs: string
  /** What it needs and what it comes as, under the download button. */
  note: string
  files: readonly ReleaseFile[]
}

/** Each system's card, in the order the downloads show them. */
export const PLATFORMS = [
  {
    system: 'mac',
    name: 'macOS',
    needs: 'macOS 12 or later',
    note: 'macOS 12 or later · Apple silicon and Intel',
    files: [
      { label: 'Apple silicon', kind: '.dmg' },
      { label: 'Intel', kind: '.dmg' },
    ],
  },
  {
    system: 'windows',
    name: 'Windows',
    needs: 'Windows 10 or later, 64-bit',
    note: 'Windows 10 or later · 64-bit',
    files: [
      { label: 'Installer', kind: '.exe' },
      { label: 'Portable', kind: '.zip' },
    ],
  },
  {
    system: 'linux',
    name: 'Linux',
    needs: 'x86-64',
    note: 'AppImage and .deb · x86-64',
    files: [
      { label: 'AppImage', kind: '.AppImage' },
      { label: 'Debian, Ubuntu', kind: '.deb' },
    ],
  },
] as const satisfies readonly Platform[]

/**
 * The system a browser's user agent names, or none for a phone, a tablet, a
 * Chromebook or anything else the desktop app is not offered for. Phones
 * come first: Android's agent says Linux, and iOS's says Mac OS X.
 */
export const systemOf = (userAgent: string): OperatingSystem | undefined => {
  if (/Android|iPhone|iPad|iPod|CrOS/i.test(userAgent)) return undefined
  if (/Windows/i.test(userAgent)) return 'windows'
  if (/Macintosh|Mac OS X/i.test(userAgent)) return 'mac'
  if (/Linux|X11/i.test(userAgent)) return 'linux'
  return undefined
}

/** The system to offer first: the one `?os=` names, to try each, else the browser's own. */
export const detectSystem = ({
  query,
  userAgent,
}: {
  query: string | null
  userAgent: string
}): OperatingSystem | undefined => (isOperatingSystem(query) ? query : systemOf(userAgent))
