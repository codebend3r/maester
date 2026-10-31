export const START_RADIO_COPY = {
  startRadio: 'Start radio',
  startRadioFrom: (title: string) => `Start radio from ${title}`,
  nothingToPlay: 'The radio found nothing to play.',
  failed: (reason: string) => `The radio could not start: ${reason}`,
} as const
