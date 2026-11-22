import { classNames } from '@raven/ui/headless'
import { SIGN_IN_COPY } from '@raven/wren'
import type { ComponentType, ReactNode } from 'react'
import { WrenLockup, WrenMark } from '@/components/WrenLockup/WrenLockup'
import { useServerName } from '@/stores/wrenPrefs'
import { FORM_FACTORS, type FormFactor } from '@/theme/formFactor'
import { COLORS, SIZES } from '@/theme/tokens'
import { StatusChip } from '@/ui/StatusChip/StatusChip'
import styles from '@/screens/SignIn/SignInFrame.module.scss'

type SignInFrameProps = {
  /** Whether the last try could not reach raven, which the server's chip then says. */
  isServerDown: boolean
  children: ReactNode
}

type SignInTitlesProps = {
  title: string
  note: string
  /** What the frame adds to the block: the room the wide layout leaves under it. */
  className?: string
}

/** The screen's heading over the line that says what to sign in with. */
function SignInTitles({ title, note, className }: SignInTitlesProps) {
  return (
    <div className={classNames([styles.titles, className])}>
      <h1 className={styles.title}>{title}</h1>
      <p className={styles.note}>{note}</p>
    </div>
  )
}

/** P01: the mark, the welcome and the form in one column, the server and Maester at its foot. */
function PhoneFrame({ isServerDown, children }: SignInFrameProps) {
  const name = useServerName()
  return (
    <main className={styles.phone}>
      <header className={styles.head}>
        <WrenMark size={SIZES.signInMark} />
        <SignInTitles note={SIGN_IN_COPY.note} title={SIGN_IN_COPY.welcome} />
      </header>
      <div className={styles.body}>{children}</div>
      <footer className={styles.foot}>
        <StatusChip isConnected={!isServerDown} name={name} />
        <p className={styles.family}>{SIGN_IN_COPY.family}</p>
      </footer>
    </main>
  )
}

/*
 * T01: the brand's Night half, with the lockup, the large mark and the tagline, beside the
 * themed form, which grows no wider than 400.
 */
function WideFrame({ isServerDown, children }: SignInFrameProps) {
  const name = useServerName()
  return (
    <main className={styles.split}>
      <section className={styles.brand}>
        <span className={styles.lockup}>
          <WrenLockup ink={COLORS.bark} size={SIZES.signInLockup} />
        </span>
        <span className={styles.hero}>
          <WrenMark ink={COLORS.bark} size={SIZES.signInHeroMark} />
        </span>
        <p className={styles.tagline}>{SIGN_IN_COPY.tagline}</p>
      </section>
      <section className={styles.side}>
        <div className={styles.column}>
          <SignInTitles
            className={styles.spaced}
            note={SIGN_IN_COPY.tabletNote}
            title={SIGN_IN_COPY.title}
          />
          {children}
          <span className={styles.server}>
            <StatusChip isConnected={!isServerDown} name={name} />
          </span>
        </div>
      </section>
    </main>
  )
}

/** The frame each layout draws the form in. */
export const SIGN_IN_FRAMES = {
  [FORM_FACTORS.phone]: PhoneFrame,
  [FORM_FACTORS.tablet]: WideFrame,
} as const satisfies Record<FormFactor, ComponentType<SignInFrameProps>>
