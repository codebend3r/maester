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
import { useQuery } from '@tanstack/react-query'
import type { ComponentProps } from 'react'
import { useNavigate } from 'react-router-dom'
import { queries } from '@/lib/queries'
import { useCovers } from '@/music/useCovers'
import { albumPath, artistPath } from '@/routes'
import { BottomSheet } from '@/ui/BottomSheet/BottomSheet'
import { FactRow } from '@/ui/FactRow/FactRow'
import { GroupedList } from '@/ui/GroupedList/GroupedList'
import { SheetActions } from '@/ui/SheetActions/SheetActions'
import styles from '@/ui/CoverMenu/CoverMenu.module.scss'

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
  const navigate = useNavigate()
  const goTo = (path: string) => {
    onClose()
    navigate(path)
  }
  const goes = placeActionsOf({
    icons: WREN_ICONS,
    places,
    onAlbum: (albumId) => goTo(albumPath(albumId)),
    onArtist: (artistId) => goTo(artistPath(artistId)),
  })
  return (
    <BottomSheet head={head} isOpen onClose={onClose}>
      {facts.length > 0 && (
        <div className={styles.facts}>
          <GroupedList>
            {facts.map(({ key, value }) => (
              <FactRow key={key} label={COVER_FACT_LABELS[key]} value={value} />
            ))}
          </GroupedList>
        </div>
      )}
      <SheetActions groups={[goes]} />
    </BottomSheet>
  )
}

type AlbumCoverMenuProps = { album: AlbumSummary; onClose: () => void }

/**
 * The menu a held album cover opens: the album's release, genres, label, songs, length and
 * format (the page's facts once it is read), then Go to album and Go to artist.
 */
export function AlbumCoverMenu({ album, onClose }: AlbumCoverMenuProps) {
  const { coverOf } = useCovers()
  const details = useQuery(queries.albumQuery(album.id))
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

type TrackCoverMenuProps = { track: Track; onClose: () => void }

/**
 * The menu a held track cover opens, the playing song's or a row's: its album, the album's
 * release and genres once read, its length and format, then Go to album and Go to artist.
 */
export function TrackCoverMenu({ track, onClose }: TrackCoverMenuProps) {
  const { trackCoverOf } = useCovers()
  const details = useQuery(queries.albumQuery(track.albumId))
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
