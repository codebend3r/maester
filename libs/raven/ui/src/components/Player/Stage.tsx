import { KEYS } from '@/lib/keyboard'
import { PLAYER_SOURCE_KINDS, formatDuration } from '@raven/core'
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
import type { PlayChoices } from '@/components/Player/playChoices'
import type { Rendition } from '@/components/Player/rendition'
import type { StepDown } from '@/components/Player/usePlaybackLadder'
import type { Delivery } from '@/lib/streamSource'
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

const isControlTarget = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement && !!target.closest('button, a')

const isInDialog = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement && !!target.closest('dialog')

/**
 * Whether a focused button or link answers the key itself: Enter anywhere,
 * Space only in a menu or dialog. On the bar Space plays or pauses, as
 * YouTube's does, rather than pressing the button clicked last, Full screen
 * among them.
 */
const isPressedByControl = (event: KeyboardEvent): boolean => {
  if (!isControlTarget(event.target)) return false
  if (event.key === KEYS.enter) return true
  return event.key === KEYS.space && isInDialog(event.target)
}

export type StageProps = {
  engine: Extract<Engine, { kind: 'html' }>
  onBack: () => void
  rendition: Rendition
  selection: TrackSelection
  onFailure: (message: string) => void
  /** The connection cannot carry the converted stream as fast as it plays. */
  onSlow?: (delivery: Delivery) => void
  steppedDown?: StepDown | null
  choices?: PlayChoices | null
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
  rendition,
  selection,
  subtitleStatus,
  renderSubtitles,
  fullscreen,
  file = null,
  steppedDown = null,
  choices = null,
}: {
  engine: EngineHandle
  onBack: () => void
  rendition: Rendition
  selection: TrackSelection
  subtitleStatus: SubtitleStatus
  renderSubtitles?: (lifted: boolean) => ReactNode
  fullscreen: ReturnType<typeof useFullscreen>
  /** The library file playing, for the line under the title and Playback info; null for a local file. */
  file?: PlaybackFile | null
  /** Why the picture dropped to a transcode, when the connection is the reason. */
  steppedDown?: StepDown | null
  /** The ways to play this file and the viewer's pick among them; null where there is one. */
  choices?: PlayChoices | null
}) => {
  const { mode, quality } = rendition
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
  const upNext = useUpNext({ ended: state.ended, time: state.time, duration })
  const nextLink = upNext.next
  const setAutoplay = usePlayerPrefs((prefs) => prefs.setAutoplay)
  // Nothing holds the controls past this: not a pause, an open menu or a focused button.
  const lingerSeconds = usePlayerPrefs((prefs) => prefs.controlsLingerSeconds)
  const idle = useIdle(lingerSeconds * 1_000)
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
    if (isPressedByControl(event)) return
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
  // A button presses itself on Space's keyup, so the bar's are stopped there too.
  const onKeyUp = useEffectEvent((event: KeyboardEvent) => {
    if (event.key !== KEYS.space || !isControlTarget(event.target) || isInDialog(event.target))
      return
    event.preventDefault()
  })
  useEffect(() => {
    window.addEventListener('keydown', onKey)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('keyup', onKeyUp)
    }
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

  // The countdown keeps the controls up, so the ring it fills can be seen.
  const chromeShown = idle.active || upNext.countdown != null
  const about = aboutLine({ media, label, mode, context: title.context ?? null })

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
            icon={nextLink.isShuffled ? 'shuffle' : 'next'}
            className={styles.next}
            aria-label={`Up next: ${nextLink.label}`}
            title={nextLink.label}
          >
            <span className={styles.nextLead}>Up next</span>
            <span className={styles.nextLabel}>{nextLink.label}</span>
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
          playback: qualityLabel({ media, mode, quality }),
        }}
        menuOpen={isMenuSection(overlay) ? overlay : false}
        settingsButton={menuButton}
        upNext={nextLink?.label ?? null}
        autoplay={upNext.autoplay}
        countdown={upNext.countdown}
        onToggleAutoplay={() => setAutoplay(!upNext.autoplay)}
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
          steppedDown={steppedDown}
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
          steppedDown={steppedDown}
          choices={choices}
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
