import { Button } from '@raven/ui'
import { useDesktop } from '@/renderer/desktop/DesktopContext'
import { useNotice } from '@/renderer/Shell/openReply'
import styles from '@/renderer/Shell/UpdateNotice.module.scss'
import { UNOPENED } from '@/renderer/Shell/updateState'

/**
 * The quiet word that a newer release is out (Ruling 19). The page never holds the release
 * link: See what's new asks main, which opens the page it built from the tag.
 */
export const UpdateNotice = ({
  version,
  onClose,
  className,
}: {
  version: string
  onClose: () => void
  className?: string
}) => {
  const { client } = useDesktop()
  const showNotice = useNotice()

  const open = async () => {
    const reply = await client.request({ type: 'openRelease' }).catch(() => null)
    onClose()
    if (reply !== null && reply.type === 'done') return
    showNotice(reply !== null && reply.type === 'refused' ? reply.message : UNOPENED)
  }

  return (
    <aside className={`${styles.notice} ${className ?? ''}`} aria-label="Update">
      <p className={styles.text}>raven player {version} is out.</p>
      <div className={styles.actions}>
        <Button tone="primary" onClick={() => void open()}>
          See what's new
        </Button>
        <Button onClick={onClose}>Dismiss</Button>
      </div>
    </aside>
  )
}
