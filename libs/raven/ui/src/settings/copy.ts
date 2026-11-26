/** A range's ends, as a hint names them. */
export type RangeHintProps = { min: number; max: number }

type PlaybackPrefsCopyProps = {
  /** What a viewer does to a button where the hint is read: a click in a browser, a press on a device. */
  press: string
}

/** Settings' up next and intro choices, in the same words on every host but the way a button is pressed. */
export const playbackPrefsCopy = ({ press }: PlaybackPrefsCopyProps) =>
  ({
    secondsFor: (seconds: number) => `${seconds} seconds`,
    autoplay: 'Autoplay',
    autoplayHint:
      "Plays the next episode, the saga's next film or the shuffle's next pick once the countdown at the end runs out. Off, the up next card waits for Play now.",
    countdown: 'Count down to what is up next for',
    countdownHint: ({ min, max }: RangeHintProps) =>
      `How long before the end the up next card shows, and with autoplay on how long it counts down, from ${min} to ${max} seconds.`,
    skipIntros: 'Skip intros automatically',
    skipIntrosHint: `Jumps past an episode's intro, once per episode, with a moment to undo it. Off, Skip intro waits for a ${press}.`,
  }) as const

/** Settings' list of the caller's Coming soon requests, in the same words on every host. */
export const REQUESTS_COPY = {
  heading: 'Your requests',
  help: 'The movies and TV shows you asked Coming soon to download, and where each one stands.',
  reading: 'Reading your requests',
  failed: 'Could not read your requests: ',
  none: 'You have not requested anything yet. Ask for a title on its Coming soon page.',
} as const
