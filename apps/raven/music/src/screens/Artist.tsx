import { type ArtistDetails, QUEUE_SOURCE_KINDS } from '@raven/core'
import { useAudioQueue, useIsOwner, useServerArtistFavourite } from '@raven/ui/headless'
import { ARTIST_COPY, artistMetaOf, PLAYER_COPY } from '@raven/wren'
import { useQuery } from '@tanstack/react-query'
import { type ComponentType, type ReactNode, useState } from 'react'
import { ScrollView, View } from 'react-native'

import { ACTION_SHAPES, DetailAction } from '@/components/DetailAction'
import { FavouriteAction } from '@/components/FavouriteAction'
import { Nothing } from '@/components/Nothing'
import { TracksMenu } from '@/components/TrackMenu'
import { useAlbumTracks } from '@/music/useAlbumTracks'
import { useCovers } from '@/music/useCovers'
import { ArtistHero, HeroActions } from '@/screens/detail/ArtistHero'
import { DetailRoute } from '@/screens/detail/DetailRoute'
import { EditBackgroundSheet } from '@/screens/detail/EditBackgroundSheet'
import { usePageInsets } from '@/shell/useShell'
import { useWrenAccount } from '@/session'
import { toastFailure } from '@/stores/toast'
import { type WrenTheme, themedStyles, useFormFactor, useWrenTheme } from '@/theme/wrenTheme'
import { SPACE, FORM_FACTORS, type FormFactor } from '@/theme/wrenTokens'
import { BUTTON_VARIANTS, Button } from '@/ui/Button'
import { AlbumTileOf } from '@/ui/AlbumTile'
import { SectionHeader } from '@/ui/SectionHeader'
import { TileGrid } from '@/ui/TileGrid'
import { ICONS, WrenIcon } from '@/ui/WrenIcon'
import type { WrenSession } from '@/useWren'

const useStyles = themedStyles(({ colors }: WrenTheme) => ({
  ground: { backgroundColor: colors.bg, flex: 1 },
  body: { gap: SPACE.s6 },
  phoneActions: { alignItems: 'center', flexDirection: 'row', gap: SPACE.s3 },
  section: { gap: SPACE.s3 },
}))

type ArtistActionsProps = {
  /** Whether Play and Shuffle share the width they are given. */
  isStretched: boolean
  onPlay: () => void
  onShuffle: () => void
  isFollowing: boolean
  onFollow: () => void
  /** Opens the sheet of backgrounds, for the owner; null for everyone else, who has no button. */
  onEditBackground: (() => void) | null
}

/** Play, Shuffle and Follow, and for the owner the button that edits the background image. */
function ArtistActions({
  isStretched,
  onPlay,
  onShuffle,
  isFollowing,
  onFollow,
  onEditBackground,
}: ArtistActionsProps) {
  const { colors } = useWrenTheme()
  return (
    <>
      <Button
        icon={ICONS.play}
        isStretched={isStretched}
        label={PLAYER_COPY.play}
        onPress={onPlay}
      />
      <Button
        icon={ICONS.shuffle}
        isStretched={isStretched}
        label={PLAYER_COPY.shuffle}
        onPress={onShuffle}
        variant={BUTTON_VARIANTS.secondary}
      />
      <FavouriteAction
        isOn={isFollowing}
        label={PLAYER_COPY.follow}
        onToggle={onFollow}
        shape={ACTION_SHAPES.circle}
      />
      {onEditBackground !== null && (
        <DetailAction
          glyph={<WrenIcon color={colors.text2} name={ICONS.image} />}
          label={ARTIST_COPY.editBackground}
          onPress={onEditBackground}
          shape={ACTION_SHAPES.circle}
        />
      )}
    </>
  )
}

type ActionsSlotProps = { children: ReactNode }

