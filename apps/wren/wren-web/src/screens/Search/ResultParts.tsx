import { WREN_ICONS } from '@raven/wren'
import { type Artist, type Track, artistNames } from '@raven/core'
import {
  KIT_COPY,
  SEARCH_COPY,
  type SearchFilter,
  TOP_RESULT_KINDS,
  type TopResult,
} from '@raven/wren'
import type { ComponentType, ReactNode } from 'react'
import { useCovers } from '@/music/useCovers'
import { albumPath, artistPath } from '@/routes'
import type { ResultActions } from '@/screens/Search/useResultActions'
import type { SearchResults as Results } from '@/screens/Search/useSearchResults'
import { FORM_FACTORS } from '@/theme/formFactor'
import { COLORS, SIZES } from '@/theme/tokens'
import { AlbumArt } from '@/ui/AlbumArt/AlbumArt'
import { ArtistAvatar } from '@/ui/ArtistAvatar/ArtistAvatar'
import { BUTTON_VARIANTS } from '@/ui/Button/Button'
import { Card } from '@/ui/Card/Card'
import { EmptyState } from '@/ui/EmptyState/EmptyState'
import { IconButton } from '@/ui/IconButton/IconButton'
import { type Press, Pressable } from '@/ui/Pressable/Pressable'
import { GRID_COLUMNS, type GridColumns } from '@/ui/TileGrid/TileGrid'
import styles from '@/screens/Search/ResultParts.module.scss'

/** What every view of a search's results is handed. */
export type ResultsProps = {
  results: Results
  query: string
  filter: SearchFilter
  onFilter: (filter: SearchFilter) => void
  onClear: () => void
  actions: ResultActions
}

// Album tiles to a row under the Albums chip, and in the wide layout's All.
export const ALBUM_COLUMNS = {
  [FORM_FACTORS.phone]: GRID_COLUMNS[FORM_FACTORS.phone],
  [FORM_FACTORS.tablet]: 4,
} as const satisfies GridColumns

/** Nothing matched, the whole search or the kind a chip narrowed it to, with a way to clear it. */
export function NoMatches({ query, onClear }: ResultsProps) {
  return (
    <EmptyState
      action={{
        label: SEARCH_COPY.clearSearch,
        onPress: onClear,
        variant: BUTTON_VARIANTS.secondary,
      }}
      body={SEARCH_COPY.noMatchesHint}
      icon={WREN_ICONS.search}
      title={SEARCH_COPY.noMatches(query)}
    />
  )
}

type TopCardProps = {
  art: ReactNode
  kind: string
  title: string
  subtitle: string | null
  /** What a press on the card does: a link to an album's or an artist's page, or a song played. */
  open: Press
  /** Play: shown for a song or an album. */
  onPlay?: () => void
}

/** The top result as a card: its art, what it is, its title and line, and Play. */
function TopCard({ art, kind, title, subtitle, open, onPlay }: TopCardProps) {
  return (
    <Card className={styles.card}>
      <Pressable
        {...open}
        className={styles.cardMain}
        label={KIT_COPY.labelled({ label: SEARCH_COPY.topResult({ kind }), value: title })}
      >
        {art}
        <span className={styles.cardText}>
          <span className={styles.overline}>{SEARCH_COPY.topResult({ kind })}</span>
          <span className={styles.cardTitle}>{title}</span>
          {subtitle !== null && <span className={styles.cardSubtitle}>{subtitle}</span>}
        </span>
      </Pressable>
      {onPlay !== undefined && (
        <IconButton
          color={COLORS.accentInk}
          fill={COLORS.accent}
          icon={WREN_ICONS.play}
          label={SEARCH_COPY.play(title)}
          onPress={onPlay}
          size={SIZES.playButton}
        />
      )}
    </Card>
  )
}

type TopResultViewProps = {
  result: TopResult
  songs: readonly Track[]
  actions: ResultActions
}

type TopResultKind = TopResult['kind']

/** A top result's card, handed the result of its own kind. */
type TopViewProps<K extends TopResultKind> = Omit<TopResultViewProps, 'result'> & {
  result: TopResult & { kind: K }
}

function TopSong({
  result: { track },
  songs,
  actions,
}: TopViewProps<typeof TOP_RESULT_KINDS.song>) {
  const { trackCoverOf } = useCovers()
  // The top song is always the first found (`topResultOf`).
  const play = () => actions.playSongs({ tracks: songs, startAt: 0 })
  return (
    <TopCard
      art={<AlbumArt cover={trackCoverOf(track)} size={SIZES.topResultArt} />}
      kind={SEARCH_COPY.song}
      open={{ onPress: play }}
      onPlay={play}
      subtitle={artistNames(track)}
      title={track.title}
    />
  )
}

function TopAlbum({ result: { album }, actions }: TopViewProps<typeof TOP_RESULT_KINDS.album>) {
  const { coverOf } = useCovers()
  return (
    <TopCard
      art={
        <AlbumArt
          cover={coverOf({ albumId: album.id, coverVersion: album.coverVersion })}
          size={SIZES.topResultArt}
        />
      }
      kind={SEARCH_COPY.album}
      open={{ href: albumPath(album.id), onPress: () => actions.rememberAlbum(album) }}
      onPlay={() => actions.playAlbum(album)}
      subtitle={artistNames(album)}
      title={album.title}
    />
  )
}

function TopArtist({ result: { artist }, actions }: TopViewProps<typeof TOP_RESULT_KINDS.artist>) {
  const { artistPhotoOf } = useCovers()
  return (
    <TopCard
      art={
        <ArtistAvatar
          name={artist.name}
          picture={artistPhotoOf(artist)}
          size={SIZES.topResultArt}
        />
      }
      kind={SEARCH_COPY.artist}
      open={{ href: artistPath(artist.id), onPress: () => actions.rememberArtist(artist) }}
      subtitle={null}
      title={artist.name}
    />
  )
}

type TopViews = { [K in TopResultKind]: ComponentType<TopViewProps<K>> }

const TOP_RESULT_VIEWS = {
  [TOP_RESULT_KINDS.song]: TopSong,
  [TOP_RESULT_KINDS.album]: TopAlbum,
  [TOP_RESULT_KINDS.artist]: TopArtist,
} as const satisfies TopViews

// Typed as the mapped type, so a kind looks up the card that takes that kind's result.
const TOP_VIEWS: TopViews = TOP_RESULT_VIEWS

/** The result a search most likely meant, as a card with Play. */
export function TopResultCard<K extends TopResultKind>(props: TopViewProps<K>) {
  const TopView: ComponentType<TopViewProps<K>> = TOP_VIEWS[props.result.kind]
  return <TopView {...props} />
}

type ArtistsProps = { artists: readonly Artist[]; actions: ResultActions }

/** The artists found, as a row of circles that scrolls sideways. */
export function ArtistCircles({ artists, actions }: ArtistsProps) {
  const { artistPhotoOf } = useCovers()
  return (
    <ul className={styles.circles}>
      {artists.map((artist) => (
        <li className={styles.cell} key={artist.id}>
          <Pressable
            className={styles.circle}
            href={artistPath(artist.id)}
            label={artist.name}
            onPress={() => actions.rememberArtist(artist)}
          >
            <ArtistAvatar
              name={artist.name}
              picture={artistPhotoOf(artist)}
              size={SIZES.artistCircle}
            />
            <span className={styles.circleName}>{artist.name}</span>
          </Pressable>
        </li>
      ))}
    </ul>
  )
}
