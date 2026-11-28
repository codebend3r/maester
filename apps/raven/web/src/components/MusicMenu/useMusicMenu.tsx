import {
  type AlbumSummary,
  RAVEN_FACT_WORDING,
  type Track,
  albumInfoOf,
  musicLinksOf,
  trackInfoOf,
} from '@raven/core'
import { type LongPressHandlers, useLongPress } from '@raven/ui/headless'
import { useQuery } from '@tanstack/react-query'
import { type ReactNode, useState } from 'react'
import { MusicMenu } from '@/components/MusicMenu/MusicMenu'
import styles from '@/components/MusicMenu/MusicMenu.module.scss'
import { useAlbumFavourite } from '@/lib/useMusicFavourite'
import { albumQuery } from '@/lib/queries'
import { useAudioQuality } from '@/lib/useAudioQuality'

/** What a cover with a menu is handed, and the menu itself while it is open. */
type CoverMenu = {
  /** Spread on the cover: the long press, and the click and browser menu it keeps back. */
  coverProps: LongPressHandlers
  /** The class the held cover wears, so a finger neither selects it nor raises the system's callout. */
  coverClass: string
  /** Drawn only while open, so a grid of covers reads nothing until one is held. */
  menu: ReactNode
}

type Held = Pick<CoverMenu, 'coverProps'> & { isOpen: boolean; close: () => void }

/** Whether a cover's menu is open, and the long press that opens it. */
const useHeld = (): Held => {
  const [isOpen, setOpen] = useState(false)
  const coverProps = useLongPress({ onLongPress: () => setOpen(true) })
  return { coverProps, isOpen, close: () => setOpen(false) }
}

type AlbumMenuProps = {
  album: AlbumSummary
  /** On the album's own page, where Go to album is left out. */
  isOnAlbum: boolean
  onClose: () => void
}

/** An album's menu: its summary's facts at once, its genres, label and heart once its page is read. */
const AlbumMenu = ({ album, isOnAlbum, onClose }: AlbumMenuProps) => {
  const details = useQuery(albumQuery(album.id))
  const favourite = useAlbumFavourite({ albumId: album.id })
  const isOn = details.data?.isFavourite
  return (
    <MusicMenu
      title={album.title}
      facts={albumInfoOf({ album, extras: details.data ?? null, wording: RAVEN_FACT_WORDING })}
      links={musicLinksOf({ albumId: isOnAlbum ? null : album.id, artists: album.artists })}
      favourite={isOn === undefined ? null : { isOn, onToggle: favourite.mutate }}
      onClose={onClose}
    />
  )
}

type UseAlbumMenuProps = Omit<AlbumMenuProps, 'onClose'>

/** A long press on an album's cover, under a finger only, opens what is known of it and where to go. */
export const useAlbumMenu = ({ album, isOnAlbum }: UseAlbumMenuProps): CoverMenu => {
  const { coverProps, isOpen, close } = useHeld()
  return {
    coverProps,
    coverClass: styles.held,
    menu: isOpen && <AlbumMenu album={album} isOnAlbum={isOnAlbum} onClose={close} />,
  }
}

type TrackMenuProps = { track: Track; onClose: () => void }

/** The playing track's menu: its facts, its album's date once read, and the quality it plays in. */
const TrackMenu = ({ track, onClose }: TrackMenuProps) => {
  const details = useQuery(albumQuery(track.albumId))
  const quality = useAudioQuality({ track })
  return (
    <MusicMenu
      title={track.title}
      facts={trackInfoOf({
        track,
        details: details.data ?? null,
        quality,
        wording: RAVEN_FACT_WORDING,
      })}
      links={musicLinksOf({ albumId: track.albumId, artists: track.artists })}
      favourite={null}
      onClose={onClose}
    />
  )
}

type UseTrackMenuProps = Omit<TrackMenuProps, 'onClose'>

/** A long press on the playing track's cover, under a finger only, opens what is known of it. */
export const useTrackMenu = ({ track }: UseTrackMenuProps): CoverMenu => {
  const { coverProps, isOpen, close } = useHeld()
  return {
    coverProps,
    coverClass: styles.held,
    menu: isOpen && <TrackMenu track={track} onClose={close} />,
  }
}
