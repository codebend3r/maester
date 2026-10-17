import { ENCODER_KINDS, HW_ACCELS, type HwAccel } from '@raven/core'

/** The `process.platform` that has VideoToolbox. */
const PLATFORMS = { darwin: 'darwin' } as const satisfies Record<string, NodeJS.Platform>

/**
 * How transcodes encode video: on the CPU with libx264, or on a GPU. VAAPI
 * drives an Intel or AMD GPU on Linux through its render node; VideoToolbox
 * drives the media engine in every Mac.
 */
export type VideoEncoder =
  | { kind: typeof ENCODER_KINDS.software }
  | { kind: typeof ENCODER_KINDS.videotoolbox }
  | { kind: typeof ENCODER_KINDS.vaapi; device: string }

export const SOFTWARE: VideoEncoder = { kind: ENCODER_KINDS.software }

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
  const videotoolbox: VideoEncoder[] =
    platform === PLATFORMS.darwin ? [{ kind: ENCODER_KINDS.videotoolbox }] : []
  const vaapi: VideoEncoder[] = deviceExists
    ? [{ kind: ENCODER_KINDS.vaapi, device: vaapiDevice }]
    : []
  if (hwAccel === HW_ACCELS.videotoolbox) return videotoolbox
  if (hwAccel === HW_ACCELS.vaapi) return vaapi
  if (hwAccel === HW_ACCELS.auto) return [...videotoolbox, ...vaapi]
  return []
}
