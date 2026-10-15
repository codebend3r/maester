import { DEFAULT_LIBRARY_SETTINGS, type LibrarySettings } from '@raven/core'
import { useRef, useState } from 'react'
import { Button, ButtonLink, ICON_NAMES, Icon, Controls } from '@raven/ui'
import { CastRow } from '@/components/CastRow/CastRow'
import { ItemHeader } from '@/components/ItemHeader/ItemHeader'
import { LibraryToolbar } from '@/components/LibraryToolbar/LibraryToolbar'
import { MediaCard } from '@/components/MediaCard/MediaCard'
import { MediaGrid, MediaGridSkeleton } from '@/components/MediaGrid/MediaGrid'
import { MediaGroups } from '@/components/MediaGroups/MediaGroups'
import { MediaList } from '@/components/MediaList/MediaList'
import { MediaTiles, MediaTilesSkeleton } from '@/components/MediaTiles/MediaTiles'
import { PlaybackNote } from '@/components/PlaybackNote/PlaybackNote'
import { RatingChips } from '@/components/RatingChips/RatingChips'
import { ReviewCards } from '@/components/ReviewCards/ReviewCards'
import { ScanStatus } from '@/components/ScanStatus/ScanStatus'
import { ShowGrid } from '@/components/ShowCard/ShowCard'
import { Loading } from '@/components/Skeleton/Skeleton'
import { useSearch } from '@/lib/useSearch'
import { DesignSection, Specimen } from '@/pages/DesignPage/DesignSection'
import {
  FEATURED_SAMPLE,
  SAMPLE_CREDITS,
  SAMPLE_MEDIA,
  SAMPLE_MOVIES,
  SAMPLE_RATINGS,
  SAMPLE_RATINGS_LOW,
  SAMPLE_REVIEWS,
  SAMPLE_SCANS,
  SAMPLE_SHOWS,
} from '@/pages/DesignPage/samples'
import styles from '@/pages/DesignPage/DesignPage.module.scss'

const noop = () => undefined

/** The toolbar with its own state, since here it saves to nothing. */
const ToolbarDemo = () => {
  const search = useSearch()
  const [settings, setSettings] = useState<LibrarySettings>({
    ...DEFAULT_LIBRARY_SETTINGS,
    view: 'grouped',
  })
  return (
    <LibraryToolbar
      name="Movies"
      search={search}
      settings={settings}
      onChange={(change) => setSettings((current) => ({ ...current, ...change }))}
      playable
      onPlay={noop}
      onShuffle={noop}
    />
  )
}

/** The player's bar on its black stage, paused partway through. */
const ControlsDemo = () => {
  const settingsButton = useRef<HTMLButtonElement>(null)
  const [paused, setPaused] = useState(true)
  return (
    <div className={styles.stage}>
      <Controls
        shown
        paused={paused}
        time={2400}
        duration={6120}
        buffered={[[0, 2700]]}
        volume={0.7}
        muted={false}
        fullscreen={false}
        subtitlesOn
        menuOpen={false}
        settingsButton={settingsButton}
        onTogglePlay={() => setPaused((current) => !current)}
        onSeek={noop}
        onSkip={noop}
        onVolume={noop}
        onToggleMute={noop}
        onToggleSubtitles={noop}
        onToggleMenu={noop}
        onToggleFullscreen={noop}
      />
    </div>
  )
}

