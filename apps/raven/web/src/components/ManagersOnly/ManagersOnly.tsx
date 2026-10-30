import type { ComponentType } from 'react'
import { Link } from 'react-router-dom'
import { BackButton, HOME } from '@/components/BackButton/BackButton'
import { MANAGERS_ONLY_COPY } from '@/components/ManagersOnly/copy'
import { MANAGEMENT_MODES, type ManagementMode } from '@/lib/management'
import styles from '@/components/ManagersOnly/ManagersOnly.module.scss'
import { COMMON_COPY } from '@/lib/copy'

type ManagersOnlyProps = {
  mode: ManagementMode
  /** The page as the heading names it: "Streams are for the admin". */
  name: string
  /** What turning the admin lock off lets the admin do, after "to". */
  forAdmin: string
  /** What only the owner can do, after "can". */
  forOwner: string
}

type NoteProps = Omit<ManagersOnlyProps, 'mode'>

type AdminNoteProps = NoteProps

const AdminNote = ({ name, forAdmin }: AdminNoteProps) => (
  <>
    <h1 className={styles.title}>{MANAGERS_ONLY_COPY.forTheAdmin(name)}</h1>
    <p>
      {MANAGERS_ONLY_COPY.turnOffBefore}
      <Link to="/settings">{COMMON_COPY.settings}</Link>
      {MANAGERS_ONLY_COPY.turnOffAfter(forAdmin)}
    </p>
  </>
)

type OwnerNoteProps = NoteProps

const OwnerNote = ({ name, forOwner }: OwnerNoteProps) => (
  <>
    <h1 className={styles.title}>{MANAGERS_ONLY_COPY.forTheOwner(name)}</h1>
    <p>{MANAGERS_ONLY_COPY.onlyTheOwner(forOwner)}</p>
  </>
)

const NOTES = {
  [MANAGEMENT_MODES.adminLock]: AdminNote,
  [MANAGEMENT_MODES.owner]: OwnerNote,
  [MANAGEMENT_MODES.none]: OwnerNote,
} as const satisfies Record<ManagementMode, ComponentType<NoteProps>>

/**
 * What a managing page shows, in place of itself, to a viewer who may not
 * manage: whom it is for, and with the admin lock, how to turn it off.
 */
export const ManagersOnly = ({ mode, ...note }: ManagersOnlyProps) => {
  const Note = NOTES[mode]
  return (
    <section className={styles.page}>
      <BackButton fallback={HOME} className={styles.back} />
      <div className={styles.body}>
        <Note {...note} />
      </div>
    </section>
  )
}
