import { type ArtistDetails, QUEUE_SOURCE_KINDS, type Track, routeIdOf } from '@raven/core'
import { useAudioQueue, useServerArtistFavourite } from '@raven/ui/headless'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useLocalSearchParams } from 'expo-router'
import { type ReactNode, useState } from 'react'
import { ScrollView, View } from 'react-native'

import { ACTION_SHAPES } from '@/components/DetailAction'
import { FavouriteAction } from '@/components/FavouriteAction'
import { MENU_VIEWS, type MenuView, TracksMenu } from '@/components/TrackMenu'
import { useCovers } from '@/music/useCovers'
import { WREN_ROUTE_PARAMS } from '@/routes'
import { ARTIST_COPY } from '@/screens/copy'
import { ArtistHero } from '@/screens/detail/ArtistHero'
import { artistMetaOf } from '@/screens/detail/detailFacts'
import { DetailRoute } from '@/screens/detail/DetailRoute'
import { usePageInsets } from '@/shell/useShell'
import { toastFailure } from '@/stores/toast'
import { type WrenTheme, themedStyles, useFormFactor } from '@/theme/wrenTheme'
import { SPACE, FORM_FACTORS, type FormFactor } from '@/theme/wrenTokens'
import { BUTTON_VARIANTS, Button } from '@/ui/Button'
import { AlbumTileOf } from '@/ui/AlbumTile'
import { SectionHeader } from '@/ui/SectionHeader'
import { TileGrid } from '@/ui/TileGrid'
import { ICONS } from '@/ui/WrenIcon'
import { type WrenSession, useWren } from '@/useWren'
import { PLAYER_COPY } from '@/ui/copy'

const useStyles = themedStyles(({ colors }: WrenTheme) => ({
  ground: { backgroundColor: colors.bg, flex: 1 },
  body: { gap: SPACE.s6 },
  phoneActions: { alignItems: 'center', flexDirection: 'row', gap: SPACE.s3 },
  section: { gap: SPACE.s3 },
}))

type ArtistActionsProps = {
  onPlay: () => void
  onShuffle: () => void
  isFollowing: boolean
  onFollow: () => void
}

// Play and Shuffle share a phone's width, and keep their own on a tablet.
const IS_STRETCHED = {
  [FORM_FACTORS.phone]: true,
  [FORM_FACTORS.tablet]: false,
} as const satisfies Record<FormFactor, boolean>

/** Play, Shuffle and Follow; Play and Shuffle share a phone's width, and keep their own on a tablet. */
function ArtistActions({ onPlay, onShuffle, isFollowing, onFollow }: ArtistActionsProps) {
  const isStretched = IS_STRETCHED[useFormFactor()]
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
    </>
  )
}

/** Where each layout puts the actions: under the hero on a phone, in its foot on a tablet. */
type ActionsPlacement = { inHero?: ReactNode; below?: ReactNode }

type PlacementOfProps = { actions: ReactNode }

const PLACEMENTS = {
  [FORM_FACTORS.phone]: ({ actions }: PlacementOfProps): ActionsPlacement => ({ below: actions }),
  [FORM_FACTORS.tablet]: ({ actions }: PlacementOfProps): ActionsPlacement => ({
    inHero: actions,
  }),
} as const satisfies Record<FormFactor, (props: PlacementOfProps) => ActionsPlacement>

type ArtistPageProps = { session: WrenSession; details: ArtistDetails }

function ArtistPage({ session, details }: ArtistPageProps) {
  const styles = useStyles()
  const queryClient = useQueryClient()
  const { coverOf, artistPhotoOf } = useCovers(session)
  const insets = usePageInsets()
  const formFactor = useFormFactor()
  const playTracks = useAudioQueue((store) => store.playTracks)
  const { artist, albums, appearsOn, isFavourite } = details
  const favourite = useServerArtistFavourite({ api: session.api, artistId: artist.id })
  const photo = artistPhotoOf(artist)
  const [menu, setMenu] = useState<MenuView | null>(null)
  const source = { kind: QUEUE_SOURCE_KINDS.artist, id: artist.id } as const
  // The artist's songs are their albums' tracks, read only once something plays them.
  const tracksOf = async (): Promise<readonly Track[]> => {
    const pages = await Promise.all(
      albums.map((album) => queryClient.fetchQuery(session.queries.albumQuery(album.id))),
    )
    return pages.flatMap((page) => page.tracks)
  }
  const play = (isShuffled: boolean) => () => {
    tracksOf().then((tracks) => playTracks({ tracks, source, isShuffled }), toastFailure)
  }
  const follow = () => favourite.attempt({ variables: !isFavourite, onRefused: toastFailure })
  const { inHero, below } = PLACEMENTS[formFactor]({
    actions: (
      <ArtistActions
        isFollowing={isFavourite}
        onFollow={follow}
        onPlay={play(false)}
        onShuffle={play(true)}
      />
    ),
  })
  const sides = { paddingLeft: insets.paddingLeft, paddingRight: insets.paddingRight }
  // TODO(redesign): Top songs, once the server ranks an artist's tracks by plays.
  return (
    <>
      <ScrollView
        contentContainerStyle={[styles.body, { paddingBottom: insets.paddingBottom }]}
        style={styles.ground}
      >
        <ArtistHero
          actions={inHero}
          meta={artistMetaOf({ artist })}
          name={artist.name}
          onMore={() => setMenu(MENU_VIEWS.actions)}
          photo={photo}
          sides={insets.paddingLeft}
        />
        {below !== undefined && <View style={[styles.phoneActions, sides]}>{below}</View>}
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
      {menu !== null && (
        <TracksMenu
          canAddToPlaylist={false}
          head={{ title: artist.name, subtitle: artistMetaOf({ artist }) }}
          onView={setMenu}
          session={session}
          tracksOf={tracksOf}
          view={menu}
        />
      )}
    </>
  )
}

type ServerArtistProps = { session: WrenSession; id: number | null }

function ServerArtist({ session, id }: ServerArtistProps) {
  const artist = useQuery(session.queries.artistQuery(id))
  return (
    <DetailRoute copy={ARTIST_COPY} id={id} query={artist}>
      {(details) => <ArtistPage details={details} session={session} />}
    </DetailRoute>
  )
}

/**
 * `/artist/[id]`: a full-bleed hero with the artist's photo or initial, Play, Shuffle and Follow,
 * their albums, and the albums of others they appear on.
 */
export function Artist() {
  const session = useWren()
  const params = useLocalSearchParams()
  const id = routeIdOf(params[WREN_ROUTE_PARAMS.id])
  return session !== null && <ServerArtist id={id} session={session} />
}
