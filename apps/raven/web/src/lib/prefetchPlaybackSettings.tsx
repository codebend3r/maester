import { usePrefetchQuery } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { playbackSettingsQuery } from '@/lib/queries'

/**
 * Asks for the server's playback settings as the app opens, so they are on
 * hand by the time a listing draws its cards' playback notes, rather than
 * asked for by its first card.
 */
export const PrefetchPlaybackSettings = ({ children }: { children: ReactNode }) => {
  usePrefetchQuery(playbackSettingsQuery)
  return children
}
