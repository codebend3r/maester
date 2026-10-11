/**
 * How transcodes encode video: on the CPU with libx264, or on a GPU. VAAPI
 * drives an Intel or AMD GPU on Linux through its render node; VideoToolbox
 * drives the media engine in every Mac.
 */
export type VideoEncoder =
  | { kind: 'software' }
  | { kind: 'videotoolbox' }
  | { kind: 'vaapi'; device: string }

/** The HW_ACCEL setting: `auto` tries what this machine has; `none` keeps to the CPU. */
export type HwAccel = 'auto' | 'none' | 'vaapi' | 'videotoolbox'

const HW_ACCELS: readonly HwAccel[] = ['auto', 'none', 'vaapi', 'videotoolbox']

export const isHwAccel = (value: unknown): value is HwAccel =>
  HW_ACCELS.some((accel) => accel === value)

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
