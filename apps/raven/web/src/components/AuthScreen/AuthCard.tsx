import type { FormEvent, ReactNode } from 'react'
import { Button } from '@raven/ui'
import { Logo } from '@/components/Logo/Logo'
import styles from '@/components/AuthScreen/AuthScreen.module.scss'

export const Brand = () => (
  <span className={styles.brand}>
    <Logo />
  </span>
)

type LeadProps = { children: ReactNode }

/** A line under a card's title. */
export const Lead = ({ children }: LeadProps) => <p className={styles.lead}>{children}</p>

type StatusProps = { children: ReactNode }

/** A line under a card's title that a screen reader reads out as it changes. */
export const Status = ({ children }: StatusProps) => (
  <output className={styles.lead}>{children}</output>
)

type NoteProps = { children: ReactNode }

/** A quieter line: a note, or the links to the other auth pages. */
export const Note = ({ children }: NoteProps) => <p className={styles.note}>{children}</p>

type AddressProps = { children: string }

/** An email address in the text, set apart so the visitor can check it. */
export const Address = ({ children }: AddressProps) => (
  <span className={styles.address}>{children}</span>
)

type FieldsProps = { children: ReactNode }

/** A form's fields, one above the other. */
export const Fields = ({ children }: FieldsProps) => <div className={styles.fields}>{children}</div>

type SubmitButtonProps = {
  isDisabled: boolean
  children: string
}

export const SubmitButton = ({ isDisabled, children }: SubmitButtonProps) => (
  <Button type="submit" tone="primary" className={styles.submit} disabled={isDisabled}>
    {children}
  </Button>
)

type CardProps = { title: string; lead: ReactNode; children?: ReactNode }

type IntroProps = Omit<CardProps, 'children'>

const Intro = ({ title, lead }: IntroProps) => (
  <>
    <Brand />
    <header className={styles.welcome}>
      <h1 className={styles.title}>{title}</h1>
      {lead}
    </header>
  </>
)

type AuthCardProps = CardProps

/** What an auth page shows beside the poster wall: the brand, its title and the lines under it, then the rest. */
export const AuthCard = ({ title, lead, children }: AuthCardProps) => (
  <section className={styles.card}>
    <Intro title={title} lead={lead} />
    {children}
  </section>
)

type AuthFormProps = CardProps & { onSubmit: (event: FormEvent) => void }

/** An `AuthCard` that is a form. */
export const AuthForm = ({ title, lead, onSubmit, children }: AuthFormProps) => (
  <form className={styles.card} onSubmit={onSubmit}>
    <Intro title={title} lead={lead} />
    {children}
  </form>
)
