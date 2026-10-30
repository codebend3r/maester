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
import { SECTION_IDS } from '@/pages/DesignPage/contents'
import { DESIGN_COPY } from '@/pages/DesignPage/copy'
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

const COPY = DESIGN_COPY.components

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
      name={COPY.toolbarName}
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
            subtitles: COPY.menuSubtitles,
            audio: COPY.menuAudio,
            playback: COPY.menuPlayback,
          }}
          menuOpen={false}
          settingsButton={settingsButton}
          upNext={COPY.upNext}
          countdown={null}
          endsAt={COPY.endsAt}
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
  <DesignSection id={SECTION_IDS.components} intro={COPY.intro}>
    <Specimen name={COPY.button} note={COPY.buttonNote}>
      <div className={styles.row}>
        <Button tone="primary" size="large" icon="play">
          {COPY.playAll}
        </Button>
        <Button tone="primary" icon="plus">
          {COPY.addLibrary}
        </Button>
        <Button icon="edit">{COPY.edit}</Button>
        <Button tone="danger" icon="trash">
          {COPY.deleteForGood}
        </Button>
        <Button tone="ghost" icon="history">
          {COPY.history}
        </Button>
        <Button icon="close" aria-label={COPY.close} />
        <Button disabled icon="rescan">
          {COPY.fullScan}
        </Button>
        <ButtonLink tone="pill" to="/" icon="back">
          {COPY.libraries}
        </ButtonLink>
      </div>
    </Specimen>

    <Specimen name={COPY.icon} note={COPY.iconNote}>
      <IconSet />
    </Specimen>

    <Specimen name={COPY.watched} note={COPY.watchedNote}>
      <div className={styles.row}>
        <WatchedMark watched />
        <WatchedCount watched={3} total={9} />
        <WatchedCount watched={9} total={9} />
        <WatchedToggle state="unwatched" onToggle={noop} />
        <WatchedToggle state="partly" onToggle={noop} />
        <WatchedToggle state="watched" onToggle={noop} />
      </div>
    </Specimen>

    <Specimen name={COPY.scanStatus}>
      <ul className={styles.cards}>
        {SAMPLE_SCANS.map(({ label, scan, expected }) => (
          <li key={label} className={styles.card}>
            <span className={styles.eyebrowLabel}>{label}</span>
            <ScanStatus scan={scan} expected={expected} />
          </li>
        ))}
      </ul>
    </Specimen>

    <Specimen name={COPY.playbackNote} note={COPY.playbackNoteNote}>
      <ul className={styles.ruledList}>
        {SAMPLE_MEDIA.slice(0, 4).map((media) => (
          <li key={media.id} className={styles.noteRow}>
            <span className={styles.noteTitle}>{media.title}</span>
            <PlaybackNote media={media} />
          </li>
        ))}
      </ul>
    </Specimen>

    <Specimen name={COPY.mediaCard} note={COPY.mediaCardNote}>
      <ul className={styles.cardSample}>
        <MediaCard media={FEATURED_SAMPLE} />
      </ul>
    </Specimen>

    <Specimen name={COPY.posterCard} note={COPY.posterCardNote}>
      <MediaGrid items={SAMPLE_MOVIES} posters matchType="movie" />
    </Specimen>

    <Specimen name={COPY.showCard} note={COPY.showCardNote}>
      <ShowGrid shows={SAMPLE_SHOWS} />
    </Specimen>

    <Specimen name={COPY.itemHeader} isWide note={COPY.itemHeaderNote}>
      <ItemHeader
        back={{ to: '/', label: COPY.itemHeaderBack }}
        titleId="design-item-header"
        title={COPY.itemHeaderTitle}
        byline={COPY.itemHeaderByline}
        contentRating={COPY.itemHeaderRating}
        facts={COPY.itemHeaderFacts}
        ratings={SAMPLE_RATINGS}
        picture={{ shape: 'poster', url: null }}
        backdrop={null}
      >
        <Button tone="primary" icon="play">
          {COPY.resume}
        </Button>
        <Button icon="heart" aria-label={COPY.favourite} aria-pressed />
      </ItemHeader>
    </Specimen>

    <Specimen name={COPY.sectionHeading} note={COPY.sectionHeadingNote}>
      <SectionHeading aside={COPY.sectionHeadingAside}>{COPY.sectionHeadingTitle}</SectionHeading>
    </Specimen>

    <Specimen name={COPY.ratingPanel} note={COPY.ratingPanelNote}>
      <div className={styles.stack}>
        <RatingPanel ratings={SAMPLE_RATINGS} />
        <RatingPanel ratings={SAMPLE_RATINGS_LOW} />
      </div>
    </Specimen>

    <Specimen name={COPY.ratingBadge} note={COPY.ratingBadgeNote}>
      <div className={styles.row}>
        {[...SAMPLE_RATINGS, ...SAMPLE_RATINGS_LOW, ...SAMPLE_RATINGS_RED].map((rating) => (
          <RatingBadge key={`${rating.source}-${rating.value}`} rating={rating} />
        ))}
      </div>
    </Specimen>

    <Specimen name={COPY.ratingChip} note={COPY.ratingChipNote}>
      <div className={styles.row}>
        <RatingChip ratings={SAMPLE_RATINGS} />
        <RatingChip ratings={SAMPLE_RATINGS_LOW} />
        <RatingChip ratings={SAMPLE_RATINGS.slice(0, 1)} />
      </div>
    </Specimen>

    <Specimen name={COPY.reviewCards} note={COPY.reviewCardsNote}>
      <ReviewCards reviews={SAMPLE_REVIEWS} />
    </Specimen>

    <Specimen name={COPY.castRow} note={COPY.castRowNote}>
      <CastRow credits={SAMPLE_CREDITS} />
    </Specimen>

    <Specimen name={COPY.mediaGrid}>
      <MediaGrid items={SAMPLE_MEDIA} />
    </Specimen>

    <Specimen name={COPY.mediaList} isWide>
      <MediaList items={SAMPLE_MEDIA} />
    </Specimen>

    <Specimen name={COPY.mediaTiles}>
      <MediaTiles items={SAMPLE_MEDIA} />
    </Specimen>

    <Specimen name={COPY.mediaGroups} note={COPY.mediaGroupsNote}>
      <MediaGroups items={SAMPLE_MEDIA} by="resolution" />
    </Specimen>

    <Specimen name={COPY.libraryToolbar} isWide note={COPY.libraryToolbarNote}>
      <ToolbarDemo />
    </Specimen>

    <Specimen name={COPY.skeleton} note={COPY.skeletonNote}>
      <Loading label={COPY.skeletonLabel}>
        <MediaGridSkeleton posters count={4} />
        <MediaTilesSkeleton />
      </Loading>
    </Specimen>

    <Specimen name={COPY.controls} note={COPY.controlsNote}>
      <ControlsDemo />
    </Specimen>
  </DesignSection>
)
