import { DESKTOP_REPLIES, DESKTOP_REQUESTS, type RecentView } from '@raven/core'
import { Button, useToasts } from '@raven/ui'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { type ComponentType, useId } from 'react'
import { refusalText } from '@/desktop/client'
import { handled } from '@/desktop/handled'
import { useOpenReply } from '@/desktop/openReply'
import { LOCAL_PAGE_COPY } from '@/desktop/LocalPage/copy'
import { DESKTOP_QUERY_KEYS } from '@/desktop/queryKeys'
import { watchedLabel } from '@/desktop/watched'
import { useComputerName, useDesktop } from '@/stores/desktop'
import { useDragging } from '@/stores/dragging'
import styles from '@/desktop/LocalPage/LocalPage.module.scss'
import { PageTitle } from '@/components/PageTitle/PageTitle'

/** The videos opened from this computer lately, newest first. */
const useRecents = () => {
  const { client } = useDesktop()
  return useQuery({
    queryKey: DESKTOP_QUERY_KEYS.recents,
    queryFn: async (): Promise<RecentView[]> => {
      const reply = await client.request({ type: DESKTOP_REQUESTS.listRecents })
      if (reply.type === DESKTOP_REPLIES.recents) return reply.recents
      throw new Error(refusalText({ reply, fallback: LOCAL_PAGE_COPY.noRecents }))
    },
    retry: false,
  })
}

/** What the list of recents holds: nothing read yet, nothing opened, or videos. */
const RECENTS_STATES = { unread: 'unread', empty: 'empty', listed: 'listed' } as const

type RecentsState = (typeof RECENTS_STATES)[keyof typeof RECENTS_STATES]

const recentsStateOf = (list: RecentView[] | null): RecentsState => {
  if (list === null) return RECENTS_STATES.unread
  return list.length === 0 ? RECENTS_STATES.empty : RECENTS_STATES.listed
}

type RecentsViewProps = {
  list: RecentView[]
  onOpen: (recent: RecentView) => void
  onRemove: (recent: RecentView) => void
}

const UnreadRecents = () => null

const NoRecents = () => <p className={styles.hint}>{LOCAL_PAGE_COPY.nothingOpened}</p>

type RecentsListProps = RecentsViewProps

const RecentsList = ({ list, onOpen, onRemove }: RecentsListProps) => (
  <ul className={styles.list}>
    {list.map((recent) => (
      <li key={recent.recentId} className={styles.recent}>
        <button type="button" className={styles.play} onClick={() => onOpen(recent)}>
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
          aria-label={LOCAL_PAGE_COPY.removeRecent(recent.label)}
          onClick={() => onRemove(recent)}
        />
      </li>
    ))}
  </ul>
)

const RECENTS_VIEWS = {
  [RECENTS_STATES.unread]: UnreadRecents,
  [RECENTS_STATES.empty]: NoRecents,
  [RECENTS_STATES.listed]: RecentsList,
} as const satisfies Record<RecentsState, ComponentType<RecentsViewProps>>

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
    showNotice(LOCAL_PAGE_COPY.recentsCleared)
  }

  const list = recents.data ?? null
  const Recents = RECENTS_VIEWS[recentsStateOf(list)]

  return (
    <section className={styles.page} aria-labelledby={ids.title}>
      <header className={styles.header}>
        <PageTitle id={ids.title} icon="file-play">
          {LOCAL_PAGE_COPY.title(computer)}
        </PageTitle>
        <p className={styles.hint}>{LOCAL_PAGE_COPY.hint}</p>
      </header>
      <section
        className={isDragging ? `${styles.drop} ${styles.dragging}` : styles.drop}
        aria-labelledby={ids.open}
      >
        <h2 id={ids.open} className={styles.dropTitle}>
          {isDragging ? LOCAL_PAGE_COPY.dropToPlay : LOCAL_PAGE_COPY.dropAnywhere}
        </h2>
        <Button tone="primary" icon="file-play" onClick={() => handled(choose())}>
          {LOCAL_PAGE_COPY.chooseVideo}
        </Button>
      </section>
      <section className={styles.recents} aria-labelledby={ids.recents}>
        <header className={styles.recentsHead}>
          <h2 id={ids.recents} className={styles.recentsTitle}>
            {LOCAL_PAGE_COPY.recent}
          </h2>
          {list !== null && list.length > 0 && (
            <Button
              tone="ghost"
              icon="trash"
              className={styles.clear}
              onClick={() => handled(clear())}
            >
              {LOCAL_PAGE_COPY.clearRecents}
            </Button>
          )}
        </header>
        {recents.isError && <p role="alert">{recents.error.message}</p>}
        <Recents
          list={list ?? []}
          onOpen={(recent) => handled(open(recent))}
          onRemove={(recent) => handled(remove(recent))}
        />
      </section>
    </section>
  )
}
