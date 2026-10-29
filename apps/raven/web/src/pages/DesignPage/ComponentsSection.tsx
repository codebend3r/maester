import { DEFAULT_LIBRARY_SETTINGS, type LibrarySettings } from '@raven/core'
import { useRef, useState } from 'react'
import { Button, ButtonLink, Controls } from '@raven/ui'
import { CastRow } from '@/components/CastRow/CastRow'
import { ItemHeader } from '@/components/ItemHeader/ItemHeader'
import { LibraryToolbar } from '@/components/LibraryToolbar/LibraryToolbar'
import { MediaCard } from '@/components/MediaCard/MediaCard'
import { MediaGrid, MediaGridSkeleton } from '@/components/MediaGrid/MediaGrid'
import { MediaGroups } from '@/components/MediaGroups/MediaGroups'
import { MediaList } from '@/components/MediaList/MediaList'
import { MediaTiles, MediaTilesSkeleton } from '@/components/MediaTiles/MediaTiles'
import { PlaybackNote } from '@/components/PlaybackNote/PlaybackNote'
import { RatingBadge, RatingChip, RatingPanel } from '@/components/RatingPanel/RatingPanel'
import { ReviewCards } from '@/components/ReviewCards/ReviewCards'
import { ScanStatus } from '@/components/ScanStatus/ScanStatus'
import { SectionHeading } from '@/components/SectionHeading/SectionHeading'
import { ShowGrid } from '@/components/ShowCard/ShowCard'
import { Loading } from '@/components/Skeleton/Skeleton'
import { WatchedCount } from '@/components/WatchedCount/WatchedCount'
import { WatchedMark } from '@/components/WatchedMark/WatchedMark'
import { WatchedToggle } from '@/components/WatchedToggle/WatchedToggle'
import { useSearch } from '@raven/ui/headless'
import { DesignSection, Specimen } from '@/pages/DesignPage/DesignSection'
import { IconSet } from '@/pages/DesignPage/IconSet'
import {
  FEATURED_SAMPLE,
  SAMPLE_CREDITS,
  SAMPLE_MEDIA,
  SAMPLE_MOVIES,
  SAMPLE_RATINGS,
  SAMPLE_RATINGS_LOW,
  SAMPLE_RATINGS_RED,
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
      <span className={styles.picture} aria-hidden="true" />
      <div className={styles.controlsLayer}>
        <Controls
          shown
          paused={paused}
          time={2400}
          duration={6120}
          buffered={[[0, 2700]]}
          chapters={[0, 1260, 2880, 4380]}
          volume={0.7}
          muted={false}
          fullscreen={false}
          subtitlesOn
          menuValues={{
            subtitles: 'English',
            audio: 'English 5.1',
            playback: '1080p · Direct play',
          }}
          menuOpen={false}
          settingsButton={settingsButton}
          upNext="Tears of Steel (2012)"
          countdown={null}
          endsAt="Ends at 2:20 AM"
          onRestart={noop}
          onNext={noop}
          onTogglePlay={() => setPaused((current) => !current)}
          onSeek={noop}
          onSkip={noop}
          onVolume={noop}
          onToggleMute={noop}
          onToggleMenu={noop}
          onToggleFullscreen={noop}
        />
      </div>
    </div>
  )
}

