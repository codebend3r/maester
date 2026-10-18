import { Button, BUTTON_TONES } from '@/components/Button/Button'
import styles from '@/components/NoticeList/NoticeList.module.scss'
import { RichText } from '@/components/RichText/RichText'
import { NOTICE_KINDS, type Notice, type NoticeKind } from '@/lib/events'
import { useChat } from '@/stores/chat'

const HEADINGS = {
  [NOTICE_KINDS.adminPost]: 'To the admin',
  [NOTICE_KINDS.approval]: 'Approval for the admin',
  [NOTICE_KINDS.announcement]: 'To every friend',
  [NOTICE_KINDS.directMessage]: 'Direct message',
} as const satisfies Record<NoticeKind, string>

/** What a turn or a press sent outside the reply: notes and approvals for the admin, DMs. */
export const NoticeList = ({ notices }: { notices: Notice[] }) => {
  const press = useChat((state) => state.press)
  const settled = useChat((state) => state.settled)
  const isBusy = useChat((state) => state.isBusy)
  return (
    <ul className={styles.notices} aria-label="Notices">
      {notices.map((notice, index) => (
        <li key={`${notice.kind}-${index}`} className={styles.notice}>
          <p className={styles.heading}>
            {HEADINGS[notice.kind]}
            {notice.to && ` to ${notice.to}`}
          </p>
          <p className={styles.text}>
            <RichText text={notice.text} />
          </p>
          {notice.pendingId != null && (
            <div className={styles.actions}>
              {[true, false].map((approve) => (
                <Button
                  key={String(approve)}
                  tone={approve ? BUTTON_TONES.primary : BUTTON_TONES.quiet}
                  disabled={isBusy || settled.includes(notice.pendingId ?? -1)}
                  onClick={() => {
                    if (notice.pendingId != null)
                      void press({ pendingId: notice.pendingId, approve })
                  }}
                >
                  {approve ? 'Approve' : 'Deny'}
                </Button>
              ))}
            </div>
          )}
        </li>
      ))}
    </ul>
  )
}
