import {
  type AlbumDetails,
  type AlbumTrack,
  QUEUE_SOURCE_KINDS,
  albumDiscsOf,
  artistNames,
} from '@raven/core'
import { useServerAlbumFavourite } from '@raven/ui/headless'
import { ALBUM_COPY, PLAYER_COPY, SONG_LEADS, albumMetaOf } from '@raven/wren'
import { SectionList, Text } from 'react-native'

import { TrackRow } from '@/components/TrackRow'
import { useCovers, toastFailure, type WrenSession } from '@raven/wren-native'
import { ArtistLinks } from '@/screens/detail/ArtistLinks'
import { DetailHead } from '@/screens/detail/DetailHead'
import { DetailRoute } from '@/screens/detail/DetailRoute'
import { DetailSplit } from '@/screens/detail/DetailSplit'
import { QueueButton } from '@/screens/detail/QueueButton'
import { useTracklistRows } from '@/screens/detail/useTracklistRows'
import { SPACE, TYPE } from '@/theme/tvTokens'
import { themedStyles } from '@/theme/wrenTheme'
import { FavouriteButton } from '@/ui/FavouriteButton'

const useStyles = themedStyles(({ colors }) => ({
  disc: { ...TYPE.overline, color: colors.text3, paddingBottom: SPACE.s2, paddingTop: SPACE.s4 },
}))

type AlbumPageProps = { session: WrenSession; details: AlbumDetails }

type AlbumDisc = { key: string; title: string | null; data: AlbumTrack[] }

type RenderRowProps = { item: AlbumTrack }

type RenderDiscProps = { section: AlbumDisc }

function AlbumPage({ session, details }: AlbumPageProps) {
  const styles = useStyles()
  const { coverOf } = useCovers(session)
  const { album, tracks, discCount, isFavourite } = details
  const favourite = useServerAlbumFavourite({ api: session.api, albumId: album.id })
  const source = { kind: QUEUE_SOURCE_KINDS.album, id: album.id } as const
  const tracksOf = async () => tracks
  const rowPropsOf = useTracklistRows({ tracks, source })
  const cover = coverOf({ albumId: album.id, coverVersion: album.coverVersion })
  const discs = albumDiscsOf({ tracks, discCount }).map(({ key, title, tracks: data }) => ({
    key,
    title,
    data,
  }))
  const toggleFavourite = () =>
    favourite.attempt({ variables: !isFavourite, onRefused: toastFailure })
  const renderRow = ({ item }: RenderRowProps) => (
    <TrackRow {...rowPropsOf(item)} lead={{ kind: SONG_LEADS.number, number: item.number }} />
  )
  const renderDisc = ({ section }: RenderDiscProps) =>
    section.title !== null && (
      <Text accessibilityRole="header" style={styles.disc}>
        {section.title}
      </Text>
    )
  return (
    <DetailSplit
      head={
        <DetailHead
          actions={
            <>
              <FavouriteButton
                isOn={isFavourite}
                label={PLAYER_COPY.like}
                onToggle={toggleFavourite}
              />
              <QueueButton queued={ALBUM_COPY.queued(album.title)} tracksOf={tracksOf} />
            </>
          }
          byline={<ArtistLinks artists={album.artists} />}
          cover={cover}
          menu={{
            canAddToPlaylist: true,
            line: artistNames(album),
            places: { artists: album.artists },
          }}
          meta={albumMetaOf({ details })}
          session={session}
          source={source}
          title={album.title}
          tracksOf={tracksOf}
        />
      }
      list={
        <SectionList
          keyExtractor={(row) => row.key}
          renderItem={renderRow}
          renderSectionHeader={renderDisc}
          sections={discs}
          stickySectionHeadersEnabled={false}
        />
      }
    />
  )
}

/**
 * `/album/[id]`: the cover, the artists and the facts, Play and Shuffle, Like, Queue and More in
 * a column at the left, and the tracks by disc beside them. A TV keeps no downloads, so there is
 * no Download.
 */
export function Album() {
  return (
    <DetailRoute Page={AlbumPage} copy={ALBUM_COPY} queryOf={(queries) => queries.albumQuery} />
  )
}