export const ComponentsSection = () => (
  <DesignSection
    id="components"
    intro="Every shared component, with made-up videos. Nothing here saves; the library dialog and folder browser are left out because they change real libraries."
  >
    <Specimen
      name="Button"
      note="Quiet by default; primary for the one action a screen is for, and large where that action is the page's whole point. Danger is an outline; a way back is a pill."
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
        <Button tone="ghost" icon="history">
          History
        </Button>
        <Button icon="close" aria-label="Close" />
        <Button disabled icon="rescan">
          Full scan
        </Button>
        <ButtonLink tone="pill" to="/" icon="back">
          Libraries
        </ButtonLink>
      </div>
    </Specimen>

    <Specimen
      name="Icon"
      note="Line icons on a 24 grid, drawn at 28 here, decorative unless their control is labelled. Point at one to see how it moves in a control; press it to copy its name."
    >
      <IconSet />
    </Specimen>

    <Specimen
      name="Watched"
      note="A check on a watched video, the number left or a check on a show, season or saga, and the toggle on a page: unpressed, partly and pressed."
    >
      <div className={styles.row}>
        <WatchedMark watched />
        <WatchedCount watched={3} total={9} />
        <WatchedCount watched={9} total={9} />
        <WatchedToggle state="unwatched" onToggle={noop} />
        <WatchedToggle state="partly" onToggle={noop} />
        <WatchedToggle state="watched" onToggle={noop} />
      </div>
    </Specimen>

    <Specimen name="ScanStatus">
      <ul className={styles.cards}>
        {SAMPLE_SCANS.map(({ label, scan, expected }) => (
          <li key={label} className={styles.card}>
            <span className={styles.eyebrowLabel}>{label}</span>
            <ScanStatus scan={scan} expected={expected} />
          </li>
        ))}
      </ul>
    </Specimen>

    <Specimen name="PlaybackNote" note="Only for a video this browser cannot play.">
      <ul className={styles.ruledList}>
        {SAMPLE_MEDIA.slice(0, 4).map((media) => (
          <li key={media.id} className={styles.noteRow}>
            <span className={styles.noteTitle}>{media.title}</span>
            <PlaybackNote media={media} />
          </li>
        ))}
      </ul>
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
      isWide
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
      name="SectionHeading"
      note="A section's title in the serif, ruled off from what follows, with room at its right for a count or the section's own controls."
    >
      <SectionHeading aside="6 people">Cast &amp; Crew</SectionHeading>
    </Specimen>

    <Specimen
      name="RatingPanel"
      note="A movie's scores in one frame: the score, a bar in the source's colour and its name. Hover or focus a score for the site and what the number means. A source with no score is left out."
    >
      <div className={styles.stack}>
        <RatingPanel ratings={SAMPLE_RATINGS} />
        <RatingPanel ratings={SAMPLE_RATINGS_LOW} />
      </div>
    </Specimen>

    <Specimen
      name="RatingBadge"
      note="The panel in one line, where a card or a table row has room for one score: the score, its scale and the source's name, with the bar along the frame's foot."
    >
      <div className={styles.row}>
        {[...SAMPLE_RATINGS, ...SAMPLE_RATINGS_LOW, ...SAMPLE_RATINGS_RED].map((rating) => (
          <RatingBadge key={`${rating.source}-${rating.value}`} rating={rating} />
        ))}
      </div>
    </Specimen>

    <Specimen
      name="RatingChip"
      note="Every score a title has in one chip, where a tile has no room for four badges: the lead score and how many more. Hover or focus it for each source's score in a popover."
    >
      <div className={styles.row}>
        <RatingChip ratings={SAMPLE_RATINGS} />
        <RatingChip ratings={SAMPLE_RATINGS_LOW} />
        <RatingChip ratings={SAMPLE_RATINGS.slice(0, 1)} />
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

    <Specimen name="MediaList" isWide>
      <MediaList items={SAMPLE_MEDIA} />
    </Specimen>

    <Specimen name="MediaTiles">
      <MediaTiles items={SAMPLE_MEDIA} />
    </Specimen>

    <Specimen name="MediaGroups" note="Grouped by resolution.">
      <MediaGroups items={SAMPLE_MEDIA} by="resolution" />
    </Specimen>

    <Specimen
      name="LibraryToolbar"
      isWide
      note="Its search, sort, views and Play all, saving to nothing here."
    >
      <ToolbarDemo />
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

    <Specimen name="Controls" note="The player's bar; play and pause work here, nothing else does.">
      <ControlsDemo />
    </Specimen>
  </DesignSection>
)
