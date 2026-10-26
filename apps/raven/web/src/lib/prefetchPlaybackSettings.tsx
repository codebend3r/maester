import { usePrefetchQuery } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { useIsServed } from '@/lib/accessState'
import { playbackSettingsQuery } from '@/lib/queries'

const Prefetch = () => {
  usePrefetchQuery(playbackSettingsQuery)
  return null
}

type PrefetchPlaybackSettingsProps = { children: ReactNode }

/**
 * Asks for the server's playback settings as the app opens, so they are on
 * hand by the time a listing draws its cards' playback notes, rather than
 * asked for by its first card. It waits for an approved account when
 * accounts are on, as the server answers no one else.
 */
export const PrefetchPlaybackSettings = ({ children }: PrefetchPlaybackSettingsProps) => {
  const isServed = useIsServed()
  return (
    <>
      {isServed && <Prefetch />}
      {children}
    </>
  )
}
