const pad = (value: number): string => String(value).padStart(2, '0')

/** "1:32:05" past the hour, "4:05" under it, "0:00" for nothing or garbage. */
export const formatDuration = (seconds: number | null): string => {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return '0:00'
  const total = Math.floor(seconds)
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const rest = total % 60
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(rest)}` : `${minutes}:${pad(rest)}`
}

/** "1h 37m" or "42m", for a card's runtime rather than a player clock. */
export const formatRuntime = (seconds: number | null): string | null => {
  if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) return null
  const minutes = Math.round(seconds / 60)
  if (minutes < 1) return `${Math.round(seconds)}s`
  const hours = Math.floor(minutes / 60)
  return hours > 0 ? `${hours}h ${minutes % 60}m` : `${minutes}m`
}

const BYTE_UNITS: readonly string[] = ['B', 'KB', 'MB', 'GB', 'TB']

/** Decimal units, one place after the point from MB up: "4.9 GB", "512 KB". */
export const formatBytes = (bytes: number): string => {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const exponent = Math.min(Math.floor(Math.log10(bytes) / 3), BYTE_UNITS.length - 1)
  const value = bytes / 1000 ** exponent
  const unit = BYTE_UNITS[exponent] ?? 'B'
  return exponent >= 2 ? `${value.toFixed(1)} ${unit}` : `${Math.round(value)} ${unit}`
}

/** "2.2 Mb/s", or "640 kb/s" under a megabit; null until the file is probed. */
export const formatBitrate = (bitsPerSecond: number | null): string | null => {
  if (bitsPerSecond == null) return null
  return bitsPerSecond >= 1_000_000
    ? `${(bitsPerSecond / 1_000_000).toFixed(1)} Mb/s`
    : `${Math.round(bitsPerSecond / 1000)} kb/s`
}

/** "Mono", "Stereo", "5.1", "7.1", or "N ch" for anything unusual. */
export const formatChannels = (channels: number | null): string | null => {
  if (channels == null || channels <= 0) return null
  const named: Record<number, string> = { 1: 'Mono', 2: 'Stereo', 6: '5.1', 8: '7.1' }
  return named[channels] ?? `${channels} ch`
}

/** Up to `places` after the point, trailing zeros dropped: 23.976, 24, 44.1. */
const trimmed = ({ value, places }: { value: number; places: number }): string =>
  String(Number(value.toFixed(places)))

/** "48 kHz", "44.1 kHz"; null when unknown. */
export const formatSampleRate = (samplesPerSecond: number | null): string | null => {
  if (samplesPerSecond == null || samplesPerSecond <= 0) return null
  return `${trimmed({ value: samplesPerSecond / 1000, places: 1 })} kHz`
}

/** "23.976 fps", "24 fps"; null when unknown. */
export const formatFrameRate = (framesPerSecond: number | null): string | null => {
  if (framesPerSecond == null || framesPerSecond <= 0) return null
  return `${trimmed({ value: framesPerSecond, places: 3 })} fps`
}

const AGO_UNITS: ReadonlyArray<{ unit: Intl.RelativeTimeFormatUnit; seconds: number }> = [
  { unit: 'year', seconds: 365 * 24 * 3600 },
  { unit: 'month', seconds: 30 * 24 * 3600 },
  { unit: 'day', seconds: 24 * 3600 },
  { unit: 'hour', seconds: 3600 },
  { unit: 'minute', seconds: 60 },
]

/** Narrow for a byline, "3d ago"; long for a card's words, "3 days ago", "yesterday". */
const AGO_FORMATS = {
  narrow: new Intl.RelativeTimeFormat(undefined, { numeric: 'always', style: 'narrow' }),
  long: new Intl.RelativeTimeFormat(undefined, { numeric: 'auto', style: 'long' }),
}

/** How long ago `at` was, in the largest whole unit; "just now" under a minute. */
export const timeAgo = ({
  at,
  now = new Date(),
  style = 'narrow',
}: {
  at: string
  now?: Date
  style?: keyof typeof AGO_FORMATS
}): string => {
  const seconds = Math.max(0, (now.getTime() - new Date(at).getTime()) / 1000)
  const found = AGO_UNITS.find((candidate) => seconds >= candidate.seconds)
  return found
    ? AGO_FORMATS[style].format(-Math.floor(seconds / found.seconds), found.unit)
    : 'just now'
}
