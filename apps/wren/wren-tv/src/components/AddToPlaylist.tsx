import type { PlaylistSummary, Track } from '@raven/core'
import { countsLineOf, NEW_PLAYLIST_COPY, TRACK_MENU_COPY } from '@raven/wren'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Text, View } from 'react-native'

import { useAddToPlaylist, type WrenSession } from '@raven/wren-native'
import { SPACE, TYPE } from '@/theme/tvTokens'
import { themedStyles } from '@/theme/wrenTheme'
import { EmptyState } from '@/ui/EmptyState'
import { ListRow } from '@/ui/ListRow'
import { Loading } from '@/ui/Loading'
import { NewPlaylistForm } from '@/ui/NewPlaylistForm'
import { shownWords } from '@/ui/words'
import { ICONS } from '@/ui/WrenIcon'

const useStyles = themedStyles(({ colors }) => ({
  body: { gap: SPACE.s2 },
  notice: { ...TYPE.body, color: colors.accentText },
}))

const NO_PLAYLISTS: readonly PlaylistSummary[] = []

type AddToPlaylistProps = {
  session: WrenSession
  /** What is added, read once a playlist is picked: a track, or an album's tracks. */
  tracksOf: () => Promise<readonly Track[]>
  /** What is added, by name, for the empty message. */
  name: string
  /** Closes the sheet once a playlist is picked. */
  onDone: () => void
}

/**
 * Add to playlist: New playlist, which makes one here and puts the tracks in it, then the
 * listener's own playlists, a press adding the tracks to the end of one. Either way the sheet
 * closes, and once the server has answered a toast says where they went, or why it refused.
 */
export function AddToPlaylist({ session, tracksOf, name, onDone }: AddToPlaylistProps) {
  const styles = useStyles()
  const playlists = useQuery(session.queries.ownPlaylistsQuery)
  const [isNaming, setIsNaming] = useState(false)
  const list = playlists.data ?? NO_PLAYLISTS
  const add = useAddToPlaylist({ session, tracksOf, onDone })
  const isEmpty = playlists.isSuccess && list.length === 0
  return (
    <View accessibilityLabel={TRACK_MENU_COPY.pickPlaylist(name)} style={styles.body}>
      {!isNaming && (
        <ListRow
          hasPreferredFocus
          icon={ICONS.plus}
          onPress={() => setIsNaming(true)}
          title={NEW_PLAYLIST_COPY.title}
        />
      )}
      {isNaming && <NewPlaylistForm onCreated={add} session={session} />}
      {playlists.isPending && <Loading />}
      {playlists.error !== null && <Text style={styles.notice}>{playlists.error.message}</Text>}
      {isEmpty && (
        <EmptyState
          body={TRACK_MENU_COPY.noPlaylistsHint(name)}
          icon={ICONS.playlist}
          title={TRACK_MENU_COPY.noPlaylists}
        />
      )}
      {list.map((playlist) => (
        <ListRow
          icon={ICONS.playlist}
          key={playlist.id}
          onPress={() => add(playlist)}
          title={playlist.name}
          value={shownWords(countsLineOf({ songs: playlist.trackCount }))}
        />
      ))}
    </View>
  )
}
