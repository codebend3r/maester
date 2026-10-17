import { type PlaybackMode, formatDuration } from '@raven/core'
import {
  type ReactNode,
  type SyntheticEvent,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
} from 'react'
import type { Engine, EngineHandle } from '@/components/Player/engine'
import { type PlayerFavourite, usePlayerServices } from '@/components/Player/PlayerServices'
import { useHtmlEngine } from '@/components/Player/useHtmlEngine'
import type { SubtitleStatus } from '@/components/Player/useSubtitleCues'
import { Button, ButtonLink } from '@/components/Button/Button'
import { Bezel } from '@/components/Player/Bezel'
import { Controls } from '@/components/Player/Controls'
import styles from '@/components/Player/Player.module.scss'
import { type PlaybackFile, PlaybackInfo } from '@/components/Player/PlaybackInfo'
import { playingAudio } from '@/components/Player/selection'
import { SettingsMenu } from '@/components/Player/SettingsMenu'
import { ShortcutsDialog } from '@/components/Player/ShortcutsDialog'
import { type Overlay, usePlayerActions } from '@/components/Player/usePlayerActions'
import { useBezel, useFullscreen, useIdle } from '@/components/Player/useStageChrome'
import { useUpNext } from '@/components/Player/useUpNext'
import type { TrackSelection } from '@/components/Player/useTrackSelection'
import { useWatchProgress } from '@/components/Player/useWatchProgress'
import { isTypingTarget } from '@/lib/keyboard'
import { type PlayerAction, shortcutFor } from '@/lib/shortcuts'
import { usePlayerPrefs } from '@/stores/playerPrefs'

/**
 * How long the controls and cursor linger after the last mouse move, key
 * press or click. Nothing holds them past it: not a pause, an open menu or a
 * focused button.
 */
const IDLE_MS = 10_000

const isControlTarget = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement && !!target.closest('button, a')

export type StageProps = {
  engine: Engine
  onBack: () => void
  mode: PlaybackMode
  selection: TrackSelection
  onFailure: (message: string) => void
}

export const Stage = (props: StageProps) => {
  const kind = props.engine.kind
  switch (kind) {
    case 'html':
      return <HtmlStage key={kind} {...props} />
    default: {
      const unknown: never = kind
      return unknown
    }
  }
}

const HtmlStage = ({ engine, ...props }: StageProps) => {
  const fullscreen = useFullscreen()
  const html = useHtmlEngine({
    source: engine.source,
    ...props,
    toggleFullscreen: fullscreen.toggle,
  })
  const source = engine.source
  return (
    <PlayerChrome
      {...props}
      {...html}
      file={source.kind === 'server' ? source : null}
      fullscreen={fullscreen}
    />
  )
}

