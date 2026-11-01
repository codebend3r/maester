import type { UseQueryResult } from '@tanstack/react-query'
import { type ReactNode, useId } from 'react'
import type { IconName } from '@raven/ui'
import { Bone, Loading } from '@/components/Skeleton/Skeleton'
import { Titled } from '@/pages/SettingsPage/Titled'
import { SETTINGS_COPY } from '@/pages/SettingsPage/copy'
import styles from '@/pages/SettingsPage/SettingsPage.module.scss'

/** Every value a setting takes, with its words; a value added in `@raven/core` cannot go unlabelled. */
export type Choices<V extends string | number> = Record<V, { label: string; hint: string }>

type SettingProps<V extends string | number> = {
  label: string
  icon: IconName
  values: readonly V[]
  choices: Choices<V>
  value: V
  onChange: (value: V) => void
}

/** One setting as a group of radio cards, each with a line saying what it means; the chosen one is filled. */
export const Setting = <V extends string | number>({
  label,
  icon,
  values,
  choices,
  value,
  onChange,
}: SettingProps<V>) => {
  const name = useId()
  return (
    <fieldset className={styles.setting}>
      <legend className={styles.legend}>
        <Titled icon={icon}>{label}</Titled>
      </legend>
      <div className={styles.choices}>
        {values.map((choice) => (
          <label key={String(choice)} className={styles.choice}>
            <input
              type="radio"
              name={name}
              checked={choice === value}
              onChange={() => onChange(choice)}
            />
            <span className={styles.choiceLabel}>{choices[choice].label}</span>
            <span className={styles.choiceHint}>{choices[choice].hint}</span>
          </label>
        ))}
      </div>
    </fieldset>
  )
}

type SettingsSkeletonProps = { count: number }

/** `count` settings on their way: each a title over a card or two. */
export const SettingsSkeleton = ({ count }: SettingsSkeletonProps) =>
  Array.from({ length: count }, (_, index) => (
    <span key={index} className={styles.choices}>
      <Bone shape="text" width="short" />
      <Bone shape="heading" />
      <Bone shape="heading" />
    </span>
  ))

type SettingsSectionProps<T> = {
  icon: IconName
  title: string
  hint: string
  isResetting: boolean
  query: UseQueryResult<T>
  shape: ReactNode
  saveError: Error | null
  children: (data: T) => ReactNode
}

/**
 * One admin settings source: its heading, load/save errors, and controls.
 * The owning page enforces management access; a reset temporarily disables edits.
 */
export const SettingsSection = <T,>({
  icon,
  title,
  hint,
  isResetting,
  query,
  shape,
  saveError,
  children,
}: SettingsSectionProps<T>) => {
  const headingId = useId()
  return (
    <section className={styles.section} aria-labelledby={headingId}>
      <header className={styles.sectionHead}>
        <h2 id={headingId} className={styles.heading}>
          <Titled icon={icon}>{title}</Titled>
        </h2>
        <p className={styles.help}>{hint}</p>
      </header>
      {query.isError && (
        <p className={styles.error} role="alert">
          {query.error.message}
        </p>
      )}
      {saveError && (
        <p className={styles.error} role="alert">
          {SETTINGS_COPY.section.saveFailed}
          {saveError.message}
        </p>
      )}
      {/* The section names these already, so the fieldset is no group of its own to a screen reader. */}
      {query.data !== undefined && (
        <fieldset role="none" className={styles.settings} disabled={isResetting}>
          {children(query.data)}
        </fieldset>
      )}
      {query.isPending && <Loading label={SETTINGS_COPY.section.reading}>{shape}</Loading>}
    </section>
  )
}
