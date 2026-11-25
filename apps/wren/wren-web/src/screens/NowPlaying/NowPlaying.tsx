import type { Track } from '@raven/core'
import { playingTrackOf, useAudioQueue } from '@raven/ui/headless'
import { MENU_VIEWS, type MenuView, NOW_PLAYING_COPY, type SongActions } from '@raven/wren'
import { type ComponentType, useState } from 'react'
import { TrackMenu } from '@/components/TrackMenu/TrackMenu'
import { useTrackLike } from '@/lib/useTrackLike'
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

type LayoutProps = { playing: Playing; actions: SongActions }

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

/*
 * A song is queued: the layout for the window, and the song's menu over it, opened on its
 * actions from More or on the listener's playlists from Add to playlist.
 */
function PlayingSheet({ sheet: { track } }: SheetViewProps<typeof SHEET_STATES.playing>) {
  const playing = usePlaying({ track })
  const like = useTrackLike({ track })
  const [menu, setMenu] = useState<MenuView | null>(null)
  const Layout = LAYOUT_VIEWS[usePlayerFormFactor()]
  // While the menu is open Escape is its own, and closes it alone.
  useEscape({ onEscape: playing.close, isEnabled: menu === null })
  return (
    <>
      <Layout
        actions={{
          like,
          onAddToPlaylist: () => setMenu(MENU_VIEWS.playlists),
          onMore: () => setMenu(MENU_VIEWS.actions),
        }}
        playing={playing}
      />
      {menu !== null && (
        <TrackMenu like={like} onClose={() => setMenu(null)} startsOn={menu} track={track} />
      )}
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
 * `/now-playing`, the player opened up, drawn alone with no chrome: the cover large, the song
 * with its heart and Add to playlist beside its name, the scrubber with the time played and the
 * time left, Previous, Play or Pause and Next, and the volume. In a window up to `64rem` wide a
 * bar at the foot swaps the player for the lyrics (a synced line plays from where it is sung)
 * or Up next (Shuffle, Repeat and Clear over the songs, each playable, moved up or down and
 * removed). Wider, those two are the tabs of one pane beside the player. The header's button
 * and Escape close it, back to the page it was opened over.
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
