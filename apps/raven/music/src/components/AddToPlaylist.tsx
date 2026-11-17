import type { PlaylistSummary, Track } from '@raven/core'
import { useServerPlaylistMutations } from '@raven/ui/headless'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Pressable, ScrollView, Text, View } from 'react-native'

import { TRACK_MENU_COPY } from '@/components/copy'
import { Notice } from '@/components/Notice'
import { useToast } from '@/stores/toast'
import { type WrenTheme, themedStyles, useWrenTheme } from '@/theme/wrenTheme'
import { DETAIL_SIZES, RADIUS, SIZE, SPACE, TYPE } from '@/theme/wrenTokens'
import { AlbumArt } from '@/ui/AlbumArt'
import { NEW_PLAYLIST_COPY } from '@/ui/copy'
import { countsLineOf } from '@/ui/counts'
import { EmptyState } from '@/ui/EmptyState'
import { NewPlaylistForm } from '@/ui/NewPlaylistForm'
import { pressedStyleOf } from '@/ui/press'
import { ICONS, WrenIcon } from '@/ui/WrenIcon'
import type { WrenSession } from '@/useWren'

const useStyles = themedStyles(({ colors }: WrenTheme) => ({
  body: { gap: SPACE.s4, paddingHorizontal: SPACE.s3, paddingTop: SPACE.s4 },
  create: {
    alignItems: 'center',
    backgroundColor: colors.accentSoft,
    borderRadius: RADIUS.lg,
    flexDirection: 'row',
    gap: SPACE.s4,
    padding: SPACE.s3,
  },
  createTile: {
    alignItems: 'center',
    backgroundColor: colors.accent,
    borderRadius: RADIUS.item,
    height: SIZE.touchTarget,
    justifyContent: 'center',
    width: SIZE.touchTarget,
  },
  createLabel: { ...TYPE.rowStrong, color: colors.accentText },
  list: { maxHeight: DETAIL_SIZES.playlistList },
  row: {
    alignItems: 'center',
    borderBottomColor: colors.line,
    borderBottomWidth: SIZE.hairline,
    flexDirection: 'row',
    gap: SIZE.rowGap,
    minHeight: SIZE.row,
    paddingVertical: SPACE.s2,
  },
  rowText: { flex: 1 },
  rowTitle: { ...TYPE.rowTitle, color: colors.text },
  rowLine: { ...TYPE.meta, color: colors.text2 },
}))

const NO_PLAYLISTS: readonly PlaylistSummary[] = []

type AddToPlaylistProps = {
  session: WrenSession
  /** What is added, read once a playlist is picked: a track, or an album's tracks. */
  tracksOf: () => Promise<readonly Track[]>
  /** What is added, by name, for the empty message: "Create one and Chandelier goes straight in." */
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
  const { colors } = useWrenTheme()
  const playlists = useQuery(session.queries.ownPlaylistsQuery)
  const { append } = useServerPlaylistMutations({ api: session.api })
  const [isNaming, setIsNaming] = useState(false)
  const list = playlists.data ?? NO_PLAYLISTS
  const toast = useToast((state) => state.show)
  const add = (playlist: PlaylistSummary) => {
    onDone()
    tracksOf()
      .then((tracks) => append.mutateAsync({ id: playlist.id, tracks }))
      .then(
        () => toast(TRACK_MENU_COPY.added(playlist.name)),
        (error: unknown) => error instanceof Error && toast(error.message),
      )
  }
  const notice = ((): string | null => {
    if (playlists.error !== null) return playlists.error.message
    return playlists.isSuccess ? null : TRACK_MENU_COPY.loading
  })()
  const isEmpty = playlists.isSuccess && list.length === 0
  return (
    <View style={styles.body}>
      {!isNaming && (
        <Pressable
          accessibilityLabel={NEW_PLAYLIST_COPY.title}
          accessibilityRole="button"
          onPress={() => setIsNaming(true)}
          style={pressedStyleOf({ style: styles.create })}
        >
          <View style={styles.createTile}>
            <WrenIcon color={colors.accentInk} name={ICONS.plus} />
          </View>
          <Text style={styles.createLabel}>{NEW_PLAYLIST_COPY.title}</Text>
        </Pressable>
      )}
      {isNaming && <NewPlaylistForm onCreated={add} session={session} />}
      {notice !== null && <Notice text={notice} />}
      {isEmpty && (
        <EmptyState
          body={TRACK_MENU_COPY.noPlaylistsHint(name)}
          icon={ICONS.playlist}
          title={TRACK_MENU_COPY.noPlaylists}
        />
      )}
      {list.length > 0 && (
        <ScrollView accessibilityLabel={TRACK_MENU_COPY.pickPlaylist(name)} style={styles.list}>
          {list.map((playlist) => {
            const count = countsLineOf({ songs: playlist.trackCount })
            return (
              <Pressable
                accessibilityLabel={TRACK_MENU_COPY.playlistRow({ name: playlist.name, count })}
                accessibilityRole="button"
                key={playlist.id}
                onPress={() => add(playlist)}
                style={pressedStyleOf({ style: styles.row })}
              >
                <AlbumArt cover={null} radius={RADIUS.xs} size={SIZE.rowArt} />
                <View style={styles.rowText}>
                  <Text numberOfLines={1} style={styles.rowTitle}>
                    {playlist.name}
                  </Text>
                  {count !== '' && <Text style={styles.rowLine}>{count}</Text>}
                </View>
              </Pressable>
            )
          })}
        </ScrollView>
      )}
    </View>
  )
}
