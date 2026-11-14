import { NOTICE_LIST_COPY } from '@/components/NoticeList/copy'
import styles from '@/components/NoticeList/NoticeList.module.scss'
import { RichText } from '@/components/RichText/RichText'
import type { Notice } from '@/lib/events'

type NoticeListProps = { notices: Notice[] }

/** What a turn or a press sent outside the reply: notes for the admin, DMs. */
export const NoticeList = ({ notices }: NoticeListProps) => (
  <ul className={styles.notices} aria-label={NOTICE_LIST_COPY.label}>
    {notices.map((notice, index) => (
      <li key={`${notice.kind}-${index}`} className={styles.notice}>
        <p className={styles.heading}>
          {NOTICE_LIST_COPY.headings[notice.kind]}
          {notice.to && NOTICE_LIST_COPY.to(notice.to)}
        </p>
        <p className={styles.text}>
          <RichText text={notice.text} />
        </p>
      </li>
    ))}
  </ul>
)
