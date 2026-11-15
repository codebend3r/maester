import { PLAYER_ACTIONS, PLAYER_SOURCE_KINDS, SEEK_EDGES, playingAudio } from '@raven/core'
import { type ReactNode, type SyntheticEvent, useRef, useState } from 'react'
import { BarCardView, barCardOf, skipActionOf } from '@/components/Player/BarCard'
import { Bezel, HOLD_LOOKS, HoldMark } from '@/components/Player/Bezel'
import { Controls } from '@/components/Player/Controls'
import {
  ENGINE_KINDS,
  type EngineHandle,
  type EngineOf,
  type PlaybackFile,
} from '@/components/Player/engine'
import { Icon } from '@/components/Icon/Icon'
import { type MenuSection, isMenuSection } from '@/components/Player/menus'
import {
  audioPillLabel,
  endsAtLabel,
  qualityLabel,
  subtitlePillLabel,
} from '@/components/Player/playbackFacts'
import styles from '@/components/Player/Player.module.scss'
import { PlaybackInfo } from '@/components/Player/PlaybackInfo'
import { PlayerHeader } from '@/components/Player/PlayerHeader'
import type { Handoff } from '@/components/Player/PlayerServices'
import type { PlayChoices } from '@/components/Player/playChoices'
import { Preloader } from '@/components/Player/Preloader'
import type { Rendition } from '@/components/Player/rendition'
import { SettingsMenu } from '@/components/Player/SettingsMenu'
import { ShortcutsDialog } from '@/components/Player/ShortcutsDialog'
import { ShortcutsTip } from '@/components/Player/ShortcutsTip'
import { useHostChromeSync } from '@/components/Player/useHostChromeSync'
import { useHtmlEngine } from '@/components/Player/useHtmlEngine'
import type { PlaybackFailure, StepDown } from '@/components/Player/usePlaybackLadder'
import { OVERLAYS, type Overlay, usePlayerActions } from '@/components/Player/usePlayerActions'
import { useResumeNotice } from '@/components/Player/useResumeNotice'
import { useShortcutsTip } from '@/components/Player/useShortcutsTip'
import { useSkipIntro } from '@/components/Player/useSkipIntro'
import {
  type Fullscreen,
  useBezel,
  useFullscreen,
  useIdle,
  useNow,
} from '@/components/Player/useStageChrome'
import { useStageKeys } from '@/components/Player/useStageKeys'
import { useTouchGestures } from '@/components/Player/useTouchGestures'
import type { TrackSelection } from '@/components/Player/useTrackSelection'
import { useUpNext } from '@/components/Player/useUpNext'
import { useWatchProgress } from '@/components/Player/useWatchProgress'
import type { Delivery } from '@/lib/streamSource'
import { classNames } from '@/lib/classNames'
import { usePlayerPrefs } from '@/stores/playerPrefs'
import { useHostServices } from '@/stores/playerServices'

/** "Ends at" names a minute, so a step of 15 seconds keeps it true. */
const ENDS_AT_STEP_MS = 15_000

/** The play mark over a paused picture. */
const PAUSED_ICON_SIZE = 40

export type StageProps = {
  engine: EngineOf<typeof ENGINE_KINDS.html>
  onBack: () => void
  rendition: Rendition
  selection: TrackSelection
  onFailure: (failure: PlaybackFailure) => void
  /** The connection cannot carry the converted stream as fast as it plays; null where nothing converts. */
  onSlow: ((delivery: Delivery) => void) | null
  steppedDown: StepDown | null
  choices: PlayChoices | null
  /** What the picture needs said over it as it plays. */
  notice: ReactNode
}

export const Stage = ({
  engine,
  onBack,
  rendition,
  selection,
  onFailure,
  onSlow,
  steppedDown,
  choices,
  notice,
}: StageProps) => {
  const fullscreen = useFullscreen()
  const html = useHtmlEngine({
    source: engine.source,
    rendition,
    selection,
    onFailure,
    onSlow,
    toggleFullscreen: fullscreen.toggle,
  })
  const source = engine.source
  return (
    <PlayerChrome
      engine={html}
      onBack={onBack}
      rendition={rendition}
      fullscreen={fullscreen}
      file={source.kind === PLAYER_SOURCE_KINDS.server ? source : null}
      steppedDown={steppedDown}
      choices={choices}
      notice={notice}
    />
  )
}

