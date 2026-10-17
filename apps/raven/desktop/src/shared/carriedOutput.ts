import type { OutputSettings, PassthroughFormat } from '@raven/core'

/** What CoreAudio exclusive carries to a receiver; every other format decodes to PCM. */
export const CARRIED_FORMATS = ['ac3', 'dts'] as const satisfies readonly PassthroughFormat[]

export const carriedFormats = (output: OutputSettings) =>
  CARRIED_FORMATS.filter((format) => output.passthrough.includes(format))

/** Whether a receiver gets the bitstream, which is what fixes the volume. Anything else plays as PCM. */
export const carriesPassthrough = (output: OutputSettings) =>
  output.profile === 'passthrough' && carriedFormats(output).length > 0
