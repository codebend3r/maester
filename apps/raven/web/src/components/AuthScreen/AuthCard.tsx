import type { FormEvent, ReactNode } from 'react'
import { Button } from '@raven/ui'
import { Logo } from '@/components/Logo/Logo'
import styles from '@/components/AuthScreen/AuthScreen.module.scss'

export const Brand = () => (
  <span className={styles.brand}>
    <Logo />
  </span>
)

/** A line under a card's title. */
export const Lead = ({ children }: { children: ReactNode }) => (
  <p className={styles.lead}>{children}</p>
)

/** A line under a card's title that a screen reader reads out as it changes. */
export const Status = ({ children }: { children: ReactNode }) => (
  <output className={styles.lead}>{children}</output>
)

/** A quieter line: a note, or the links to the other auth pages. */
export const Note = ({ children }: { children: ReactNode }) => (
  <p className={styles.note}>{children}</p>
)

/** An email address in the text, set apart so the visitor can check it. */
export const Address = ({ children }: { children: string }) => (
  <span className={styles.address}>{children}</span>
)

/** A form's fields, one above the other. */
export const Fields = ({ children }: { children: ReactNode }) => (
  <div className={styles.fields}>{children}</div>
)

export const SubmitButton = ({
  isDisabled,
  children,
}: {
  isDisabled: boolean
  children: string
}) => (
  <Button type="submit" tone="primary" className={styles.submit} disabled={isDisabled}>
    {children}
  </Button>
)

type CardProps = { title: string; lead: ReactNode; children?: ReactNode }

const Intro = ({ title, lead }: Omit<CardProps, 'children'>) => (
  <>
    <Brand />
    <header className={styles.welcome}>
      <h1 className={styles.title}>{title}</h1>
      {lead}
    </header>
  </>
)

/** What an auth page shows beside the poster wall: the brand, its title and the lines under it, then the rest. */
export const AuthCard = ({ title, lead, children }: CardProps) => (
  <section className={styles.card}>
    <Intro title={title} lead={lead} />
    {children}
  </section>
)

/** An `AuthCard` that is a form. */
export const AuthForm = ({
  title,
  lead,
  onSubmit,
  children,
}: CardProps & { onSubmit: (event: FormEvent) => void }) => (
  <form className={styles.card} onSubmit={onSubmit}>
    <Intro title={title} lead={lead} />
    {children}
  </form>
)
