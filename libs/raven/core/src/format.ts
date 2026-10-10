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
