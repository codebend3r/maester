import { type Account, PAGE_PATHS } from '@raven/core'
import { Icon } from '@raven/ui'
import { useId } from 'react'
import { Link } from 'react-router-dom'
import { ACCOUNT_MENU_COPY } from '@/components/AccountMenu/copy'
import { ACCESS_KINDS, useAccessState } from '@/lib/accessState'
import { useMenu } from '@/lib/useMenu'
import { useSignOut } from '@/lib/useSignOut'
import styles from '@/components/AccountMenu/AccountMenu.module.scss'
import { COMMON_COPY } from '@/lib/copy'

type MenuProps = { account: Account }

const Menu = ({ account }: MenuProps) => {
  const id = useId()
  const { isOpen, toggle, close, root, trigger, list, onKeyDown } = useMenu()
  const end = useSignOut()

  return (
    <div ref={root} className={styles.account}>
      <button
        ref={trigger}
        type="button"
        className={styles.trigger}
        aria-label={COMMON_COPY.account}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-controls={id}
        title={account.email}
        onClick={toggle}
      >
        {account.email.charAt(0).toUpperCase()}
      </button>
      {isOpen && (
        <section className={styles.popover} aria-labelledby={`${id}-email`}>
          <header className={styles.head}>
            <p id={`${id}-email`} className={styles.email}>
              {account.email}
            </p>
            <p className={styles.role}>
              {account.isOwner ? ACCOUNT_MENU_COPY.owner : ACCOUNT_MENU_COPY.member}
            </p>
          </header>
          <ul
            ref={list}
            id={id}
            role="menu"
            aria-labelledby={`${id}-email`}
            className={styles.list}
            onKeyDown={onKeyDown}
          >
            <li role="none">
              <Link
                to={PAGE_PATHS.settings}
                role="menuitem"
                className={styles.item}
                onClick={() => close({ refocus: false })}
              >
                <Icon name="settings" size={18} />
                {COMMON_COPY.settings}
              </Link>
            </li>
            <li role="none">
              <button
                type="button"
                role="menuitem"
                className={styles.item}
                disabled={end.isPending}
                onClick={() => end.mutate()}
              >
                <Icon name="signOut" size={18} />
                {end.isPending ? COMMON_COPY.signingOut : COMMON_COPY.signOut}
              </button>
            </li>
          </ul>
          {end.isError && (
            <p className={styles.error} role="alert">
              {ACCOUNT_MENU_COPY.signOutFailed(end.error.message)}
            </p>
          )}
        </section>
      )}
    </div>
  )
}

/**
 * The round button in a page's corner for whoever is signed in, wearing the
 * first letter of their address, and the menu it opens: the address and
 * whether it is the owner's, then Settings and Sign out. Escape, Tab or a
 * click elsewhere closes it. Only an approved account has one.
 */
export const AccountMenu = () => {
  const access = useAccessState()
  return access.kind === ACCESS_KINDS.approved && <Menu account={access.account} />
}
