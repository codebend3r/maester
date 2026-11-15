import type { ComponentType, ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { BackButton, HOME } from '@/components/BackButton/BackButton'
import { MANAGERS_ONLY_COPY } from '@/components/ManagersOnly/copy'
import { MANAGEMENT_MODES, type ManagementMode, useManagement } from '@/lib/management'
import styles from '@/components/ManagersOnly/ManagersOnly.module.scss'
import { ADMIN_COPY } from '@/pages/SettingsPage/adminCopy'
import { APP_PATHS } from '@/lib/appPaths'

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
      <Link to={APP_PATHS.admin}>{ADMIN_COPY.heading}</Link>
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
const ManagersOnly = ({ mode, ...note }: ManagersOnlyProps) => {
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

const MANAGE_STATES = { managing: 'managing', refused: 'refused' } as const
type ManageState = (typeof MANAGE_STATES)[keyof typeof MANAGE_STATES]

type ForManagersViewProps = ManagersOnlyProps & { children: ReactNode }

const Managing = ({ children }: ForManagersViewProps) => children

const FOR_MANAGERS_VIEWS = {
  [MANAGE_STATES.managing]: Managing,
  [MANAGE_STATES.refused]: ManagersOnly,
} as const satisfies Record<ManageState, ComponentType<ForManagersViewProps>>

type ForManagersProps = NoteProps & {
  /** The page itself, rendered (and so asking the server) only while the viewer may manage. */
  children: ReactNode
}

/** A managing page: itself while the viewer may manage, else whom it is for. */
export const ForManagers = ({ children, ...note }: ForManagersProps) => {
  const { mode, canManage } = useManagement()
  const View = FOR_MANAGERS_VIEWS[canManage ? MANAGE_STATES.managing : MANAGE_STATES.refused]
  return (
    <View mode={mode} {...note}>
      {children}
    </View>
  )
}
