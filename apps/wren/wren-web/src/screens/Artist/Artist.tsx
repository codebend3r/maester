import { type AlbumSummary, type ArtistDetails, QUEUE_SOURCE_KINDS } from '@raven/core'
import { useAudioQueue, useIsOwner, useServerArtistFavourite } from '@raven/ui/headless'
import { ARTIST_COPY, PLAYER_COPY, artistMetaOf, WREN_ICONS } from '@raven/wren'
import { useQuery } from '@tanstack/react-query'
import { type ComponentType, type ReactNode, useState } from 'react'
import { AlbumGrid } from '@/components/AlbumGrid/AlbumGrid'
import { ACTION_SHAPES, DetailAction } from '@/components/DetailAction/DetailAction'
import { FavouriteAction } from '@/components/FavouriteAction/FavouriteAction'
import { Nothing } from '@/components/Nothing/Nothing'
import { PlayButtons } from '@/components/PlayButtons/PlayButtons'
import { Section } from '@/components/Section/Section'
import { TracksMenu } from '@/components/TrackMenu/TrackMenu'
import { api } from '@/lib/api'
import { queries } from '@/lib/queries'
import { useAlbumTracks } from '@/music/useAlbumTracks'
import { useCovers } from '@/music/useCovers'
import { ArtistBackgroundModal } from '@/screens/Artist/ArtistBackgroundModal'
import { ArtistHero, HeroActions } from '@/screens/Artist/ArtistHero'
import { DetailRoute } from '@/screens/detail/DetailRoute'
import { Page } from '@/shell/Page/Page'
import { useAuthSession } from '@/stores/authSession'
import { toastFailure } from '@/stores/toast'
import { FORM_FACTORS, type FormFactor, useFormFactor } from '@/theme/formFactor'
import styles from '@/screens/Artist/Artist.module.scss'

type ActionsSlotProps = { children: ReactNode }

/** Play, Shuffle and Follow in a row of their own under the hero, as the narrow layout holds them. */
function ActionsRow({ children }: ActionsSlotProps) {
  return <div className={styles.actions}>{children}</div>
}

type ArtistLayout = {
  /** Whether Play and Shuffle share the width they are given. */
  isStretched: boolean
  /** What holds the actions under the hero. */
  Below: ComponentType<ActionsSlotProps>
  /** What holds the actions at the hero's foot. */
  InHero: ComponentType<ActionsSlotProps>
}

/*
 * Where each layout puts the actions, and how wide: under the hero on the narrow one, Play and
 * Shuffle sharing its width; in the hero's foot on the wide one, each keeping its own.
 */
const ARTIST_LAYOUTS = {
  [FORM_FACTORS.phone]: { isStretched: true, Below: ActionsRow, InHero: Nothing },
  [FORM_FACTORS.tablet]: { isStretched: false, Below: Nothing, InHero: HeroActions },
} as const satisfies Record<FormFactor, ArtistLayout>

/** An artist's own albums say their year where another list says the artists. */
const yearOf = (album: AlbumSummary): string => String(album.year ?? '')

type ArtistPageProps = { details: ArtistDetails }

function ArtistPage({ details }: ArtistPageProps) {
  const albumTracks = useAlbumTracks()
  const { artistPhotoOf } = useCovers()
  const { isStretched, Below, InHero }: ArtistLayout = ARTIST_LAYOUTS[useFormFactor()]
  const playTracks = useAudioQueue((store) => store.playTracks)
  const { artist, albums, appearsOn, isFavourite } = details
  const favourite = useServerArtistFavourite({ api, artistId: artist.id })
  const photo = artistPhotoOf(artist)
  const about = useQuery(queries.artistAboutQuery(artist.id))
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const [isBackgroundOpen, setIsBackgroundOpen] = useState(false)
  const userId = useAuthSession((state) => state.session?.userId ?? null)
  const isOwner = useIsOwner({ queries, userId })
  const source = { kind: QUEUE_SOURCE_KINDS.artist, id: artist.id } as const
  // The artist's songs are their albums' tracks, read only once something plays them.
  const tracksOf = () => albumTracks(albums.map(({ id }) => id))
  const play = (isShuffled: boolean) => () => {
    tracksOf().then((tracks) => playTracks({ tracks, source, isShuffled }), toastFailure)
  }
  const follow = () => favourite.attempt({ variables: !isFavourite, onRefused: toastFailure })
  const actions = (
    <>
      <PlayButtons isStretched={isStretched} onPlay={play(false)} onShuffle={play(true)} />
      <FavouriteAction
        isOn={isFavourite}
        label={PLAYER_COPY.follow}
        onToggle={follow}
        shape={ACTION_SHAPES.circle}
      />
      {isOwner && (
        <DetailAction
          icon={WREN_ICONS.image}
          label={ARTIST_COPY.editBackground}
          onPress={() => setIsBackgroundOpen(true)}
          shape={ACTION_SHAPES.circle}
        />
      )}
    </>
  )
  // TODO(redesign): Top songs, once the server ranks an artist's tracks by plays.
  return (
    <>
      <Page className={styles.artist}>
        <ArtistHero
          about={about.data ?? null}
          actions={<InHero>{actions}</InHero>}
          meta={artistMetaOf({ artist })}
          name={artist.name}
          onMore={() => setIsMenuOpen(true)}
          photo={photo}
        />
        <Below>{actions}</Below>
        {albums.length > 0 && (
          <Section className={styles.section} title={ARTIST_COPY.albums}>
            <AlbumGrid albums={albums} subtitleOf={yearOf} />
          </Section>
        )}
        {appearsOn.length > 0 && (
          <Section className={styles.section} title={ARTIST_COPY.appearsOn}>
            <AlbumGrid albums={appearsOn} />
          </Section>
        )}
      </Page>
      {isOwner && (
        <ArtistBackgroundModal
          artistId={artist.id}
          artistName={artist.name}
          isOpen={isBackgroundOpen}
          onClose={() => setIsBackgroundOpen(false)}
        />
      )}
      {isMenuOpen && (
        <TracksMenu
          canAddToPlaylist={false}
          head={{ title: artist.name, subtitle: artistMetaOf({ artist }) }}
          onClose={() => setIsMenuOpen(false)}
          places={{}}
          tracksOf={tracksOf}
        />
      )}
    </>
  )
}

/**
 * `/artist/:id`: a full-bleed hero with the artist's photo or initial, Play, Shuffle and Follow,
 * their albums, and the albums of others they appear on.
 */
export function Artist() {
  return (
    <DetailRoute copy={ARTIST_COPY} queryOf={queries.artistQuery}>
      {(details) => <ArtistPage details={details} />}
    </DetailRoute>
  )
}