export const ComponentsSection = () => (
  <DesignSection
    id="components"
    title="Components"
    intro="Every shared component, with made-up videos. Nothing here saves; the library dialog and folder browser are left out because they change real libraries."
  >
    <Specimen
      name="Button"
      note="Quiet by default; primary for the one action a screen is for, and large where that action is the page's whole point."
    >
      <div className={styles.row}>
        <Button tone="primary" size="large" icon="play">
          Play all
        </Button>
        <Button tone="primary" icon="plus">
          Add library
        </Button>
        <Button icon="edit">Edit</Button>
        <Button tone="danger" icon="trash">
          Delete for good
        </Button>
        <Button icon="close" aria-label="Close" />
        <Button disabled icon="rescan">
          Rescan
        </Button>
        <ButtonLink to="/" icon="back">
          Libraries
        </ButtonLink>
      </div>
    </Specimen>

    <Specimen
      name="Icon"
      note="Line icons on a 24 grid, decorative unless their control is labelled."
    >
      <ul className={styles.icons}>
        {ICON_NAMES.map((name) => (
          <li key={name} className={styles.icon}>
            <Icon name={name} size={24} />
            <code>{name}</code>
          </li>
        ))}
      </ul>
    </Specimen>

    <Specimen name="ScanStatus">
      <div className={styles.fields}>
        {SAMPLE_SCANS.map(({ label, scan }) => (
          <div key={label} className={styles.field}>
            <span className={styles.hint}>{label}</span>
            <ScanStatus scan={scan} />
          </div>
        ))}
      </div>
    </Specimen>

    <Specimen name="PlaybackNote" note="Only for a video this browser cannot play.">
      <div className={styles.stack}>
        {SAMPLE_MEDIA.slice(0, 4).map((media) => (
          <div key={media.id} className={styles.noteRow}>
            <span>{media.title}</span>
            <PlaybackNote media={media} />
          </div>
        ))}
      </div>
    </Specimen>

    <Specimen name="MediaCard" note="With its menu, a resume line, a favourite and HDR.">
      <ul className={styles.cardSample}>
        <MediaCard media={FEATURED_SAMPLE} />
      </ul>
    </Specimen>

    <Specimen
      name="PosterCard"
      note="A Movies library's cards: with no poster they fall back to the frame grab, then the letter."
    >
      <MediaGrid items={SAMPLE_MOVIES} posters matchType="movie" />
    </Specimen>

    <Specimen
      name="ShowCard"
      note="A TV library's cards: the years, the episode count, and Play for the next episode."
    >
      <ShowGrid shows={SAMPLE_SHOWS} />
    </Specimen>

    <Specimen
      name="ItemHeader"
      note="The top of a movie's page, with the way back to its library, without its backdrop here."
    >
      <ItemHeader
        back={{ to: '/', label: 'Movies' }}
        titleId="design-item-header"
        title="Weirwood at Night"
        byline="Directed by Mark Kimball"
        contentRating="PG-13"
        facts={['2026', '1h 42m', 'Drama', 'Mystery']}
        ratings={SAMPLE_RATINGS}
        picture={{ shape: 'poster', url: null }}
        backdrop={null}
      >
        <Button tone="primary" icon="play">
          Resume from 40:00
        </Button>
        <Button icon="heart" aria-label="Favourite" aria-pressed />
      </ItemHeader>
    </Specimen>

    <Specimen
      name="RatingChips"
      note="One chip per source. Rotten Tomatoes is a tomato from 60% and a splat below; Metacritic's square is green from 61, yellow from 40, red under. A movie's page gives every source a chip, a dashed one for a source with no score."
    >
      <div className={styles.stack}>
        <RatingChips ratings={SAMPLE_RATINGS} />
        <RatingChips ratings={SAMPLE_RATINGS_LOW} />
        <RatingChips ratings={SAMPLE_RATINGS.slice(0, 1)} shouldShowEverySource />
      </div>
    </Specimen>

    <Specimen name="ReviewCards" note="Reviews by TMDB members; Read opens the whole review.">
      <ReviewCards reviews={SAMPLE_REVIEWS} />
    </Specimen>

    <Specimen name="CastRow" note="Someone who acts and directs is one person with both roles.">
      <CastRow credits={SAMPLE_CREDITS} />
    </Specimen>

    <Specimen name="MediaGrid">
      <MediaGrid items={SAMPLE_MEDIA} />
    </Specimen>

    <Specimen name="MediaList">
      <MediaList items={SAMPLE_MEDIA} />
    </Specimen>

    <Specimen name="MediaTiles">
      <MediaTiles items={SAMPLE_MEDIA} />
    </Specimen>

    <Specimen name="MediaGroups" note="Grouped by resolution.">
      <MediaGroups items={SAMPLE_MEDIA} by="resolution" />
    </Specimen>

    <Specimen
      name="Skeleton"
      note="What a page shows while it waits: the shape of what is coming, which a screen reader hears as one line."
    >
      <Loading label="Gathering the videos">
        <MediaGridSkeleton posters count={4} />
        <MediaTilesSkeleton />
      </Loading>
    </Specimen>

    <Specimen name="LibraryToolbar">
      <ToolbarDemo />
    </Specimen>

    <Specimen name="Controls" note="The player's bar; play and pause work here, nothing else does.">
      <ControlsDemo />
    </Specimen>
  </DesignSection>
)
