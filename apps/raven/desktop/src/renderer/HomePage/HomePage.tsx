import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '@raven/ui'
import { isInProgress, useDownloads } from '@/renderer/desktop/downloadsApi'
import { watchedLabel } from '@/renderer/desktop/watched'
import styles from '@/renderer/HomePage/HomePage.module.scss'
import { RECENTS_KEY, useOpenReply } from '@/renderer/Shell/openReply'
import { useDesktop } from '@/renderer/stores/desktop'
import { useDragging } from '@/renderer/stores/dragging'
import { DESKTOP_REPLIES, DESKTOP_REQUESTS, type RecentView } from '@/shared/protocol'

/** Downloads' button, with the count of what is still queued or downloading. */
const DownloadsButton = () => {
  const navigate = useNavigate()
  const downloads = useDownloads()
  const count = (downloads.data?.downloads ?? []).filter(isInProgress).length
  return (
    <span className={styles.downloads}>
      <Button
        icon="download"
        aria-label={count === 0 ? 'Downloads' : `Downloads, ${count} in progress`}
        onClick={() => void navigate('/downloads')}
      />
      {/* The button's name says the count, so the badge is for the eye only. */}
      {count > 0 && (
        <span className={styles.badge} aria-hidden="true">
          {count}
        </span>
      )}
    </span>
  )
}

export const HomePage = () => {
  const { client } = useDesktop()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const openReply = useOpenReply()
  const isDragging = useDragging((state) => state.isDragging)
  const title = useRef<HTMLHeadingElement>(null)

  useEffect(() => {
    if (title.current !== null) title.current.focus()
  }, [])

  const recents = useQuery({
    queryKey: RECENTS_KEY,
    queryFn: async (): Promise<RecentView[]> => {
      const reply = await client.request({ type: DESKTOP_REQUESTS.listRecents })
      if (reply.type === DESKTOP_REPLIES.recents) return reply.recents
      if (reply.type === DESKTOP_REPLIES.refused) throw new Error(reply.message)
      throw new Error('raven player could not list your recent videos.')
    },
  })

  const choose = async () => openReply(await client.request({ type: DESKTOP_REQUESTS.openDialog }))
  const open = async (recent: RecentView) =>
    openReply(
      await client.request({ type: DESKTOP_REQUESTS.openRecent, recentId: recent.recentId }),
    )
  const remove = async (recent: RecentView) => {
    openReply(
      await client.request({ type: DESKTOP_REQUESTS.removeRecent, recentId: recent.recentId }),
    )
    await queryClient.invalidateQueries({ queryKey: RECENTS_KEY })
  }

  return (
    <main className={styles.home} aria-labelledby="home-title">
      <header className={styles.bar}>
        <h1 id="home-title" tabIndex={-1} ref={title}>
          raven player
        </h1>
        <DownloadsButton />
        <Button icon="settings" aria-label="Settings" onClick={() => void navigate('/settings')} />
      </header>
      <section className={styles.open} aria-labelledby="open-title">
        <h2 id="open-title">Open a video</h2>
        <p>Drop a video anywhere in this window, or choose one.</p>
        <Button tone="primary" icon="file-play" onClick={() => void choose()}>
          Choose a video
        </Button>
      </section>
      {isDragging && <p className={styles.drop}>Drop to play</p>}
      <section className={styles.recents} aria-labelledby="recents-title">
        <h2 id="recents-title">Recent</h2>
        {recents.isError && <p role="alert">{recents.error.message}</p>}
        {recents.data !== undefined && recents.data.length === 0 && <p>Nothing opened yet.</p>}
        {recents.data !== undefined && recents.data.length > 0 && (
          <ul className={styles.list}>
            {recents.data.map((recent) => (
              <li key={recent.recentId} className={styles.recent}>
                <button type="button" className={styles.play} onClick={() => void open(recent)}>
                  <span className={styles.name}>{recent.label}</span>
                  <span className={styles.from}>{recent.from}</span>
                  <progress
                    className={styles.watched}
                    max={1}
                    value={recent.watched ?? 0}
                    aria-label={watchedLabel(recent.watched)}
                  />
                </button>
                <Button
                  icon="close"
                  aria-label="Remove from recents"
                  onClick={() => void remove(recent)}
                />
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  )
}
