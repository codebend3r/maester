import { Link } from 'react-router-dom'
import { BackButton, HOME } from '@/components/BackButton/BackButton'
import { MANAGEMENT_MODES, type ManagementMode } from '@/lib/management'
import styles from '@/components/ManagersOnly/ManagersOnly.module.scss'

type ManagersOnlyProps = {
  mode: ManagementMode
  /** The page as the heading names it: "Streams are for the admin". */
  name: string
  /** What turning the admin lock off lets the admin do, after "to". */
  forAdmin: string
  /** What only the owner can do, after "can". */
  forOwner: string
}

/**
 * What a managing page shows, in place of itself, to a viewer who may not
 * manage: whom it is for, and with the admin lock, how to turn it off.
 */
export const ManagersOnly = ({ mode, name, forAdmin, forOwner }: ManagersOnlyProps) => (
  <section className={styles.page}>
    <BackButton fallback={HOME} className={styles.back} />
    <div className={styles.body}>
      {mode === MANAGEMENT_MODES.adminLock ? (
        <>
          <h1 className={styles.title}>{name} are for the admin</h1>
          <p>
            Turn the admin lock off in <Link to="/settings">Settings</Link> to {forAdmin}.
          </p>
        </>
      ) : (
        <>
          <h1 className={styles.title}>{name} are for the owner</h1>
          <p>Only the owner can {forOwner}.</p>
        </>
      )}
    </div>
  </section>
)
