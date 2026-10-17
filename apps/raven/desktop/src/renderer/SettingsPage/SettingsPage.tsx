import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '@raven/ui'
import { useDesktop } from '@/renderer/desktop/DesktopContext'
import { Downloads } from '@/renderer/SettingsPage/Downloads'
import { Servers } from '@/renderer/SettingsPage/Servers'
import styles from '@/renderer/SettingsPage/SettingsPage.module.scss'
import { ThisComputer } from '@/renderer/SettingsPage/ThisComputer'
import { Updates } from '@/renderer/SettingsPage/Updates'
import { RECENTS_KEY } from '@/renderer/Shell/openReply'

export const SettingsPage = () => {
  const { client } = useDesktop()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const title = useRef<HTMLHeadingElement>(null)
  const [status, setStatus] = useState('')

  useEffect(() => {
    if (title.current !== null) title.current.focus()
  }, [])

  const clear = async () => {
    // Emptied first: a live region announces a change, so the same text twice needs a gap.
    setStatus('')
    const reply = await client.request({ type: 'clearRecents' })
    if (reply.type === 'refused') {
      setStatus(reply.message)
      return
    }
    await queryClient.invalidateQueries({ queryKey: RECENTS_KEY })
    setStatus('Recents cleared.')
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
      <Servers className={styles.servers} />
      <Downloads className={styles.downloads} />
      <ThisComputer className={styles.computer} />
      <Updates className={styles.updates} />
      <section className={styles.section} aria-labelledby="recents-title">
        <h2 id="recents-title">Recents</h2>
        <p>raven player remembers the videos you open and where you stopped.</p>
        <Button tone="danger" onClick={() => void clear()}>
          Clear recents
        </Button>
        {/* Always mounted: a live region is announced when its text changes, not when it appears. */}
        <output>{status}</output>
      </section>
    </main>
  )
}
