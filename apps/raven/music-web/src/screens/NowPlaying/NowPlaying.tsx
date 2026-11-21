import type { Track } from '@raven/core'
import { playingTrackOf, useAudioQueue } from '@raven/ui/headless'
import { NOW_PLAYING_COPY } from '@raven/wren'
import { type ComponentType, useState } from 'react'
import { TrackMenu } from '@/components/TrackMenu/TrackMenu'
import { WREN_ROUTES } from '@/routes'
import { PhonePlayer } from '@/screens/NowPlaying/PhonePlayer'
import { CloseButton } from '@/screens/NowPlaying/PlayerHeader'
import { usePlayerFormFactor } from '@/screens/NowPlaying/playerFormFactor'
import { TabletPlayer } from '@/screens/NowPlaying/TabletPlayer'
import { useEscape } from '@/screens/NowPlaying/useEscape'
import { type Playing, usePlaying } from '@/screens/NowPlaying/usePlaying'
import { useGoBack } from '@/shell/useGoBack'
import { FORM_FACTORS, type FormFactor } from '@/theme/formFactor'
import styles from '@/screens/NowPlaying/NowPlaying.module.scss'

type LayoutProps = { playing: Playing; onMore: () => void }

const LAYOUT_VIEWS = {
  [FORM_FACTORS.phone]: PhonePlayer,
  [FORM_FACTORS.tablet]: TabletPlayer,
} as const satisfies Record<FormFactor, ComponentType<LayoutProps>>

/** Whether a song is queued for the sheet to show. */
const SHEET_STATES = { idle: 'idle', playing: 'playing' } as const

type SheetState = (typeof SHEET_STATES)[keyof typeof SHEET_STATES]

/** What the sheet shows: nothing queued, or the song that plays. */
type Sheet =
  | { state: typeof SHEET_STATES.idle }
  | { state: typeof SHEET_STATES.playing; track: Track }

type SheetViewProps<K extends SheetState> = { sheet: Sheet & { state: K } }

/** A song is queued: the layout for the window, and the song's actions over it from More. */
function PlayingSheet({ sheet: { track } }: SheetViewProps<typeof SHEET_STATES.playing>) {
  const playing = usePlaying({ track })
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const Layout = LAYOUT_VIEWS[usePlayerFormFactor()]
  // While the menu is open Escape is its own, and closes it alone.
  useEscape({ onEscape: playing.close, isEnabled: !isMenuOpen })
  return (
    <>
      <Layout onMore={() => setIsMenuOpen(true)} playing={playing} />
      {isMenuOpen && <TrackMenu onClose={() => setIsMenuOpen(false)} track={track} />}
    </>
  )
}

/** Nothing is queued: the way down, and that nothing plays. */
function IdleSheet() {
  const close = useGoBack({ fallback: WREN_ROUTES.home })
  useEscape({ onEscape: close, isEnabled: true })
  return (
    <div className={styles.idle}>
      <CloseButton onClose={close} />
      <p className={styles.idleText}>{NOW_PLAYING_COPY.nothing}</p>
    </div>
  )
}

type SheetViews = { [K in SheetState]: ComponentType<SheetViewProps<K>> }

const SHEET_VIEWS = {
  [SHEET_STATES.idle]: IdleSheet,
  [SHEET_STATES.playing]: PlayingSheet,
} as const satisfies SheetViews

// Typed as the mapped type, so a state looks up the view that takes that state's sheet.
const SHEETS: SheetViews = SHEET_VIEWS

function SheetView<K extends SheetState>({ sheet }: SheetViewProps<K>) {
  const Shown: ComponentType<SheetViewProps<K>> = SHEETS[sheet.state]
  return <Shown sheet={sheet} />
}

/**
 * `/now-playing`, the player opened up, drawn alone with no chrome. In a window up to `64rem`
 * wide: the cover large, the song, the scrubber and the transport, with a bar at the foot for
 * the lyrics (a synced line plays from where it is sung) and Up next (each song playable, moved
 * up or down and removed). Wider, the cover and the controls beside the lyrics, over Up next
 * across the foot. The header's button and Escape close it, back to the page it was opened over.
 */
export function NowPlaying() {
  const track = useAudioQueue(playingTrackOf)
  const sheet: Sheet =
    track === null ? { state: SHEET_STATES.idle } : { state: SHEET_STATES.playing, track }
  return (
    <main className={styles.screen}>
      <SheetView sheet={sheet} />
    </main>
  )
}
