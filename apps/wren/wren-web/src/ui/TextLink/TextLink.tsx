import { type Press, Pressable } from '@/ui/Pressable/Pressable'
import styles from '@/ui/TextLink/TextLink.module.scss'

/** A link in words: what it says, what it is called aloud when that says more, and what it does. */
export type TextAction = Press & {
  label: string
  spoken?: string
}

/** A red word that acts: See all, Clear, Manage. It answers a 44 tall press. */
export function TextLink({ label, spoken, ...press }: TextAction) {
  return (
    <Pressable {...press} className={styles.link} label={spoken ?? label}>
      {label}
    </Pressable>
  )
}