/** Shared controls consume only the engine handle, never the picture's DOM. */
export const PlayerChrome = ({
  engine,
  onBack,
  mode,
  selection,
  subtitleStatus,
  renderSubtitles,
  fullscreen,
  file = null,
}: {
  engine: EngineHandle
  onBack: () => void
  mode: PlaybackMode
  selection: TrackSelection
  subtitleStatus: SubtitleStatus
  renderSubtitles?: (lifted: boolean) => ReactNode
  fullscreen: ReturnType<typeof useFullscreen>
  /** The library file playing, for Playback info; null for a local file. */
  file?: PlaybackFile | null
}) => {
  const { title, hostActions, favourite } = usePlayerServices()
  const label = title.label
  const { state, duration, actions } = engine
  const seek = actions.seek
  const menu = useRef<HTMLDialogElement>(null)
  const settingsButton = useRef<HTMLButtonElement>(null)
  const volume = usePlayerPrefs((prefs) => prefs.volume)
  const muted = usePlayerPrefs((prefs) => prefs.muted)
  useWatchProgress({ state, position: engine.position, duration })
  const nextLink = useUpNext({ ended: state.ended })
  const idle = useIdle(IDLE_MS)
  const { bezel, flash } = useBezel()
  const [overlay, setOverlay] = useState<Overlay>('none')
  // Apart from the overlay: it stays open over the video, menus and all.
  const [infoOpen, setInfoOpen] = useState(false)
  const [resumedAt, setResumedAt] = useState<number | null>(
    title.resumeAt > 0 ? title.resumeAt : null,
  )

  // The host title stays in the tab only while this player is open.
  useEffect(() => {
    const previousTitle = document.title
    document.title = label
    const resumedTimer = window.setTimeout(() => setResumedAt(null), 6000)
    return () => {
      document.title = previousTitle
      window.clearTimeout(resumedTimer)
    }
  }, [label])

  const closeMenu = () => {
    setOverlay('none')
    settingsButton.current?.focus()
  }

  const showInfo = () => {
    closeMenu()
    // The panel opens where the resume notice sits, over its Start over.
    setResumedAt(null)
    setInfoOpen(true)
  }

  const closeInfo = () => {
    setInfoOpen(false)
    engine.focusSurface()
  }

  const controls = usePlayerActions({
    engine,
    selection,
    flash,
    toggleFullscreen: fullscreen.toggle,
    overlay,
    setOverlay,
    closeMenu,
    closeInfo: infoOpen ? closeInfo : null,
    leave: onBack,
  })

  const onKey = useEffectEvent((event: KeyboardEvent) => {
    idle.wake()
    const action = shortcutFor(event)
    // Form controls keep their own keys (the radios' arrows, the volume
    // slider's); only Escape reaches past them, to close what they sit in.
    if (isTypingTarget(event.target) && action?.type !== 'escape') return
    // A focused button or link answers Space and Enter itself.
    if (isControlTarget(event.target) && (event.key === ' ' || event.key === 'Enter')) return
    if (!action) return
    // With the shortcut list open, the keys only close it.
    if (overlay === 'shortcuts' && action.type !== 'escape' && action.type !== 'showShortcuts') {
      return
    }
    event.preventDefault()
    controls.act(action)
  })
  useEffect(() => {
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const onHostAction = useEffectEvent((action: PlayerAction) => {
    idle.wake()
    controls.act(action)
  })
  useEffect(() => hostActions?.subscribe(onHostAction) ?? undefined, [hostActions])

  // A press outside the open menu closes it, as a popover should.
  const onStagePointerDown = (event: SyntheticEvent) => {
    idle.wake()
    const target = event.target
    if (overlay !== 'settings' || !(target instanceof Node)) return
    if (menu.current?.contains(target) || settingsButton.current?.contains(target)) return
    setOverlay('none')
  }

  const startOver = () => {
    seek(0)
    actions.play()
    setResumedAt(null)
    engine.focusSurface()
  }

  const toggleFavourite = (current: PlayerFavourite) => {
    current.toggle()
    flash({
      icon: 'heart',
      text: current.isFavourite ? 'Removed from favourites' : 'Added to favourites',
    })
  }

  const chromeShown = idle.active

  return (
    <div
      className={[styles.stage, chromeShown ? '' : styles.idle].filter(Boolean).join(' ')}
      onPointerMove={idle.wake}
      onPointerDown={onStagePointerDown}
    >
      {engine.surface}
      {!engine.drawsSubtitles && (renderSubtitles?.(chromeShown) ?? null)}
      {state.waiting && !state.paused && <output className={styles.spinner} aria-label="Loading" />}
      {!!bezel && <Bezel key={bezel.id} bezel={bezel} />}
      <p className="visually-hidden" aria-live="polite">
        {bezel?.text}
      </p>
      <header
        className={[styles.chrome, chromeShown ? '' : styles.chromeHidden]
          .filter(Boolean)
          .join(' ')}
      >
        <Button icon="back" aria-label="Back" className={styles.back} onClick={onBack} />
        <h1 className={styles.title}>{label}</h1>
        {favourite && (
          <Button
            icon="heart"
            aria-label="Favourite"
            aria-pressed={favourite.isFavourite}
            className={[styles.favourite, favourite.isFavourite ? styles.favourited : '']
              .filter(Boolean)
              .join(' ')}
            onClick={() => toggleFavourite(favourite)}
          />
        )}
        {nextLink && (
          <ButtonLink
            to={nextLink.to}
            state={nextLink.state}
            replace
            icon="next"
            className={styles.next}
            aria-label={`Next: ${nextLink.label}`}
            title={nextLink.label}
          >
            Next
          </ButtonLink>
        )}
        {resumedAt != null && (
          <p className={styles.resumed} aria-live="polite">
            <span>Resumed at {formatDuration(resumedAt)}</span>
            <Button onClick={startOver}>Start over</Button>
          </p>
        )}
      </header>
      <Controls
        shown={chromeShown}
        paused={state.paused}
        time={state.time}
        duration={duration}
        buffered={state.buffered}
        volume={volume}
        muted={muted}
        fullscreen={fullscreen.fullscreen}
        subtitlesOn={selection.subtitle != null}
        menuOpen={overlay === 'settings'}
        settingsButton={settingsButton}
        onTogglePlay={controls.togglePlay}
        onSeek={seek}
        onSkip={(seconds) => controls.act({ type: 'seekBy', seconds })}
        onVolume={controls.changeVolume}
        onToggleMute={controls.toggleMute}
        onToggleSubtitles={controls.toggleSubtitles}
        onToggleMenu={() => (overlay === 'settings' ? closeMenu() : setOverlay('settings'))}
        onToggleFullscreen={fullscreen.toggle}
      />
      {infoOpen && (
        <PlaybackInfo
          readStats={engine.readStats}
          mode={mode}
          file={file}
          tracks={selection.tracks}
          audio={playingAudio({ mode, tracks: selection.tracks, audio: selection.audio })}
          onClose={closeInfo}
        />
      )}
      {overlay === 'settings' && (
        <SettingsMenu
          menuRef={menu}
          selection={{
            ...selection,
            pickAudio: actions.setAudio,
            pickSubtitle: actions.setSubtitle,
          }}
          subtitleStatus={subtitleStatus}
          rate={state.rate}
          mode={mode}
          onPickRate={controls.changeRate}
          onShowInfo={showInfo}
          onClose={closeMenu}
        />
      )}
      {overlay === 'shortcuts' && <ShortcutsDialog onClose={() => setOverlay('none')} />}
    </div>
  )
}
