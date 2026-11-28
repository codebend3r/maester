import {
  type AlbumSummary,
  type MusicFact,
  type Track,
  albumInfoOf,
  artistNames,
  trackInfoOf,
} from '@raven/core'
import {
  COVER_FACT_LABELS,
  COVER_FACT_WORDING,
  type MenuPlaces,
  WREN_ICONS,
  placeActionsOf,
} from '@raven/wren'
import { type WrenSession, useCovers, useWren } from '@raven/wren-native'
import { WREN_PAGES, pageHref } from '@raven/wren-native/headless'
import { useQuery } from '@tanstack/react-query'
import { useRouter } from 'expo-router'
import { type ComponentProps } from 'react'
import { View } from 'react-native'

import { themedStyles } from '@/theme/wrenTheme'
import { SPACE } from '@/theme/wrenTokens'
import { BottomSheet } from '@/ui/BottomSheet'
import { FactRow } from '@/ui/FactRow'
import { GroupedList } from '@/ui/GroupedList'
import { SheetActions } from '@/ui/SheetActions'

// The facts sit between the sheet's head and its places, inset as the head's words are.
const useStyles = themedStyles(() => ({
  facts: { paddingHorizontal: SPACE.s2, paddingTop: SPACE.s3 },
}))

type CoverMenuProps = {
  /** What the menu is about, at its top: the cover, the title and the artists. */
  head: ComponentProps<typeof BottomSheet>['head']
  facts: readonly MusicFact[]
  /** Where it goes from here: the album, and the first of the artists, as the track menu does. */
  places: MenuPlaces
  onClose: () => void
}

/** A held cover's sheet: what the music is, then Go to album and Go to artist. */
function CoverMenu({ head, facts, places, onClose }: CoverMenuProps) {
  const styles = useStyles()
  const router = useRouter()
  const goTo = (href: ReturnType<typeof pageHref>) => {
    onClose()
    router.push(href)
  }
  const goes = placeActionsOf({
    icons: WREN_ICONS,
    places,
    onAlbum: (albumId) => goTo(pageHref({ page: WREN_PAGES.album, id: albumId })),
    onArtist: (artistId) => goTo(pageHref({ page: WREN_PAGES.artist, id: artistId })),
  })
  return (
    <BottomSheet head={head} isOpen onClose={onClose}>
      {facts.length > 0 && (
        <View style={styles.facts}>
          <GroupedList>
            {facts.map(({ key, value }) => (
              <FactRow key={key} label={COVER_FACT_LABELS[key]} value={value} />
            ))}
          </GroupedList>
        </View>
      )}
      <SheetActions groups={[goes]} />
    </BottomSheet>
  )
}

type AlbumCoverMenuProps = { album: AlbumSummary; onClose: () => void }

type AlbumCoverMenuOfProps = AlbumCoverMenuProps & { session: WrenSession }

function AlbumCoverMenuOf({ session, album, onClose }: AlbumCoverMenuOfProps) {
  const { coverOf } = useCovers(session)
  const details = useQuery(session.queries.albumQuery(album.id))
  return (
    <CoverMenu
      facts={albumInfoOf({
        album,
        extras: details.data ?? null,
        wording: COVER_FACT_WORDING,
      })}
      head={{
        title: album.title,
        subtitle: artistNames(album),
        cover: coverOf({ albumId: album.id, coverVersion: album.coverVersion }),
      }}
      onClose={onClose}
      places={{ albumId: album.id, artists: album.artists }}
    />
  )
}

/**
 * The menu a held album cover opens: the album's release, genres, label, songs, length and
 * format (the page's facts once it is read), then Go to album and Go to artist.
 */
export function AlbumCoverMenu(props: AlbumCoverMenuProps) {
  const session = useWren()
  return session !== null && <AlbumCoverMenuOf {...props} session={session} />
}

type TrackCoverMenuProps = { track: Track; onClose: () => void }

type TrackCoverMenuOfProps = TrackCoverMenuProps & { session: WrenSession }

function TrackCoverMenuOf({ session, track, onClose }: TrackCoverMenuOfProps) {
  const { trackCoverOf } = useCovers(session)
  const details = useQuery(session.queries.albumQuery(track.albumId))
  return (
    <CoverMenu
      facts={trackInfoOf({
        track,
        details: details.data ?? null,
        quality: null,
        wording: COVER_FACT_WORDING,
      })}
      head={{ title: track.title, subtitle: artistNames(track), cover: trackCoverOf(track) }}
      onClose={onClose}
      places={{ albumId: track.albumId, artists: track.artists }}
    />
  )
}

/**
 * The menu a held track cover opens, the playing song's or a row's: its album, the album's
 * release and genres once read, its length and format, then Go to album and Go to artist.
 */
export function TrackCoverMenu(props: TrackCoverMenuProps) {
  const session = useWren()
  return session !== null && <TrackCoverMenuOf {...props} session={session} />
}
