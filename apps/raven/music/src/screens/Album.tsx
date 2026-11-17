import {
  type AlbumDetails,
  type AlbumTrack,
  QUEUE_SOURCE_KINDS,
  albumDiscsOf,
  artistNames,
  routeIdOf,
} from '@raven/core'
import { playingTrackOf, useAudioQueue, useServerAlbumFavourite } from '@raven/ui/headless'
import { useQuery } from '@tanstack/react-query'
import { useLocalSearchParams } from 'expo-router'
import { useState } from 'react'
import { SectionList, Text } from 'react-native'

import { DetailAction } from '@/components/DetailAction'
import { DownloadButton } from '@/components/DownloadButton'
import { FavouriteAction } from '@/components/FavouriteAction'
import { MENU_VIEWS, type MenuView, TracksMenu } from '@/components/TrackMenu'
import { TrackRow } from '@/components/TrackRow'
import { DOWNLOAD_SOURCES } from '@/downloads/downloadStore'
import { useCovers } from '@/music/useCovers'
import { WREN_ROUTE_PARAMS } from '@/routes'
import { ALBUM_COPY } from '@/screens/copy'
import { ArtistLinks } from '@/screens/detail/ArtistLinks'
import { CollectionHead } from '@/screens/detail/CollectionHead'
import { albumMetaOf } from '@/screens/detail/detailFacts'
import { DetailRoute } from '@/screens/detail/DetailRoute'
import { DetailSplit } from '@/screens/detail/DetailSplit'
import { useToast } from '@/stores/toast'
import { type WrenTheme, themedStyles, useFormFactor, useWrenTheme } from '@/theme/wrenTheme'
import { SPACE, TYPE, FORM_FACTORS, type FormFactor } from '@/theme/wrenTokens'
import { PLAYER_COPY } from '@/ui/copy'
import { SONG_LEADS } from '@/ui/songLead'
import { ICONS, WrenIcon } from '@/ui/WrenIcon'
import { type WrenSession, useWren } from '@/useWren'

// A tablet's tracklist marks the playing row with a soft fill as well as the equalizer.
const IS_ROW_HIGHLIGHTED = {
  [FORM_FACTORS.phone]: false,
  [FORM_FACTORS.tablet]: true,
} as const satisfies Record<FormFactor, boolean>

const useStyles = themedStyles(({ colors }: WrenTheme) => ({
  disc: { ...TYPE.overline, color: colors.text3, paddingBottom: SPACE.s2, paddingTop: SPACE.s5 },
}))

type AlbumPageProps = { session: WrenSession; details: AlbumDetails }

type AlbumDisc = { key: string; title: string | null; data: AlbumTrack[] }

type RenderRowProps = { item: AlbumTrack }

type RenderDiscProps = { section: AlbumDisc }

function AlbumPage({ session, details }: AlbumPageProps) {
  const styles = useStyles()
  const { colors } = useWrenTheme()
  const formFactor = useFormFactor()
  const { coverOf } = useCovers(session)
  const playingId = useAudioQueue((store) => playingTrackOf(store)?.id ?? null)
  const playTracks = useAudioQueue((store) => store.playTracks)
  const addToQueue = useAudioQueue((store) => store.addToQueue)
  const toast = useToast((state) => state.show)
  const { album, tracks, discCount, isFavourite } = details
  const favourite = useServerAlbumFavourite({ api: session.api, albumId: album.id })
  const [menu, setMenu] = useState<MenuView | null>(null)
  const source = { kind: QUEUE_SOURCE_KINDS.album, id: album.id } as const
  const cover = coverOf({ albumId: album.id, coverVersion: album.coverVersion })
  const discs = albumDiscsOf({ tracks, discCount }).map(({ key, title, tracks: data }) => ({
    key,
    title,
    data,
  }))
  const [artist] = album.artists
  const toggleFavourite = () =>
    favourite.attempt({
      variables: !isFavourite,
      onRefused: (error) => toast(error.message),
    })
  const queueAlbum = () => {
    addToQueue(tracks)
    toast(ALBUM_COPY.queued(album.title))
  }
  const renderRow = ({ item }: RenderRowProps) => {
    const track = tracks[item.index]
    return (
      track !== undefined && (
        <TrackRow
          isCurrent={item.id === playingId}
          isHighlighted={IS_ROW_HIGHLIGHTED[formFactor]}
          label={item.label}
          length={item.length}
          lead={{ kind: SONG_LEADS.number, number: item.number }}
          onPress={() => playTracks({ tracks, startAt: item.index, source })}
          track={track}
        />
      )
    )
  }
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
                <DetailAction
                  glyph={<WrenIcon color={colors.text2} name={ICONS.queueAdd} />}
                  label={PLAYER_COPY.queue}
                  onPress={queueAlbum}
                />
              </>
            }
            byline={<ArtistLinks artists={album.artists} />}
            cover={cover}
            meta={albumMetaOf({ details })}
            onMore={() => setMenu(MENU_VIEWS.actions)}
            onPlay={() => playTracks({ tracks, source })}
            onShuffle={() => playTracks({ tracks, source, isShuffled: true })}
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
      {menu !== null && (
        <TracksMenu
          canAddToPlaylist
          head={{ title: album.title, subtitle: artistNames(album), cover }}
          onView={setMenu}
          places={{ artist }}
          session={session}
          tracksOf={async () => tracks}
          view={menu}
        />
      )}
    </>
  )
}

type ServerAlbumProps = { session: WrenSession; id: number | null }

function ServerAlbum({ session, id }: ServerAlbumProps) {
  const album = useQuery(session.queries.albumQuery(id))
  return (
    <DetailRoute copy={ALBUM_COPY} id={id} query={album}>
      {(details) => <AlbumPage details={details} session={session} />}
    </DetailRoute>
  )
}

/**
 * `/album/[id]`: the cover, the artists and the facts, Play and Shuffle, Download, Like and
 * Queue, and the tracks by disc; on a tablet the head and the tracklist side by side.
 */
export function Album() {
  const session = useWren()
  const params = useLocalSearchParams()
  const id = routeIdOf(params[WREN_ROUTE_PARAMS.id])
  return session !== null && <ServerAlbum id={id} session={session} />
}
