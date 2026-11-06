export const RESOLUTION_CHIP_COPY = {
  videoResolution: (resolution: string) => `Video resolution: ${resolution}`,
  videoCodec: (codec: string) => `Video codec: ${codec}`,
  dolbyVisionOnly: 'Dolby Vision profile 5: its colours come out wrong in a browser',
} as const
