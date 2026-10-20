import type { ReactNode } from 'react'
import styles from '@/renderer/Account/Refusal.module.scss'

/** Main's sentence for why an account request was refused, said as soon as it shows. */
export const Refusal = ({
  id,
  className,
  children,
}: {
  /** For a field that names the refusal in its `aria-describedby`. */
  id?: string
  /** Where the container places it. */
  className?: string
  children: ReactNode
}) => (
  <p
    id={id}
    className={className === undefined ? styles.refusal : `${styles.refusal} ${className}`}
    role="alert"
  >
    {children}
  </p>
)
