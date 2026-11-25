import { classNames } from '@raven/ui/headless'
import type { ReactNode } from 'react'
import styles from '@/shell/Page/Page.module.scss'

type PageProps = {
  /** How the page lays out what it holds, when it is more than a column with the page's gap. */
  className?: string
  children: ReactNode
}

/**
 * A page's `main`: its content inside the narrow layout's gutter or the wide one's margins, as
 * the apps' `usePageInsets` pads theirs. The shell's bars take their own room under it, so a
 * page never clears them itself. It sets `--page-gutter`, which a `Shelf` runs out through, and
 * `--page-pad-end`, the room under its content, which the artists' A to Z rail stops short of.
 */
export function Page({ className, children }: PageProps) {
  return <main className={classNames([styles.page, className])}>{children}</main>
}
