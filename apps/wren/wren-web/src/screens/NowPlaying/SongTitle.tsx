import { classNames } from '@raven/ui/headless'
import { NOW_PLAYING_COPY, type SongActions, WREN_ICONS } from '@raven/wren'
import type { ComponentType } from 'react'
import {
  ARTIST_KINDS,
  type ArtistKind,
  type Playing,
  type PlayingArtist,
} from '@/screens/NowPlaying/usePlaying'
import { COLORS, RADII, SIZES } from '@/theme/tokens'
import { AlbumArt } from '@/ui/AlbumArt/AlbumArt'
import { IconButton } from '@/ui/IconButton/IconButton'
import { LikeButton } from '@/ui/LikeButton/LikeButton'
import { Pressable } from '@/ui/Pressable/Pressable'
import { QualityChips } from '@/ui/QualityChips/QualityChips'
import styles from '@/screens/NowPlaying/SongTitle.module.scss'

type SongProps = { playing: Playing }

type ArtistsProps<K extends ArtistKind> = {
  artist: PlayingArtist & { kind: K }
  /** The artists' names, "Sia, David Guetta". */
  names: string
  className: string
}

/*
 * The artists as a link to the first one's page. It takes Now Playing's place in the history, as
 * the apps close the sheet on the way, so Back from the artist is the page the player was over.
 */
function LinkedArtists({ artist, names, className }: ArtistsProps<typeof ARTIST_KINDS.linked>) {
  return (
    <Pressable className={className} href={artist.href} shouldReplace>
      {names}
    </Pressable>
  )
}

/** The artists as words alone, for a song that credits none to open. */
function PlainArtists({ names, className }: ArtistsProps<typeof ARTIST_KINDS.plain>) {
  return <span className={className}>{names}</span>
}

type ArtistViews = { [K in ArtistKind]: ComponentType<ArtistsProps<K>> }

const ARTIST_VIEWS = {
  [ARTIST_KINDS.linked]: LinkedArtists,
  [ARTIST_KINDS.plain]: PlainArtists,
} as const satisfies ArtistViews

// Typed as the mapped type, so a kind looks up the view that takes that kind's artist.
const ARTISTS: ArtistViews = ARTIST_VIEWS

/** The song's artists, a link to the first one's page when it is known. */
function ArtistLink<K extends ArtistKind>(props: ArtistsProps<K>) {
  const Artists: ComponentType<ArtistsProps<K>> = ARTISTS[props.artist.kind]
  return <Artists {...props} />
}

/** What went wrong playing, said under the song while it stands. */
function PlayError({ playing }: SongProps) {
  return playing.error !== null && <output className={styles.error}>{playing.error}</output>
}

/** The format and quality of what is playing, as chips under the song once its source is made. */
function Quality({ playing }: SongProps) {
  return playing.quality !== null && <QualityChips quality={playing.quality} />
}

/** How the song's lines are set: large under the cover, or small beside a small one. */
const SONG_VARIANTS = { large: 'large', compact: 'compact' } as const

type SongVariant = (typeof SONG_VARIANTS)[keyof typeof SONG_VARIANTS]

type SongClasses = { name: string; artist: string }

const SONG_CLASSES = {
  [SONG_VARIANTS.large]: { name: styles.largeName, artist: styles.largeArtist },
  [SONG_VARIANTS.compact]: { name: styles.compactName, artist: styles.compactArtist },
} as const satisfies Record<SongVariant, SongClasses>

type SongLinesProps = SongProps & { variant: SongVariant }

/** The song in words: its title, its artists, what it plays as and what went wrong playing it. */
function SongLines({ playing, variant }: SongLinesProps) {
  const classes = SONG_CLASSES[variant]
  return (
    <div className={styles.lines}>
      <h1 className={classes.name}>{playing.track.title}</h1>
      <ArtistLink
        artist={playing.artist}
        className={classNames([styles.artist, classes.artist])}
        names={playing.artists}
      />
      <Quality playing={playing} />
      <PlayError playing={playing} />
    </div>
  )
}

type SongTitleProps = SongProps & Pick<SongActions, 'like' | 'onAddToPlaylist'>

/**
 * The player's song: its title large in Young Serif and its artists as a link, with its heart
 * and Add to playlist beside its name. Everything else it can do is behind the header's More.
 */
export function SongTitle({ playing, like, onAddToPlaylist }: SongTitleProps) {
  return (
    <div className={styles.titled}>
      <SongLines playing={playing} variant={SONG_VARIANTS.large} />
      <div className={styles.actions}>
        <LikeButton idleColor={COLORS.text2} like={like} title={playing.track.title} />
        <IconButton
          icon={WREN_ICONS.playlistAdd}
          label={NOW_PLAYING_COPY.addToPlaylist}
          onPress={onAddToPlaylist}
        />
      </div>
    </div>
  )
}

/** Lyrics' and Up next's head: a small cover beside the song's title and artists. */
export function CompactSong({ playing }: SongProps) {
  return (
    <div className={styles.compact}>
      <AlbumArt cover={playing.cover} radius={RADII.sm} size={SIZES.playerCompactArt} />
      <SongLines playing={playing} variant={SONG_VARIANTS.compact} />
    </div>
  )
}
