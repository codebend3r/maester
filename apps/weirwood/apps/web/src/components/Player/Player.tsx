import { useQueryClient } from '@tanstack/react-query'
import { type MediaItem, checkDirectPlay, formatDuration } from '@weirwood/core'
import { type SyntheticEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, ButtonLink } from '@/components/Button/Button'
import { api } from '@/lib/api'
import { browserCanPlay } from '@/lib/canPlay'
import { usePlayerPrefs } from '@/stores/playerPrefs'
import styles from './Player.module.scss'

/** How long the top bar and cursor linger after the last mouse move or key press. */
const IDLE_MS = 2500
/** Progress is saved this often while playing, plus on pause and on leaving. */
const SAVE_EVERY_S = 10
const SEEK_STEP_S = 10

const failureMessage = (error: MediaError | null): string => {
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

/**
 * What stands in for the video when the browser cannot play the file as it
 * is. Nothing is converted on the server, so the way forward is another
 * browser or a desktop player pointed at the same URL.
 */
const Unplayable = ({
  media,
  problems,
  backTo,
  onTryAnyway,
}: {
  media: MediaItem
  problems: string[]
  backTo: string
  onTryAnyway: (() => void) | null
}) => {
  const [copied, setCopied] = useState<string | null>(null)
  const thumbnail = api.thumbnailUrl(media)

  const copyLink = () => {
    const link = new URL(api.fileUrl(media.id), window.location.origin).href
    navigator.clipboard.writeText(link).then(
      () => setCopied('Link copied. Paste it into VLC or IINA to play it there.'),
      () => setCopied(`Copy this link: ${link}`),
    )
  }

  return (
    <section className={styles.unplayable} aria-labelledby="unplayable-title">
      {!!thumbnail && <img className={styles.backdrop} src={thumbnail} alt="" aria-hidden="true" />}
      <div className={styles.panel}>
        <ButtonLink to={backTo} icon="back" className={styles.panelBack}>
          Library
        </ButtonLink>
        <h1 id="unplayable-title" className={styles.panelTitle}>
          {media.title}
        </h1>
        <p>This video can't play in this browser.</p>
        <ul className={styles.problems}>
          {problems.map((problem) => (
            <li key={problem}>{problem}</li>
          ))}
        </ul>
        <p className={styles.hint}>
          The file is served untouched, so a player that handles every format, like VLC or IINA, can
          open the same link.
        </p>
        <div className={styles.panelActions}>
          {!!onTryAnyway && (
            <Button tone="primary" onClick={onTryAnyway}>
              Try playing anyway
            </Button>
          )}
          <Button icon="copy" onClick={copyLink}>
            Copy file link
          </Button>
        </div>
        <p className={styles.hint} aria-live="polite">
          {copied}
        </p>
      </div>
    </section>
  )
}

/** The video itself: full screen, focused on arrival, with its own keyboard shortcuts. */
const Stage = ({
  media,
  backTo,
  onFailure,
}: {
  media: MediaItem
  backTo: string
  onFailure: (message: string) => void
}) => {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const stage = useRef<HTMLDivElement>(null)
  const video = useRef<HTMLVideoElement>(null)
  const lastSaved = useRef(media.position)
  // Nothing is saved until frames actually play: a video that never got
  // going still fires `pause` at 0:00 on the way out, and saving that would
  // wipe the place the viewer really stopped.
  const started = useRef(false)
  const idleTimer = useRef<number | null>(null)
  const { volume, muted, setVolume } = usePlayerPrefs()
  const [paused, setPaused] = useState(true)
  const [active, setActive] = useState(true)
  const [resumedAt, setResumedAt] = useState<number | null>(null)

  const save = useCallback(
    (position: number) => {
      if (!started.current || !Number.isFinite(position)) return
      lastSaved.current = position
      api.saveProgress({ id: media.id, position }).catch(() => undefined)
    },
    [media.id],
  )

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
    return () => {
      document.title = title
      if (idleTimer.current != null) window.clearTimeout(idleTimer.current)
      if (element && element.currentTime > 0) save(element.currentTime)
      // Resume lines on the library grid should reflect where this stopped.
      void queryClient.invalidateQueries({ queryKey: ['libraries', media.libraryId, 'media'] })
    }
  }, [media.title, media.libraryId, queryClient, save, scheduleIdle])

  // Closing the tab mid-film still records the position.
  useEffect(() => {
    const onHide = () => {
      if (video.current) save(video.current.currentTime)
    }
    window.addEventListener('pagehide', onHide)
    return () => window.removeEventListener('pagehide', onHide)
  }, [save])

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen()
    else void stage.current?.requestFullscreen?.()
  }, [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const element = video.current
      if (!element || event.metaKey || event.ctrlKey || event.altKey) return
      if (isTypingTarget(event.target)) return
      // A focused <video> already handles space and arrows through its native
      // controls, and a focused button handles space itself; doing it here
      // too would toggle twice.
      const native = event.target === element
      const control = isControlTarget(event.target)
      const act = (run: () => void) => {
        event.preventDefault()
        run()
        wake()
      }
      const seek = (by: number) => {
        element.currentTime = Math.max(
          0,
          Math.min(element.duration || Infinity, element.currentTime + by),
        )
      }
      const toggle = () => {
        if (element.paused) void element.play()
        else element.pause()
      }

      if (event.key === 'k' || (event.key === ' ' && !native && !control)) return act(toggle)
      if (event.key === 'j' || (event.key === 'ArrowLeft' && !native))
        return act(() => seek(-SEEK_STEP_S))
      if (event.key === 'l' || (event.key === 'ArrowRight' && !native))
        return act(() => seek(SEEK_STEP_S))
      if (event.key === 'f') return act(toggleFullscreen)
      if (event.key === 'm') return act(() => (element.muted = !element.muted))
      if (event.key === 'Escape' && !document.fullscreenElement) return act(() => navigate(backTo))
      wake()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [backTo, navigate, toggleFullscreen, wake])

  const onLoadedMetadata = (event: SyntheticEvent<HTMLVideoElement>) => {
    const element = event.currentTarget
    element.volume = volume
    element.muted = muted
    const resumable = media.position > 0 && media.position < (element.duration || Infinity) - 10
    if (resumable) {
      element.currentTime = media.position
      setResumedAt(media.position)
      window.setTimeout(() => setResumedAt(null), 6000)
    }
  }

  const onTimeUpdate = (event: SyntheticEvent<HTMLVideoElement>) => {
    const { currentTime } = event.currentTarget
    if (Math.abs(currentTime - lastSaved.current) >= SAVE_EVERY_S) save(currentTime)
  }

  const startOver = () => {
    if (!video.current) return
    video.current.currentTime = 0
    void video.current.play()
    setResumedAt(null)
    video.current.focus()
  }

  const chromeShown = paused || active || resumedAt != null

  return (
    <div
      ref={stage}
      className={[styles.stage, chromeShown ? '' : styles.idle].filter(Boolean).join(' ')}
      onPointerMove={wake}
      onPointerDown={wake}
    >
      {/* No caption tracks yet: subtitles live inside the files and would need
          extracting to WebVTT first. */}
      {/* oxlint-disable-next-line jsx-a11y/media-has-caption */}
      <video
        ref={video}
        className={styles.video}
        src={api.fileUrl(media.id)}
        poster={api.thumbnailUrl(media) ?? undefined}
        controls
        autoPlay
        playsInline
        preload="auto"
        aria-label={media.title}
        onLoadedMetadata={onLoadedMetadata}
        onTimeUpdate={onTimeUpdate}
        onPlay={() => setPaused(false)}
        onPlaying={() => {
          started.current = true
        }}
        onPause={(event) => {
          setPaused(true)
          save(event.currentTarget.currentTime)
        }}
        onEnded={(event) => save(event.currentTarget.duration)}
        onVolumeChange={(event) =>
          setVolume({ volume: event.currentTarget.volume, muted: event.currentTarget.muted })
        }
        onError={(event) => onFailure(failureMessage(event.currentTarget.error))}
      />
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
    </div>
  )
}

/**
 * Direct play only: the browser gets the original file and nothing is
 * transcoded. Before loading anything, the file is checked against what this
 * browser says it can decode; if it cannot, the viewer is told why instead
 * of watching a spinner.
 */
export const Player = ({ media, backTo }: { media: MediaItem; backTo: string }) => {
  const check = useMemo(() => checkDirectPlay({ media, canPlay: browserCanPlay }), [media])
  const [forced, setForced] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)

  if (failure != null || (!check.playable && !forced)) {
    return (
      <Unplayable
        media={media}
        backTo={backTo}
        problems={failure != null ? [failure, ...check.problems] : check.problems}
        onTryAnyway={failure == null ? () => setForced(true) : null}
      />
    )
  }
  return <Stage media={media} backTo={backTo} onFailure={setFailure} />
}
