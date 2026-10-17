import { KEYS } from '@/lib/keyboard'
import { PLAYER_SOURCE_KINDS, type PlaybackMode, formatDuration } from '@raven/core'
import {
  type ReactNode,
  type SyntheticEvent,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
} from 'react'
import type { Engine, EngineHandle } from '@/components/Player/engine'
import type { Handoff, PlayerFavourite } from '@/components/Player/PlayerServices'
import { useHtmlEngine } from '@/components/Player/useHtmlEngine'
import type { SubtitleStatus } from '@/components/Player/useSubtitleCues'
import { Button, ButtonLink } from '@/components/Button/Button'
import { Bezel } from '@/components/Player/Bezel'
import { Controls } from '@/components/Player/Controls'
import { Icon } from '@/components/Icon/Icon'
import { type MenuSection, isMenuSection } from '@/components/Player/menus'
import {
  aboutLine,
  audioPillLabel,
  qualityLabel,
  subtitlePillLabel,
} from '@/components/Player/playbackFacts'
import styles from '@/components/Player/Player.module.scss'
import { type PlaybackFile, PlaybackInfo } from '@/components/Player/PlaybackInfo'
import { playingAudio } from '@/components/Player/selection'
import { SettingsMenu } from '@/components/Player/SettingsMenu'
import { ShortcutsDialog } from '@/components/Player/ShortcutsDialog'
import { OVERLAYS, type Overlay, usePlayerActions } from '@/components/Player/usePlayerActions'
import { useBezel, useFullscreen, useIdle } from '@/components/Player/useStageChrome'
import { useUpNext } from '@/components/Player/useUpNext'
import type { TrackSelection } from '@/components/Player/useTrackSelection'
import { useWatchProgress } from '@/components/Player/useWatchProgress'
import { isInForeignDialog, isTypingTarget } from '@/lib/keyboard'
import { PLAYER_ACTIONS, type PlayerAction, shortcutFor } from '@/lib/shortcuts'
import { usePlayerPrefs } from '@/stores/playerPrefs'
import { useHostServices } from '@/stores/playerServices'

/**
 * How long the controls and cursor linger after the last mouse move, key
 * press or click. Nothing holds them past it: not a pause, an open menu or a
 * focused button.
 */
const IDLE_MS = 10_000

const isControlTarget = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement && !!target.closest('button, a')

export type StageProps = {
  engine: Extract<Engine, { kind: 'html' }>
  onBack: () => void
  mode: PlaybackMode
  selection: TrackSelection
  onFailure: (message: string) => void
}

export const Stage = ({ engine, ...props }: StageProps) => {
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
      file={source.kind === PLAYER_SOURCE_KINDS.server ? source : null}
      fullscreen={fullscreen}
    />
  )
}

