import type { PlaylistSummary, Track } from '@raven/core'
import { playlistFactsOf, useAudioQueue, useServerPlaylistMutations } from '@raven/ui/headless'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { BUTTON_TONES, FormButton } from '@/components/Form'
import { ListRow } from '@/components/ListRow'
import { Notice } from '@/components/Notice'
import { PALETTE, SHADES, SIZES } from '@/theme/wrenTheme'
import { type WrenSession, useWren } from '@/useWren'

const COPY = {
  playNext: 'Play next',
  addToQueue: 'Add to queue',
  addToPlaylist: 'Add to playlist',
  pickPlaylist: (title: string) => `Add ${title} to a playlist`,
  added: (name: string) => `Added to ${name}.`,
  noPlaylists: 'You have no playlists yet.',
  loading: 'Loading your playlists',
  cancel: 'Cancel',
  done: 'Done',
  close: 'Close the menu',
} as const

/** What the menu shows: its actions, or the listener's playlists to add the track to. */
export const MENU_VIEWS = { actions: 'actions', playlists: 'playlists' } as const

export type MenuView = (typeof MENU_VIEWS)[keyof typeof MENU_VIEWS]

const NO_PLAYLISTS: readonly PlaylistSummary[] = []

type PlaylistPickerProps = { track: Track; onDone: () => void }

type PlaylistChoicesProps = PlaylistPickerProps & { session: WrenSession }

/** The listener's playlists, one press adding the track to the end of one. */
function PlaylistChoices({ session: { api, queries }, track, onDone }: PlaylistChoicesProps) {
  const playlists = useQuery(queries.playlistsQuery)
  const { append } = useServerPlaylistMutations({ api })
  const [note, setNote] = useState<string | null>(null)
  const list = playlists.data ?? NO_PLAYLISTS
  const notice = ((): string | null => {
    if (playlists.error !== null) return playlists.error.message
    if (!playlists.isSuccess) return COPY.loading
    return list.length === 0 ? COPY.noPlaylists : null
  })()
  const add = (playlist: PlaylistSummary) => {
    setNote(null)
    append.mutate(
      { id: playlist.id, tracks: [track] },
      {
        onSuccess: (details) => setNote(COPY.added(details.playlist.name)),
        onError: (error) => setNote(error.message),
      },
    )
  }
  return (
    <View accessibilityLabel={COPY.pickPlaylist(track.title)} style={styles.view}>
      <Text accessibilityRole="header" style={styles.heading}>
        {COPY.pickPlaylist(track.title)}
      </Text>
      {notice !== null && <Notice text={notice} />}
      <ScrollView style={styles.list}>
        {list.map((playlist) => (
          <ListRow
            key={playlist.id}
            line={playlistFactsOf({ playlist })}
            onPress={() => add(playlist)}
            title={playlist.name}
          />
        ))}
      </ScrollView>
      {note !== null && <Notice text={note} />}
      <FormButton
        label={note === null ? COPY.cancel : COPY.done}
        onPress={onDone}
        tone={BUTTON_TONES.quiet}
      />
    </View>
  )
}

/** The active server's playlists to add the track to; none without a server, which the guarded stack never shows. */
function PlaylistPicker({ track, onDone }: PlaylistPickerProps) {
  const session = useWren()
  return session !== null && <PlaylistChoices onDone={onDone} session={session} track={track} />
}

type TrackMenuProps = {
  track: Track
  view: MenuView
  /** Shows another of the menu's views, or closes it with null. */
  onView: (view: MenuView | null) => void
}

/**
 * A track's menu, held on its row or opened from its More: play it next, add it to the end of
 * the queue, or add it to one of the listener's playlists.
 */
export function TrackMenu({ track, view, onView }: TrackMenuProps) {
  const playNext = useAudioQueue((store) => store.playNext)
  const addToQueue = useAudioQueue((store) => store.addToQueue)
  const { bottom } = useSafeAreaInsets()
  const close = () => onView(null)
  const then = (act: (tracks: readonly Track[]) => void) => () => {
    act([track])
    close()
  }
  return (
    <Modal animationType="fade" onRequestClose={close} transparent visible>
      <View style={styles.scrim}>
        <Pressable
          accessibilityLabel={COPY.close}
          accessibilityRole="button"
          onPress={close}
          style={styles.away}
        />
        <View style={[styles.sheet, { paddingBottom: bottom + SIZES.space4 }]}>
          {view === MENU_VIEWS.playlists ? (
            <PlaylistPicker onDone={close} track={track} />
          ) : (
            <View style={styles.view}>
              <Text accessibilityRole="header" numberOfLines={1} style={styles.heading}>
                {track.title}
              </Text>
              <FormButton
                label={COPY.playNext}
                onPress={then(playNext)}
                tone={BUTTON_TONES.quiet}
              />
              <FormButton
                label={COPY.addToQueue}
                onPress={then(addToQueue)}
                tone={BUTTON_TONES.quiet}
              />
              <FormButton
                label={COPY.addToPlaylist}
                onPress={() => onView(MENU_VIEWS.playlists)}
                tone={BUTTON_TONES.quiet}
              />
              <FormButton label={COPY.cancel} onPress={close} tone={BUTTON_TONES.ghost} />
            </View>
          )}
        </View>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: SHADES.scrim },
  away: { flex: 1 },
  sheet: {
    backgroundColor: PALETTE.raised,
    borderTopLeftRadius: SIZES.radius,
    borderTopRightRadius: SIZES.radius,
    paddingHorizontal: SIZES.space4,
    paddingTop: SIZES.space4,
  },
  view: { gap: SIZES.space2 },
  heading: { color: PALETTE.text, fontSize: SIZES.textLg, fontWeight: 'bold' },
  list: { maxHeight: SIZES.measure / 2 },
})