/** Play, Shuffle and Follow in a row of their own under the hero, as a phone holds them. */
function ActionsRow({ children }: ActionsSlotProps) {
  const styles = useStyles()
  const { paddingLeft, paddingRight } = usePageInsets()
  return <View style={[styles.phoneActions, { paddingLeft, paddingRight }]}>{children}</View>
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
 * Where each form factor puts the actions, and how wide: under the hero on a phone, Play and
 * Shuffle sharing its width; in the hero's foot on a tablet, each keeping its own.
 */
const ARTIST_LAYOUTS = {
  [FORM_FACTORS.phone]: { isStretched: true, Below: ActionsRow, InHero: Nothing },
  [FORM_FACTORS.tablet]: { isStretched: false, Below: Nothing, InHero: HeroActions },
} as const satisfies Record<FormFactor, ArtistLayout>

type ArtistPageProps = { session: WrenSession; details: ArtistDetails }

function ArtistPage({ session, details }: ArtistPageProps) {
  const styles = useStyles()
  const albumTracks = useAlbumTracks(session)
  const { coverOf, artistPhotoOf } = useCovers(session)
  const insets = usePageInsets()
  const { isStretched, Below, InHero }: ArtistLayout = ARTIST_LAYOUTS[useFormFactor()]
  const playTracks = useAudioQueue((store) => store.playTracks)
  const { artist, albums, appearsOn, isFavourite } = details
  const favourite = useServerArtistFavourite({ api: session.api, artistId: artist.id })
  const photo = artistPhotoOf(artist)
  const about = useQuery(session.queries.artistAboutQuery(artist.id))
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const [isBackgroundOpen, setIsBackgroundOpen] = useState(false)
  const userId = useWrenAccount((state) => state.session?.userId ?? null)
  const isOwner = useIsOwner({ queries: session.queries, userId })
  const source = { kind: QUEUE_SOURCE_KINDS.artist, id: artist.id } as const
  // The artist's songs are their albums' tracks, read only once something plays them.
  const tracksOf = () => albumTracks(albums.map(({ id }) => id))
  const play = (isShuffled: boolean) => () => {
    tracksOf().then((tracks) => playTracks({ tracks, source, isShuffled }), toastFailure)
  }
  const follow = () => favourite.attempt({ variables: !isFavourite, onRefused: toastFailure })
  const actions = (
    <ArtistActions
      isFollowing={isFavourite}
      isStretched={isStretched}
      onEditBackground={isOwner ? () => setIsBackgroundOpen(true) : null}
      onFollow={follow}
      onPlay={play(false)}
      onShuffle={play(true)}
    />
  )
  const sides = { paddingLeft: insets.paddingLeft, paddingRight: insets.paddingRight }
  // TODO(redesign): Top songs, once the server ranks an artist's tracks by plays.
  return (
    <>
      <ScrollView
        contentContainerStyle={[styles.body, { paddingBottom: insets.paddingBottom }]}
        style={styles.ground}
      >
        <ArtistHero
          about={about.data ?? null}
          actions={<InHero>{actions}</InHero>}
          meta={artistMetaOf({ artist })}
          name={artist.name}
          onMore={() => setIsMenuOpen(true)}
          photo={photo}
          sides={insets.paddingLeft}
        />
        <Below>{actions}</Below>
        {albums.length > 0 && (
          <View style={[styles.section, sides]}>
            <SectionHeader title={ARTIST_COPY.albums} />
            <TileGrid
              items={albums}
              keyOf={(album) => album.id}
              renderTile={({ item, width }) => (
                <AlbumTileOf
                  album={item}
                  coverOf={coverOf}
                  subtitle={String(item.year ?? '')}
                  width={width}
                />
              )}
            />
          </View>
        )}
        {appearsOn.length > 0 && (
          <View style={[styles.section, sides]}>
            <SectionHeader title={ARTIST_COPY.appearsOn} />
            <TileGrid
              items={appearsOn}
              keyOf={(album) => album.id}
              renderTile={({ item, width }) => (
                <AlbumTileOf album={item} coverOf={coverOf} width={width} />
              )}
            />
          </View>
        )}
      </ScrollView>
      {isOwner && (
        <EditBackgroundSheet
          artistId={artist.id}
          artistName={artist.name}
          isOpen={isBackgroundOpen}
          onClose={() => setIsBackgroundOpen(false)}
          session={session}
        />
      )}
      {isMenuOpen && (
        <TracksMenu
          canAddToPlaylist={false}
          head={{ title: artist.name, subtitle: artistMetaOf({ artist }) }}
          onClose={() => setIsMenuOpen(false)}
          places={{}}
          session={session}
          tracksOf={tracksOf}
        />
      )}
    </>
  )
}

/**
 * `/artist/[id]`: a full-bleed hero with the artist's photo or initial, Play, Shuffle and Follow,
 * their albums, and the albums of others they appear on.
 */
export function Artist() {
  return (
    <DetailRoute Page={ArtistPage} copy={ARTIST_COPY} queryOf={(queries) => queries.artistQuery} />
  )
}