/**
 * Shared controls consume only the engine handle, never the picture's DOM:
 * the top bar with the way back, the title and what is playing, the bar at
 * the bottom, and the menus and dialogs over the picture.
 */
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
  /** The library file playing, for the line under the title and Playback info; null for a local file. */
  file?: PlaybackFile | null
}) => {
  const { title, hostActions, favourite, chrome, isVolumeFixed, handoff } = useHostServices()
  const media = file?.media ?? null
  const label = title.label
  const { state, duration, actions } = engine
  const seek = actions.seek
  const root = useRef<HTMLDivElement>(null)
  const menu = useRef<HTMLDialogElement>(null)
  const menuButton = useRef<HTMLButtonElement>(null)
  const volume = usePlayerPrefs((prefs) => prefs.volume)
  const muted = usePlayerPrefs((prefs) => prefs.muted)
  useWatchProgress({ state, position: engine.position, duration })
  const nextLink = useUpNext({ ended: state.ended })
  const idle = useIdle(IDLE_MS)
  const { bezel, flash } = useBezel()
  const [overlay, setOverlay] = useState<Overlay>(OVERLAYS.none)
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
    setOverlay(OVERLAYS.none)
    if (menuButton.current !== null) menuButton.current.focus()
  }

  const toggleMenu = (section: MenuSection) =>
    overlay === section ? closeMenu() : setOverlay(section)

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
    // A host's dialog over the player keeps its keys, Escape included: they close it, not the player.
    if (isInForeignDialog({ target: event.target, root: root.current })) return
    idle.wake()
    const action = shortcutFor(event)
    // Form controls keep their own keys (the radios' arrows, the volume
    // slider's); only Escape reaches past them, to close what they sit in.
    const isEscape = action !== null && action.type === PLAYER_ACTIONS.escape
    if (isTypingTarget(event.target) && !isEscape) return
    // A focused button or link answers Space and Enter itself.
    const isPress = event.key === KEYS.space || event.key === KEYS.enter
    if (isControlTarget(event.target) && isPress) return
    if (!action) return
    // An engine without the video info overlay leaves `i` to the page.
    if (action.type === PLAYER_ACTIONS.toggleStats && actions.toggleStats === undefined) return
    // With the shortcut list open, the keys only close it.
    if (
      overlay === OVERLAYS.shortcuts &&
      action.type !== PLAYER_ACTIONS.escape &&
      action.type !== PLAYER_ACTIONS.showShortcuts
    ) {
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
    if (!isMenuSection(overlay) || !(target instanceof Node)) return
    const isInMenu = menu.current?.contains(target) ?? false
    if (isInMenu || (menuButton.current?.contains(target) ?? false)) return
    setOverlay(OVERLAYS.none)
  }

  const handOff = (to: Handoff) => {
    actions.pause()
    to.run(engine.position.current)
    closeMenu()
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
  const about = aboutLine({ media, label, mode })

  // The scrubber and the clock keep what they showed while the controls are
  // hidden, so a quiet page changes nothing in the DOM. Adjusting state during
  // render is React's way to derive this from the previous render.
  const [held, setHeld] = useState({ time: state.time, buffered: state.buffered })
  if (chromeShown && (held.time !== state.time || held.buffered !== state.buffered)) {
    setHeld({ time: state.time, buffered: state.buffered })
  }

  const tellHost = useEffectEvent((isShown: boolean) => {
    if (chrome === undefined) return
    chrome.shown(isShown)
  })
  useEffect(() => {
    tellHost(chromeShown)
  }, [chromeShown])
  // The player going away leaves the host's own chrome as it should be.
  useEffect(() => () => tellHost(true), [])

  return (
    <div
      ref={root}
      className={[styles.stage, chromeShown ? '' : styles.idle].filter(Boolean).join(' ')}
      onPointerMove={idle.wake}
      onPointerDown={onStagePointerDown}
    >
      {engine.surface}
      {!engine.drawsSubtitles && (renderSubtitles?.(chromeShown) ?? null)}
      {state.waiting && !state.paused && <output className={styles.spinner} aria-label="Loading" />}
      {state.paused && chromeShown && (
        // The picture under it takes the click; this only says a click will play.
        <span className={styles.paused} aria-hidden="true">
          <Icon name="play" size={40} />
        </span>
      )}
      {!!bezel && <Bezel key={bezel.id} bezel={bezel} />}
      <p className="visually-hidden" aria-live="polite">
        {bezel?.text ?? null}
      </p>
      <header
        className={[styles.chrome, chromeShown ? '' : styles.chromeHidden]
          .filter(Boolean)
          .join(' ')}
      >
        <Button
          tone="ghost"
          icon="back"
          aria-label="Back"
          className={styles.back}
          onClick={onBack}
        />
        <h1 className={styles.title}>{label}</h1>
        <p className={styles.about}>{about}</p>
        {favourite && (
          <Button
            tone="ghost"
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
            tone="ghost"
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
            <Button tone="ghost" className={styles.startOver} onClick={startOver}>
              Start over
            </Button>
          </p>
        )}
      </header>
      <Controls
        shown={chromeShown}
        paused={state.paused}
        time={held.time}
        duration={duration}
        buffered={held.buffered}
        volume={volume}
        muted={muted}
        isVolumeFixed={isVolumeFixed}
        fullscreen={fullscreen.fullscreen}
        subtitlesOn={selection.subtitle != null}
        menuValues={{
          subtitles: subtitlePillLabel(selection.subtitle),
          audio: audioPillLabel({
            mode,
            tracks: selection.tracks,
            audio: selection.audio,
            playsPickedAudio: selection.playsPickedAudio,
          }),
          playback: qualityLabel({ media, mode }),
        }}
        menuOpen={isMenuSection(overlay) ? overlay : false}
        settingsButton={menuButton}
        onTogglePlay={controls.togglePlay}
        onSeek={seek}
        onSkip={(seconds) => controls.act({ type: PLAYER_ACTIONS.seekBy, seconds })}
        onVolume={controls.changeVolume}
        onToggleMute={controls.toggleMute}
        onToggleMenu={toggleMenu}
        onToggleFullscreen={fullscreen.toggle}
      />
      {infoOpen && (
        <PlaybackInfo
          readStats={engine.readStats}
          mode={mode}
          file={file}
          tracks={selection.tracks}
          audio={playingAudio({
            mode,
            tracks: selection.tracks,
            audio: selection.audio,
            playsPickedAudio: selection.playsPickedAudio,
          })}
          onClose={closeInfo}
        />
      )}
      {isMenuSection(overlay) && (
        <SettingsMenu
          // A menu of its own for each pill, so switching puts the keyboard in the new one.
          key={overlay}
          section={overlay}
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
          {...(handoff && { onHandoff: () => handOff(handoff), handoffLabel: handoff.label })}
        />
      )}
      {overlay === OVERLAYS.shortcuts && (
        <ShortcutsDialog
          canShowStats={!!actions.toggleStats}
          onClose={() => setOverlay(OVERLAYS.none)}
        />
      )}
    </div>
  )
}
