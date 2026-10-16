import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '@raven/ui'
import { useDesktop } from '@/renderer/desktop/DesktopContext'
import styles from '@/renderer/SettingsPage/SettingsPage.module.scss'
import { RECENTS_KEY } from '@/renderer/Shell/Shell'

export const SettingsPage = () => {
  const { client } = useDesktop()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const title = useRef<HTMLHeadingElement>(null)
  const [isCleared, setIsCleared] = useState(false)

  useEffect(() => {
    if (title.current !== null) title.current.focus()
  }, [])

  const clear = async () => {
    const reply = await client.request({ type: 'clearRecents' })
    if (reply.type === 'refused') return
    await queryClient.invalidateQueries({ queryKey: RECENTS_KEY })
    setIsCleared(true)
  }

  return (
    <main className={styles.settings} aria-labelledby="settings-title">
      <header className={styles.bar}>
        <Button icon="back" onClick={() => void navigate('/')}>
          Back
        </Button>
        <h1 id="settings-title" tabIndex={-1} ref={title}>
          Settings
        </h1>
      </header>
      <section className={styles.section} aria-labelledby="recents-title">
        <h2 id="recents-title">Recents</h2>
        <p>raven player remembers the videos you open and where you stopped.</p>
        <Button tone="danger" onClick={() => void clear()}>
          Clear recents
        </Button>
        {isCleared && <output>Recents cleared.</output>}
      </section>
    </main>
  )
}
