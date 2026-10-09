import { useQueryClient } from '@tanstack/react-query'
import {
  type MediaItem,
  type MediaTracks,
  type PlaybackMode,
  STREAM_TIME_SHIFT,
  type SubtitleTrack,
  formatDuration,
  streamMimeType,
} from '@raven/core'
import { type SyntheticEvent, useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, ButtonLink } from '@/components/Button/Button'
import { Bezel, type BezelState } from '@/components/Player/Bezel'
import { Controls } from '@/components/Player/Controls'
import styles from '@/components/Player/Player.module.scss'
import { SettingsMenu } from '@/components/Player/SettingsMenu'
import { ShortcutsDialog } from '@/components/Player/ShortcutsDialog'
import { SubtitleOverlay } from '@/components/Player/SubtitleOverlay'
import { useSubtitleCues } from '@/components/Player/useSubtitleCues'
import { api } from '@/lib/api'
import { type PlayerAction, shortcutFor, stepCaptionScale, stepSpeed } from '@/lib/shortcuts'
import { createStreamSession } from '@/lib/streamSource'
import { languageName } from '@/lib/trackLabels'
import { usePlayerPrefs } from '@/stores/playerPrefs'

/** How long the controls and cursor linger after the last mouse move or key press. */
const IDLE_MS = 2500
/** Progress is saved this often while playing, plus on pause and on leaving. */
const SAVE_EVERY_S = 10
/** Frames per second to step by when the file does not say. */
const FALLBACK_FRAME_RATE = 24

export const failureMessage = (error: MediaError | null): string => {
  if (error?.code === MediaError.MEDIA_ERR_NETWORK) return 'The connection to the server dropped.'
  if (error?.code === MediaError.MEDIA_ERR_DECODE) return "The browser couldn't decode this file."
  if (error?.code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED) {
    return "The browser couldn't open this file."
  }
  return 'Playback stopped unexpectedly.'
}

const isTypingTarget = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement && !!target.closest('input, select, textarea')

const isControlTarget = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement && !!target.closest('button, a')

const clamp = ({ value, min, max }: { value: number; min: number; max: number }): number =>
  Math.min(max, Math.max(min, value))

/** A <video>'s buffered ranges on the file's clock. */
const bufferedRanges = ({
  element,
  shift,
}: {
  element: HTMLVideoElement
  shift: number
}): Array<[number, number]> =>
  Array.from({ length: element.buffered.length }, (_, index): [number, number] => [
    Math.max(0, element.buffered.start(index) - shift),
    Math.max(0, element.buffered.end(index) - shift),
  ])

export type StageProps = {
  media: MediaItem
  backTo: string
  mode: PlaybackMode
  /** The `0:a:N` track to play, or null for the file's default. */
  audio: number | null
  tracks: MediaTracks | null
  tracksFailed: boolean
  subtitle: SubtitleTrack | null
  onFailure: (message: string) => void
  onPickAudio: (index: number) => void
  onPickSubtitle: (id: string | null) => void
  /** Turns subtitles off, or on in the last language used; says which track it landed on. */
  onToggleSubtitles: () => SubtitleTrack | null
}

/**
 * The video and everything over it, full screen and focused on arrival.
 * Every time here is file time: a converted stream runs `STREAM_TIME_SHIFT`
 * ahead of the file, and `shift` takes that off wherever the element's
 * clock is read or set.
 */
