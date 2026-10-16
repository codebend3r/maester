import { useQuery } from '@tanstack/react-query'
import { useEffect, useEffectEvent, useMemo, useRef } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { Button, Player, PlayerServicesProvider } from '@raven/ui'
import { useDesktop } from '@/renderer/desktop/DesktopContext'
import styles from '@/renderer/PlayPage/PlayPage.module.scss'
import { isPlayState, servicesFor } from '@/renderer/PlayPage/playerServices'
import { fileUrlFor, isOpaqueId, type LocalFile, type MenuPlayerAction } from '@/shared/protocol'

const NOT_OPENABLE = 'raven player can not open that video.'

const Refused = ({ message }: { message: string }) => {
  const navigate = useNavigate()
  const title = useRef<HTMLHeadingElement>(null)

  useEffect(() => {
    if (title.current !== null) title.current.focus()
  }, [])

  return (
    <main className={styles.refused} aria-labelledby="refused-title">
      <header className={styles.bar}>
        <Button icon="back" onClick={() => void navigate('/')}>
          Home
        </Button>
      </header>
      <section className={styles.message}>
        <h1 id="refused-title" tabIndex={-1} ref={title}>
          This video can't be opened
        </h1>
        <p>{message}</p>
      </section>
    </main>
  )
}

const Playing = ({ file }: { file: LocalFile }) => {
  const { client, menu } = useDesktop()
  const navigate = useNavigate()
  const services = useMemo(() => servicesFor({ file, client, menu }), [file, client, menu])

  const onMenu = useEffectEvent((action: MenuPlayerAction) => {
    if (action !== 'next' || services.title.next === null) return
    const { to, state } = services.title.next
    void navigate(to, { replace: true, state })
  })

  useEffect(() => menu.subscribe(onMenu), [menu])

  return (
    <PlayerServicesProvider services={services}>
      <Player engine={{ kind: 'html', source: { kind: 'file', url: fileUrlFor(file.fileId) } }} />
    </PlayerServicesProvider>
  )
}

const PlayPage = ({ fileId, queue }: { fileId: string; queue: string[] }) => {
  const { client } = useDesktop()
  const file = useQuery({
    queryKey: ['desktop', 'file', fileId, queue],
    queryFn: async (): Promise<LocalFile> => {
      const reply = await client.request({ type: 'describeFile', fileId, queue })
      if (reply.type === 'file') return reply.file
      if (reply.type === 'refused') throw new Error(reply.message)
      throw new Error(NOT_OPENABLE)
    },
    // Opening a file also records it as recent and reads its resume point:
    // asking again while it plays (focus, remount) would move both.
    staleTime: Infinity,
    // Coming back to a file later must read its resume point afresh.
    gcTime: 0,
    retry: false,
  })

  if (file.isPending)
    return <main className={styles.waiting} aria-busy="true" aria-label="Opening video" />
  if (file.isError) return <Refused message={file.error.message} />
  return <Playing file={file.data} />
}

/** Keyed by file, so a new file remounts the Player and its unmount saves the old position first. */
export const PlayRoute = () => {
  const { fileId } = useParams()
  const state: unknown = useLocation().state
  if (!isOpaqueId(fileId)) return <Refused message={NOT_OPENABLE} />
  const queue = isPlayState(state) ? state.queue : []
  return <PlayPage key={fileId} fileId={fileId} queue={queue} />
}
