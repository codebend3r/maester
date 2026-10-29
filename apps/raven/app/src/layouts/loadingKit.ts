import type { ReactNode } from 'react'

export type LoadingProps = {
  /** What is loading, said aloud: the screen shows the mark and the spinner, not the words. */
  label: string
  /** The way back while it loads, under the thumb; a TV's remote has its own. */
  onBack?: () => void
}

/** The screen a page shows while it loads, each platform at its own scale. */
export type LoadingKit = { Loading: (props: LoadingProps) => ReactNode }
