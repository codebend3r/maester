import type { UseQueryResult } from '@tanstack/react-query'
import { type ReactNode, useId } from 'react'
import type { IconName } from '@raven/ui'
import { Bone, Loading } from '@/components/Skeleton/Skeleton'
import { cannotManageNote, useManagement } from '@/lib/management'
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
  browser?: ReactNode
  children: (data: T) => ReactNode
}

/**
 * One source of settings: its heading and what it covers, that the admin
 * lock keeps them as they are, why they could not be read or saved, `shape`
 * while they are read, and its settings once known. One fieldset holds them
 * all, disabled while the admin lock is on or a reset is saving. `browser`
 * holds what this browser keeps for itself, after and outside that fieldset,
 * so neither the admin lock nor the server's answer has a say in it.
 */
export const SettingsSection = <T,>({
  icon,
  title,
  hint,
  isResetting,
  query,
  shape,
  saveError,
  browser,
  children,
}: SettingsSectionProps<T>) => {
  const headingId = useId()
  const { mode, canManage } = useManagement()
  return (
    <section className={styles.section} aria-labelledby={headingId}>
      <header className={styles.sectionHead}>
        <h2 id={headingId} className={styles.heading}>
          <Titled icon={icon}>{title}</Titled>
        </h2>
        <p className={styles.help}>
          {hint}
          {!canManage && (
            <>
              {' '}
              <span>
                {cannotManageNote({
                  mode,
                  action: SETTINGS_COPY.section.changeThese,
                  lockPlace: SETTINGS_COPY.section.below,
                })}
              </span>
            </>
          )}
        </p>
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
        <fieldset role="none" className={styles.settings} disabled={!canManage || isResetting}>
          {children(query.data)}
        </fieldset>
      )}
      {query.isPending && <Loading label={SETTINGS_COPY.section.reading}>{shape}</Loading>}
      {browser}
    </section>
  )
}
