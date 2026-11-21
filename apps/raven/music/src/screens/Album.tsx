import {
  type AlbumDetails,
  type AlbumTrack,
  QUEUE_SOURCE_KINDS,
  albumDiscsOf,
  artistNames,
} from '@raven/core'
import { useServerAlbumFavourite } from '@raven/ui/headless'
import { ALBUM_COPY, albumMetaOf, PLAYER_COPY, SONG_LEADS } from '@raven/wren'
import { SectionList, Text } from 'react-native'

import { DownloadButton } from '@/components/DownloadButton'
import { FavouriteAction } from '@/components/FavouriteAction'
import { TracksMenu } from '@/components/TrackMenu'
import { TrackRow } from '@/components/TrackRow'
import { DOWNLOAD_SOURCES } from '@/downloads/downloadStore'
import { useCovers } from '@/music/useCovers'
import { ArtistLinks } from '@/screens/detail/ArtistLinks'
import { CollectionHead } from '@/screens/detail/CollectionHead'
import { DetailRoute } from '@/screens/detail/DetailRoute'
import { DetailSplit } from '@/screens/detail/DetailSplit'
import { QueueAction } from '@/screens/detail/QueueAction'
import { IS_ROW_HIGHLIGHTED } from '@/screens/detail/rowHighlight'
import { useTracklist } from '@/screens/detail/useTracklist'
import { toastFailure } from '@/stores/toast'
import { type WrenTheme, themedStyles, useFormFactor } from '@/theme/wrenTheme'
import { SPACE, TYPE } from '@/theme/wrenTokens'
import { type WrenSession, useWren } from '@/useWren'

const useStyles = themedStyles(({ colors }: WrenTheme) => ({
  disc: { ...TYPE.overline, color: colors.text3, paddingBottom: SPACE.s2, paddingTop: SPACE.s5 },
}))

type AlbumPageProps = { session: WrenSession; details: AlbumDetails }

type AlbumDisc = { key: string; title: string | null; data: AlbumTrack[] }

type RenderRowProps = { item: AlbumTrack }

type RenderDiscProps = { section: AlbumDisc }

function AlbumPage({ session, details }: AlbumPageProps) {
  const styles = useStyles()
  const formFactor = useFormFactor()
  const { coverOf } = useCovers(session)
  const { album, tracks, discCount, isFavourite } = details
  const favourite = useServerAlbumFavourite({ api: session.api, albumId: album.id })
  const { playingId, play, shuffle, playFrom, queue, isMenuOpen, openMenu, closeMenu } =
    useTracklist({
      tracks,
      source: { kind: QUEUE_SOURCE_KINDS.album, id: album.id },
      queued: ALBUM_COPY.queued(album.title),
    })
  const cover = coverOf({ albumId: album.id, coverVersion: album.coverVersion })
  const discs = albumDiscsOf({ tracks, discCount }).map(({ key, title, tracks: data }) => ({
    key,
    title,
    data,
  }))
  const [artist] = album.artists
  const toggleFavourite = () =>
    favourite.attempt({ variables: !isFavourite, onRefused: toastFailure })
  const renderRow = ({ item }: RenderRowProps) => (
    <TrackRow
      isCurrent={item.id === playingId}
      isHighlighted={IS_ROW_HIGHLIGHTED[formFactor]}
      label={item.label}
      length={item.length}
      lead={{ kind: SONG_LEADS.number, number: item.number }}
      onPress={() => playFrom(item.index)}
      track={item.track}
    />
  )
  const renderDisc = ({ section }: RenderDiscProps) =>
    section.title !== null && (
      <Text accessibilityRole="header" style={styles.disc}>
        {section.title}
      </Text>
    )
  return (
    <>
      <DetailSplit
        head={
          <CollectionHead
            actions={
              <>
                <DownloadButton
                  collection={{ kind: DOWNLOAD_SOURCES.album, album }}
                  cover={cover}
                  serverId={session.server.id}
                  title={album.title}
                  tracks={tracks}
                />
                <FavouriteAction
                  isOn={isFavourite}
                  label={PLAYER_COPY.like}
                  onToggle={toggleFavourite}
                />
                <QueueAction onPress={queue} />
              </>
            }
            byline={<ArtistLinks artists={album.artists} />}
            cover={cover}
            meta={albumMetaOf({ details })}
            onMore={openMenu}
            onPlay={play}
            onShuffle={shuffle}
            title={album.title}
          />
        }
        renderList={(frame) => (
          <SectionList
            {...frame}
            keyExtractor={(row) => row.key}
            renderItem={renderRow}
            renderSectionHeader={renderDisc}
            sections={discs}
            stickySectionHeadersEnabled={false}
          />
        )}
      />
      {isMenuOpen && (
        <TracksMenu
          canAddToPlaylist
          head={{ title: album.title, subtitle: artistNames(album), cover }}
          onClose={closeMenu}
          places={{ artist }}
          session={session}
          tracksOf={async () => tracks}
        />
      )}
    </>
  )
}

/**
 * `/album/[id]`: the cover, the artists and the facts, Play and Shuffle, Download, Like and
 * Queue, and the tracks by disc; on a tablet the head and the tracklist side by side.
 */
export function Album() {
  const session = useWren()
  return (
    session !== null && (
      <DetailRoute copy={ALBUM_COPY} queryOf={session.queries.albumQuery}>
        {(details) => <AlbumPage details={details} session={session} />}
      </DetailRoute>
    )
  )
}
