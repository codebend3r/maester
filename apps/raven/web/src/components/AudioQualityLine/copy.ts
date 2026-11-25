import { COMMON_COPY } from '@/lib/copy'

export const AUDIO_QUALITY_COPY = {
  /** The whole line as one sentence: "Quality, FLAC, 16-bit, 44.1 kHz, 912 kbps". */
  label: (facts: readonly string[]) => ['Quality', ...facts].join(COMMON_COPY.listSeparator),
} as const
