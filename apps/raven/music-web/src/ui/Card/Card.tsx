import { classNames } from '@raven/ui/headless'
import type { ReactNode } from 'react'
import styles from '@/ui/Card/Card.module.scss'

type CardProps = {
  /** How the card lays out what it holds: its padding, gap and columns. */
  className?: string
  children: ReactNode
}

/** A raised surface on the ground: a quiet fill in a hairline ring, rounded. */
export function Card({ className, children }: CardProps) {
  return <div className={classNames([styles.card, className])}>{children}</div>
}
