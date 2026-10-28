import { DESKTOP_REPLIES, DESKTOP_REQUESTS, type RecentView } from '@raven/core'
import { Button, useToasts } from '@raven/ui'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useId } from 'react'
import { refusalText } from '@/desktop/client'
import { handled } from '@/desktop/handled'
import { useOpenReply } from '@/desktop/openReply'
import { DESKTOP_QUERY_KEYS } from '@/desktop/queryKeys'
import { watchedLabel } from '@/desktop/watched'
import { useComputerName, useDesktop } from '@/stores/desktop'
import { useDragging } from '@/stores/dragging'
import styles from '@/desktop/LocalPage/LocalPage.module.scss'

const NO_RECENTS = 'Raven could not list your recent videos.'

/** The videos opened from this computer lately, newest first. */
const useRecents = () => {
  const { client } = useDesktop()
  return useQuery({
    queryKey: DESKTOP_QUERY_KEYS.recents,
    queryFn: async (): Promise<RecentView[]> => {
      const reply = await client.request({ type: DESKTOP_REQUESTS.listRecents })
      if (reply.type === DESKTOP_REPLIES.recents) return reply.recents
      throw new Error(refusalText({ reply, fallback: NO_RECENTS }))
    },
    retry: false,
  })
}

/**
 * On this Mac (On this PC on Windows): a video file from this computer, chosen or dropped anywhere on the window, plays
 * in Raven, and the ones opened lately wait here with how far they were watched.
 */
export const LocalPage = () => {
  const { client } = useDesktop()
  const computer = useComputerName()
  const queryClient = useQueryClient()
  const openReply = useOpenReply()
  const showNotice = useToasts((state) => state.show)
  const isDragging = useDragging((state) => state.isDragging)
  const recents = useRecents()
  const ids = { title: useId(), open: useId(), recents: useId() }

  const readAgain = () => queryClient.invalidateQueries({ queryKey: DESKTOP_QUERY_KEYS.recents })

  const choose = async () => openReply(await client.request({ type: DESKTOP_REQUESTS.openDialog }))

  const open = async (recent: RecentView) =>
    openReply(
      await client.request({ type: DESKTOP_REQUESTS.openRecent, recentId: recent.recentId }),
    )

  const remove = async (recent: RecentView) => {
    openReply(
      await client.request({ type: DESKTOP_REQUESTS.removeRecent, recentId: recent.recentId }),
    )
    await readAgain()
  }

  const clear = async () => {
    const reply = await client.request({ type: DESKTOP_REQUESTS.clearRecents })
    if (reply.type === DESKTOP_REPLIES.refused) return showNotice(reply.message)
    await readAgain()
    showNotice('Recents cleared.')
  }

  const list = recents.data ?? null

  return (
    <section className={styles.page} aria-labelledby={ids.title}>
      <header className={styles.header}>
        <h1 id={ids.title}>{`On this ${computer}`}</h1>
        <p className={styles.hint}>Play a video file from this computer in Raven.</p>
      </header>
      <section
        className={isDragging ? `${styles.drop} ${styles.dragging}` : styles.drop}
        aria-labelledby={ids.open}
      >
        <h2 id={ids.open} className={styles.dropTitle}>
          {isDragging ? 'Drop to play' : 'Drop a video anywhere in this window'}
        </h2>
        <Button tone="primary" icon="file-play" onClick={() => handled(choose())}>
          Choose a video
        </Button>
      </section>
      <section className={styles.recents} aria-labelledby={ids.recents}>
        <header className={styles.recentsHead}>
          <h2 id={ids.recents} className={styles.recentsTitle}>
            Recent
          </h2>
          {list !== null && list.length > 0 && (
            <Button
              tone="ghost"
              icon="trash"
              className={styles.clear}
              onClick={() => handled(clear())}
            >
              Clear recents
            </Button>
          )}
        </header>
        {recents.isError && <p role="alert">{recents.error.message}</p>}
        {list !== null && list.length === 0 && <p className={styles.hint}>Nothing opened yet.</p>}
        {list !== null && list.length > 0 && (
          <ul className={styles.list}>
            {list.map((recent) => (
              <li key={recent.recentId} className={styles.recent}>
                <button type="button" className={styles.play} onClick={() => handled(open(recent))}>
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
                  tone="ghost"
                  icon="close"
                  aria-label={`Remove ${recent.label} from recents`}
                  onClick={() => handled(remove(recent))}
                />
              </li>
            ))}
          </ul>
        )}
      </section>
    </section>
  )
}
