import { Icon, type IconName } from '@raven/ui'
import type { ComponentPropsWithRef } from 'react'
import styles from '@/components/PageTitle/PageTitle.module.scss'

type PageTitleProps = ComponentPropsWithRef<'h1'> & { icon: IconName }

/**
 * A side menu page's heading, led by the icon its row in the menu wears, so
 * the page and the row it was opened from read as one. The icon is drawn in
 * ems, so it follows whatever size the page sets its heading in, and the
 * heading's own class still places it.
 */
export const PageTitle = ({ icon, children, ...heading }: PageTitleProps) => (
  <h1 {...heading}>
    <span className={styles.line}>
      <span className={styles.icon}>
        <Icon name={icon} size="0.6em" />
      </span>
      <span className={styles.name}>{children}</span>
    </span>
  </h1>
)