export const Stage = ({
  media,
  backTo,
  mode,
  audio,
  tracks,
  tracksFailed,
  subtitle,
  onFailure,
  onPickAudio,
  onPickSubtitle,
  onToggleSubtitles,
}: StageProps) => {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const stage = useRef<HTMLDivElement>(null)
  const video = useRef<HTMLVideoElement>(null)
  const menu = useRef<HTMLDialogElement>(null)
  const settingsButton = useRef<HTMLButtonElement>(null)
  const idleTimer = useRef<number | null>(null)
  const bezelCount = useRef(0)
  const { volume, muted, setVolume, captionScale, setCaptionScale } = usePlayerPrefs()

  const shift = mode === 'direct' ? 0 : STREAM_TIME_SHIFT
  const shiftRef = useRef(shift)
  const resumable = media.position > 0 && media.position < (media.duration ?? Infinity) - 10
  const startAt = resumable ? media.position : 0
  /** Where playback is, kept across a change of source so the new one picks up there. */
  const position = useRef(startAt)
  /** Whether to keep playing across a change of source; the first source autoplays. */
  const playing = useRef(true)
  const lastSaved = useRef(media.position)
  // Nothing is saved until frames actually play: a video that never got
  // going still fires `pause` at 0:00 on the way out, and saving that would
  // wipe the place the viewer really stopped.
  const started = useRef(false)
  const failRef = useRef(onFailure)

  const [time, setTime] = useState(startAt)
  const [elementDuration, setElementDuration] = useState<number | null>(null)
  const [buffered, setBuffered] = useState<Array<[number, number]>>([])
  const [paused, setPaused] = useState(true)
  const [waiting, setWaiting] = useState(false)
  const [rate, setRate] = useState(1)
  const [fullscreen, setFullscreen] = useState(false)
  const [active, setActive] = useState(true)
  const [menuOpen, setMenuOpen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const [resumedAt, setResumedAt] = useState<number | null>(resumable ? media.position : null)
  const [bezel, setBezel] = useState<BezelState | null>(null)

  const duration = media.duration ?? elementDuration
  const { cues, status: subtitleStatus } = useSubtitleCues({
    mediaId: media.id,
    track: subtitle,
    time,
    duration,
  })

  useEffect(() => {
    shiftRef.current = shift
    failRef.current = onFailure
  })

  const fileTime = useCallback(
    (): number => Math.max(0, (video.current?.currentTime ?? 0) - shiftRef.current),
    [],
  )

  const save = useCallback(
    (at: number) => {
      if (!started.current || !Number.isFinite(at)) return
      lastSaved.current = at
      api.saveProgress({ id: media.id, position: at }).catch(() => undefined)
    },
    [media.id],
  )

  const flash = useCallback((next: Omit<BezelState, 'id'>) => {
    bezelCount.current += 1
    setBezel({ ...next, id: bezelCount.current })
  }, [])

  const scheduleIdle = useCallback(() => {
    if (idleTimer.current != null) window.clearTimeout(idleTimer.current)
    idleTimer.current = window.setTimeout(() => setActive(false), IDLE_MS)
  }, [])

  const wake = useCallback(() => {
    setActive(true)
    scheduleIdle()
  }, [scheduleIdle])

  // Arriving at the player puts the keyboard on the video straight away.
  useEffect(() => {
    video.current?.focus()
    scheduleIdle()
    const title = document.title
    document.title = media.title
    const element = video.current
    const resumedTimer = window.setTimeout(() => setResumedAt(null), 6000)
    return () => {
      document.title = title
      window.clearTimeout(resumedTimer)
      if (idleTimer.current != null) window.clearTimeout(idleTimer.current)
      if (element && element.readyState > 0) save(position.current)
      // Resume lines on the library grid should reflect where this stopped.
      void queryClient.invalidateQueries({ queryKey: ['libraries', media.libraryId, 'media'] })
    }
  }, [media.title, media.libraryId, queryClient, save, scheduleIdle])

  // The source: the file itself, or a converted stream through Media Source
  // Extensions. A change of mode or audio track rebuilds it where playback was.
  const mime = mode === 'direct' ? '' : streamMimeType({ media, mode })
  useEffect(() => {
    const element = video.current
    if (!element) return
    const from = position.current
    const resume = playing.current
    const play = () => {
      if (resume) element.play()?.catch(() => setPaused(true))
    }
    if (mode === 'direct') {
      const onReady = () => {
        if (from > 0) element.currentTime = from
        play()
      }
      element.addEventListener('loadedmetadata', onReady, { once: true })
      element.src = api.fileUrl(media.id)
      return () => {
        element.removeEventListener('loadedmetadata', onReady)
        element.removeAttribute('src')
        element.load()
      }
    }
    const session = createStreamSession({
      video: element,
      mime,
      duration: media.duration,
      start: from,
      url: (start) => api.streamUrl({ id: media.id, mode, start, audio }),
      onError: (message) => failRef.current(message),
    })
    play()
    return () => session.destroy()
  }, [mode, audio, mime, media.id, media.duration])

  // Closing the tab mid-film still records the position.
  useEffect(() => {
    const onHide = () => save(position.current)
    window.addEventListener('pagehide', onHide)
    return () => window.removeEventListener('pagehide', onHide)
  }, [save])

  useEffect(() => {
    const onChange = () => setFullscreen(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])

  const seek = useCallback(
    (target: number) => {
      const element = video.current
      if (!element) return
      const end = duration ?? Infinity
      const to = clamp({ value: target, min: 0, max: Math.max(0, end - 0.5) })
      element.currentTime = to + shiftRef.current
      position.current = to
      setTime(to)
    },
    [duration],
  )

  const togglePlay = useCallback(() => {
    const element = video.current
    if (!element) return
    if (element.paused) element.play()?.catch(() => undefined)
    else element.pause()
  }, [])

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen()
    else void stage.current?.requestFullscreen?.()
  }, [])

  const changeVolume = useCallback(
    (next: number) => {
      const element = video.current
      if (!element) return
      element.volume = clamp({ value: next, min: 0, max: 1 })
      element.muted = element.volume === 0
      flash({
        icon: element.muted ? 'muted' : 'volume',
        text: `${Math.round(element.volume * 100)}%`,
      })
    },
    [flash],
  )

  const toggleMute = useCallback(() => {
    const element = video.current
    if (!element) return
    element.muted = !element.muted
    flash({ icon: element.muted ? 'muted' : 'volume', text: element.muted ? 'Muted' : 'Sound on' })
  }, [flash])

  const changeRate = useCallback(
    (next: number) => {
      const element = video.current
      if (!element) return
      // The default carries the speed across a change of source, which resets it.
      element.defaultPlaybackRate = next
      element.playbackRate = next
      flash({ icon: 'forward', text: next === 1 ? 'Normal speed' : `${next}×` })
    },
    [flash],
  )

  const toggleSubtitles = useCallback(() => {
    const hasAny = !!tracks?.subtitles.some((track) => track.supported)
    if (!hasAny && subtitle == null) {
      flash({ icon: 'captions', text: 'No subtitles' })
      return
    }
    const landed = onToggleSubtitles()
    flash({
      icon: 'captions',
      text: landed ? `Subtitles: ${languageName(landed.language) ?? 'on'}` : 'Subtitles off',
    })
  }, [tracks, subtitle, onToggleSubtitles, flash])

  const closeMenu = useCallback(() => {
    setMenuOpen(false)
    settingsButton.current?.focus()
  }, [])

  const act = useCallback(
    (action: PlayerAction) => {
      const element = video.current
      if (!element) return
      const now = fileTime()
      switch (action.type) {
        case 'togglePlay':
          flash({
            icon: element.paused ? 'play' : 'pause',
            text: element.paused ? 'Play' : 'Pause',
          })
          togglePlay()
          return
        case 'seekBy':
          seek(now + action.seconds)
          flash({
            icon: action.seconds < 0 ? 'rewind' : 'forward',
            text: `${action.seconds < 0 ? 'Back' : 'Forward'} ${Math.abs(action.seconds)}s`,
          })
          return
        case 'seekToFraction':
          if (duration == null) return
          seek(duration * action.fraction)
          flash({ icon: 'forward', text: `${Math.round(action.fraction * 100)}%` })
          return
        case 'seekToEdge':
          seek(action.edge === 'start' ? 0 : (duration ?? now))
          return
        case 'volumeBy':
          changeVolume((element.muted ? 0 : element.volume) + action.delta)
          return
        case 'toggleMute':
          toggleMute()
          return
        case 'toggleFullscreen':
          toggleFullscreen()
          return
        case 'toggleSubtitles':
          toggleSubtitles()
          return
        case 'stepFrame': {
          if (!element.paused) element.pause()
          const frame = 1 / (tracks?.frameRate ?? FALLBACK_FRAME_RATE)
          seek(now + action.direction * frame)
          return
        }
        case 'stepSpeed':
          changeRate(stepSpeed({ current: element.playbackRate, direction: action.direction }))
          return
        case 'stepCaptionSize': {
          const next = stepCaptionScale({ current: captionScale, direction: action.direction })
          setCaptionScale(next)
          flash({ icon: 'captions', text: `Subtitles ${Math.round(next * 100)}%` })
          return
        }
        case 'showShortcuts':
          setMenuOpen(false)
          setHelpOpen((open) => !open)
          return
        case 'escape':
          if (helpOpen) setHelpOpen(false)
          else if (menuOpen) closeMenu()
          else if (document.fullscreenElement) void document.exitFullscreen()
          else navigate(backTo)
          return
        default:
          return
      }
    },
    [
      fileTime,
      flash,
      togglePlay,
      seek,
      duration,
      changeVolume,
      toggleMute,
      toggleFullscreen,
      toggleSubtitles,
      tracks,
      changeRate,
      captionScale,
      setCaptionScale,
      helpOpen,
      menuOpen,
      closeMenu,
      navigate,
      backTo,
    ],
  )

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const action = shortcutFor(event)
      // Form controls keep their own keys (the radios' arrows, the volume
      // slider's); only Escape reaches past them, to close what they sit in.
      if (isTypingTarget(event.target) && action?.type !== 'escape') return
      // A focused button or link answers Space and Enter itself.
      if (isControlTarget(event.target) && (event.key === ' ' || event.key === 'Enter')) return
      wake()
      if (!action) return
      // With the shortcut list open, the keys only close it.
      if (helpOpen && action.type !== 'escape' && action.type !== 'showShortcuts') return
      event.preventDefault()
      act(action)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [act, wake, helpOpen])

  // A press outside the open menu closes it, as a popover should.
  const onStagePointerDown = (event: SyntheticEvent) => {
    wake()
    const target = event.target
    if (!menuOpen || !(target instanceof Node)) return
    if (menu.current?.contains(target) || settingsButton.current?.contains(target)) return
    setMenuOpen(false)
  }

  const onLoadedMetadata = (event: SyntheticEvent<HTMLVideoElement>) => {
    const element = event.currentTarget
    element.volume = volume
    element.muted = muted
  }

  const onTimeUpdate = (event: SyntheticEvent<HTMLVideoElement>) => {
    const element = event.currentTarget
    // Before metadata the clock reads zero whatever the source will start at.
    if (element.readyState < HTMLMediaElement.HAVE_METADATA) return
    const now = fileTime()
    position.current = now
    setTime(now)
    setBuffered(bufferedRanges({ element, shift: shiftRef.current }))
    if (Math.abs(now - lastSaved.current) >= SAVE_EVERY_S) save(now)
  }

  const startOver = () => {
    seek(0)
    video.current?.play()?.catch(() => undefined)
    setResumedAt(null)
    video.current?.focus()
  }

  const chromeShown = paused || active || menuOpen || helpOpen

  return (
    <div
      ref={stage}
      className={[styles.stage, chromeShown ? '' : styles.idle].filter(Boolean).join(' ')}
      onPointerMove={wake}
      onPointerDown={onStagePointerDown}
    >
      {/* Subtitles are drawn by SubtitleOverlay rather than <track>, so they
          follow the theme and work the same for converted streams. */}
      {/* oxlint-disable-next-line jsx-a11y/media-has-caption, jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions */}
      <video
        ref={video}
        className={styles.video}
        poster={api.thumbnailUrl(media) ?? undefined}
        autoPlay
        playsInline
        preload="auto"
        tabIndex={-1}
        aria-label={media.title}
        onClick={togglePlay}
        onDoubleClick={toggleFullscreen}
        onLoadedMetadata={onLoadedMetadata}
        onDurationChange={(event) => {
          const total = event.currentTarget.duration - shiftRef.current
          setElementDuration(Number.isFinite(total) && total > 0 ? total : null)
        }}
        onTimeUpdate={onTimeUpdate}
        onSeeked={onTimeUpdate}
        onProgress={(event) =>
          setBuffered(bufferedRanges({ element: event.currentTarget, shift: shiftRef.current }))
        }
        onPlay={() => {
          setPaused(false)
          playing.current = true
        }}
        onPlaying={() => {
          started.current = true
          setWaiting(false)
        }}
        onWaiting={() => setWaiting(true)}
        onCanPlay={() => setWaiting(false)}
        onPause={(event) => {
          // Letting go of a source on the way to another pauses too; that is not the viewer.
          if (event.currentTarget.readyState === HTMLMediaElement.HAVE_NOTHING) return
          setPaused(true)
          playing.current = false
          save(fileTime())
        }}
        onEnded={() => save(duration ?? fileTime())}
        onRateChange={(event) => setRate(event.currentTarget.playbackRate)}
        onVolumeChange={(event) =>
          setVolume({ volume: event.currentTarget.volume, muted: event.currentTarget.muted })
        }
        onError={(event) => {
          if (!event.currentTarget.getAttribute('src')) return
          failRef.current(failureMessage(event.currentTarget.error))
        }}
      />
      <SubtitleOverlay
        cues={cues}
        video={video}
        shift={shift}
        lifted={chromeShown}
        scale={captionScale}
      />
      {waiting && !paused && <output className={styles.spinner} aria-label="Loading" />}
      {!!bezel && <Bezel key={bezel.id} bezel={bezel} />}
      <p className="visually-hidden" aria-live="polite">
        {bezel?.text}
      </p>
      <header
        className={[styles.chrome, chromeShown ? '' : styles.chromeHidden]
          .filter(Boolean)
          .join(' ')}
      >
        <ButtonLink to={backTo} icon="back" aria-label="Back to library" className={styles.back} />
        <h1 className={styles.title}>{media.title}</h1>
        {resumedAt != null && (
          <p className={styles.resumed} aria-live="polite">
            <span>Resumed at {formatDuration(resumedAt)}</span>
            <Button onClick={startOver}>Start over</Button>
          </p>
        )}
      </header>
      <Controls
        shown={chromeShown}
        paused={paused}
        time={time}
        duration={duration}
        buffered={buffered}
        volume={volume}
        muted={muted}
        fullscreen={fullscreen}
        subtitlesOn={subtitle != null}
        menuOpen={menuOpen}
        settingsButton={settingsButton}
        onTogglePlay={togglePlay}
        onSeek={seek}
        onSkip={(seconds) => act({ type: 'seekBy', seconds })}
        onVolume={(next) => changeVolume(next)}
        onToggleMute={toggleMute}
        onToggleSubtitles={toggleSubtitles}
        onToggleMenu={() => (menuOpen ? closeMenu() : setMenuOpen(true))}
        onToggleFullscreen={toggleFullscreen}
      />
      {menuOpen && (
        <SettingsMenu
          menuRef={menu}
          tracks={tracks}
          tracksFailed={tracksFailed}
          audio={audio}
          subtitleId={subtitle?.id ?? null}
          subtitleStatus={subtitleStatus}
          rate={rate}
          mode={mode}
          onPickAudio={onPickAudio}
          onPickSubtitle={onPickSubtitle}
          onPickRate={changeRate}
          onClose={closeMenu}
        />
      )}
      {helpOpen && <ShortcutsDialog onClose={() => setHelpOpen(false)} />}
    </div>
  )
}