type PlayerChromeProps = {
  engine: EngineHandle
  onBack: () => void
  rendition: Rendition
  fullscreen: Fullscreen
  /** The library file playing, for the line under the title and Playback info; null for a local file. */
  file: PlaybackFile | null
  /** Why the picture dropped to a transcode, when the connection is the reason. */
  steppedDown: StepDown | null
  /** The ways to play this file and the viewer's pick among them; null where there is one. */
  choices: PlayChoices | null
  /** What the engine's host needs said over the picture as it plays, beside the keyboard tip. */
  notice: ReactNode
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
  fullscreen,
  file,
  steppedDown,
  choices,
  notice,
}: PlayerChromeProps) => {
  const { mode, quality } = rendition
  const resumeAt = useHostServices((services) => services.title.resumeAt)
  const markers = useHostServices((services) => services.title.markers)
  const hostActions = useHostServices((services) => services.hostActions)
  const chrome = useHostServices((services) => services.chrome)
  const isVolumeFixed = useHostServices((services) => services.isVolumeFixed)
  const handoff = useHostServices((services) => services.handoff)
  const media = file?.media ?? null
  const { state, duration, actions, selection } = engine
  const seek = actions.seek
  const root = useRef<HTMLDivElement>(null)
  const menu = useRef<HTMLDialogElement>(null)
  const menuButton = useRef<HTMLButtonElement>(null)
  const volume = usePlayerPrefs((prefs) => prefs.volume)
  const muted = usePlayerPrefs((prefs) => prefs.muted)
  useWatchProgress({
    state,
    position: engine.position,
    duration,
    audio: selection.audio ?? selection.tracks?.defaultAudio ?? null,
  })
  const upNext = useUpNext({
    ended: state.ended,
    time: state.time,
    duration,
    credits: markers?.credits ?? null,
    seek,
  })
  const intro = useSkipIntro({ time: state.time, intro: markers?.intro ?? null, seek })
  const skipAction = skipActionOf({
    undo: intro.undo,
    skipIntro: intro.isInside ? intro.skip : null,
    skipCredits: upNext.skipCredits,
  })
  const barCard = barCardOf({ isCardShown: upNext.isCardShown, next: upNext.next, skipAction })
  const setAutoplay = usePlayerPrefs((prefs) => prefs.setAutoplay)
  const now = useNow(ENDS_AT_STEP_MS)
  // Nothing holds the controls past this: not a pause, an open menu or a focused button.
  const lingerSeconds = usePlayerPrefs((prefs) => prefs.controlsLingerSeconds)
  const idle = useIdle(lingerSeconds * 1_000)
  const { bezel, isFlashing, flash } = useBezel()
  const [overlay, setOverlay] = useState<Overlay>(OVERLAYS.none)
  // Apart from the overlay: it stays open over the video, menus and all.
  const [infoOpen, setInfoOpen] = useState(false)
  const resume = useResumeNotice(resumeAt)

  const shortcutsTip = useShortcutsTip({
    isPlaying: !state.paused,
    isListOpen: overlay === OVERLAYS.shortcuts,
  })

  const closeMenu = () => {
    setOverlay(OVERLAYS.none)
    menuButton.current?.focus()
  }

  const toggleMenu = (section: MenuSection) =>
    overlay === section ? closeMenu() : setOverlay(section)

  const showInfo = () => {
    closeMenu()
    // The panel opens where the resume notice sits, over its Start over.
    resume.dismiss()
    setInfoOpen(true)
  }

  const closeInfo = () => {
    setInfoOpen(false)
    engine.focusSurface()
  }

  const controls = usePlayerActions({
    engine,
    flash,
    toggleFullscreen: fullscreen.toggle,
    overlay,
    setOverlay,
    closeMenu,
    closeInfo: infoOpen ? closeInfo : null,
    leave: onBack,
  })

  // A finger's taps climb the same ladder as the keys and the buttons: all three are `act`'s skip.
  const gestures = useTouchGestures({
    engine,
    onSkip: (direction) => controls.act({ type: PLAYER_ACTIONS.skip, direction }),
    onTap: controls.togglePlay,
  })

  useStageKeys({
    root,
    overlay,
    canShowStats: actions.toggleStats !== null,
    hostActions,
    wake: idle.wake,
    act: controls.act,
  })

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
    resume.dismiss()
    engine.focusSurface()
  }

  /*
   * The up next card keeps the controls up, so it and the ring it fills can be
   * seen, and so does an intro's first seconds, so Skip intro is.
   */
  const chromeShown = idle.active || upNext.isCardShown || intro.isPrompting
  const chapterStarts = markers?.chapters.map(({ start }) => start) ?? []
  const audioPlaying = {
    mode,
    tracks: selection.tracks,
    audio: selection.audio,
    shouldPlayPickedAudio: selection.shouldPlayPickedAudio,
  }

  /*
   * The scrubber and the clock keep what they showed while the controls are
   * hidden, so a quiet page changes nothing in the DOM. Adjusting state during
   * render is React's way to derive this from the previous render.
   */
  const [held, setHeld] = useState({ time: state.time, buffered: state.buffered })
  if (chromeShown && (held.time !== state.time || held.buffered !== state.buffered)) {
    setHeld({ time: state.time, buffered: state.buffered })
  }

  useHostChromeSync({ chrome, isShown: chromeShown })

  return (
    <div
      ref={root}
      className={classNames([styles.stage, !chromeShown && styles.idle])}
      {...gestures.handlers}
      onPointerMove={(event) => {
        idle.wake()
        gestures.onPointerMove(event)
      }}
      onPointerDown={(event) => {
        onStagePointerDown(event)
        gestures.onPointerDown(event)
      }}
    >
      {engine.surface}
      {engine.subtitles.overlay?.(chromeShown) ?? null}
      {/* A skip waits for data while its flash shows: one thing at a time in the middle. */}
      {state.waiting && !isFlashing && <Preloader />}
      {state.paused && !state.waiting && chromeShown && gestures.hold === null && (
        // The picture under it takes the click; this only says a click will play.
        <span className={styles.paused} aria-hidden="true">
          <Icon name="play" size={PAUSED_ICON_SIZE} />
        </span>
      )}
      {!!bezel && <Bezel key={bezel.id} bezel={bezel} />}
      {gestures.hold !== null && <HoldMark side={gestures.hold} />}
      <p className="visually-hidden" aria-live="polite">
        {gestures.hold === null ? (bezel?.text ?? null) : HOLD_LOOKS[gestures.hold].label}
      </p>
      <PlayerHeader
        isShown={chromeShown}
        media={media}
        rendition={rendition}
        duration={duration}
        resumedAt={resume.resumedAt}
        onBack={onBack}
        onStartOver={startOver}
      />
      <Controls
        shown={chromeShown}
        paused={state.paused}
        time={held.time}
        duration={duration}
        buffered={held.buffered}
        chapters={chapterStarts}
        volume={volume}
        muted={muted}
        isVolumeFixed={isVolumeFixed}
        fullscreen={fullscreen.fullscreen}
        subtitlesOn={selection.subtitle != null}
        menuValues={{
          subtitles: subtitlePillLabel(selection.subtitle),
          audio: audioPillLabel(audioPlaying),
          playback: qualityLabel({ media, mode, quality }),
        }}
        menuOpen={isMenuSection(overlay) ? overlay : false}
        settingsButton={menuButton}
        upNext={upNext.next?.label ?? null}
        countdown={upNext.countdown}
        card={
          barCard && (
            <BarCardView card={barCard} upNext={upNext} focusSurface={engine.focusSurface} />
          )
        }
        endsAt={endsAtLabel({ now, time: held.time, duration, rate: state.rate })}
        onRestart={() => controls.act({ type: PLAYER_ACTIONS.seekToEdge, edge: SEEK_EDGES.start })}
        onNext={upNext.playNext}
        onTogglePlay={controls.togglePlay}
        onSeek={seek}
        onSkip={(direction) => controls.act({ type: PLAYER_ACTIONS.skip, direction })}
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
          audio={playingAudio(audioPlaying)}
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
          subtitleStatus={engine.subtitles.status}
          rate={state.rate}
          mode={mode}
          steppedDown={steppedDown}
          choices={choices}
          captionStyle={engine.captionStyle}
          onPickCaption={actions.setCaptionStyle}
          onPickRate={controls.changeRate}
          autoplay={upNext.autoplay}
          onPickAutoplay={setAutoplay}
          onShowInfo={showInfo}
          onClose={closeMenu}
          {...(handoff && { onHandoff: () => handOff(handoff), handoffLabel: handoff.label })}
        />
      )}
      {notice}
      {shortcutsTip.isShown && <ShortcutsTip onDismiss={shortcutsTip.dismiss} />}
      {overlay === OVERLAYS.shortcuts && (
        <ShortcutsDialog
          canShowStats={actions.toggleStats !== null}
          onClose={() => setOverlay(OVERLAYS.none)}
        />
      )}
    </div>
  )
}
