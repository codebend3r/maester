import type { HwAccel } from '@raven/core'

/**
 * How transcodes encode video: on the CPU with libx264, or on a GPU. VAAPI
 * drives an Intel or AMD GPU on Linux through its render node; VideoToolbox
 * drives the media engine in every Mac.
 */
export type VideoEncoder =
  | { kind: 'software' }
  | { kind: 'videotoolbox' }
  | { kind: 'vaapi'; device: string }

export const SOFTWARE: VideoEncoder = { kind: 'software' }

/**
 * The GPU encoders worth a test encode, best first, for a setting on this
 * platform. Software is always the fallback, so it is never listed.
 */
export const encoderCandidates = ({
  hwAccel,
  platform,
  vaapiDevice,
  deviceExists,
}: {
  hwAccel: HwAccel
  platform: string
  vaapiDevice: string
  deviceExists: boolean
}): VideoEncoder[] => {
  const videotoolbox: VideoEncoder[] = platform === 'darwin' ? [{ kind: 'videotoolbox' }] : []
  const vaapi: VideoEncoder[] = deviceExists ? [{ kind: 'vaapi', device: vaapiDevice }] : []
  if (hwAccel === 'videotoolbox') return videotoolbox
  if (hwAccel === 'vaapi') return vaapi
  if (hwAccel === 'auto') return [...videotoolbox, ...vaapi]
  return []
}
