import { join } from 'node:path'

type TemporaryProps = { dir: string; extension: string }

/**
 * A dot-file in `dir` that a write lands in before it is renamed into place: hidden from the
 * sweeps, and unique to this process and moment. It keeps `extension`, since ffmpeg picks its
 * muxer from the name.
 */
export const temporary = ({ dir, extension }: TemporaryProps): string =>
  join(dir, `.${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.${extension}`)
