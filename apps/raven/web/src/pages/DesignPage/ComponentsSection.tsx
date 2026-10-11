import { DEFAULT_LIBRARY_SETTINGS, type LibrarySettings } from '@raven/core'
import { useRef, useState } from 'react'
import { Button, ButtonLink } from '@/components/Button/Button'
import { ICON_NAMES, Icon } from '@/components/Icon/Icon'
import { LibraryToolbar } from '@/components/LibraryToolbar/LibraryToolbar'
import { MediaCard } from '@/components/MediaCard/MediaCard'
import { MediaGrid } from '@/components/MediaGrid/MediaGrid'
import { MediaGroups } from '@/components/MediaGroups/MediaGroups'
import { MediaList } from '@/components/MediaList/MediaList'
import { MediaTiles } from '@/components/MediaTiles/MediaTiles'
import { PlaybackNote } from '@/components/PlaybackNote/PlaybackNote'
import { Controls } from '@/components/Player/Controls'
import { ScanStatus } from '@/components/ScanStatus/ScanStatus'
import { DesignSection, Specimen } from '@/pages/DesignPage/DesignSection'
import { FEATURED_SAMPLE, SAMPLE_MEDIA, SAMPLE_SCANS } from '@/pages/DesignPage/samples'
import styles from '@/pages/DesignPage/DesignPage.module.scss'

const noop = () => undefined

/** The toolbar with its own state, since here it saves to nothing. */
const ToolbarDemo = () => {
  const [search, setSearch] = useState('')
  const [settings, setSettings] = useState<LibrarySettings>({
    ...DEFAULT_LIBRARY_SETTINGS,
    view: 'grouped',
  })
  return (
    <LibraryToolbar
      name="Movies"
      search={search}
      onSearch={setSearch}
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
    <Specimen name="Button" note="Quiet by default; primary for the one action a screen is for.">
      <div className={styles.row}>
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

    <Specimen name="PlaybackNote" note="What it says depends on this browser.">
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

    <Specimen name="LibraryToolbar">
      <ToolbarDemo />
    </Specimen>

    <Specimen name="Controls" note="The player's bar; play and pause work here, nothing else does.">
      <ControlsDemo />
    </Specimen>
  </DesignSection>
)
