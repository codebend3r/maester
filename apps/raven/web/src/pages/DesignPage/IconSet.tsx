import { isLibraryIconName, plural } from '@raven/core'
import { useEffect, useState } from 'react'
import { ICON_NAMES, Icon, type IconName } from '@raven/ui'
import { copyText } from '@/lib/clipboard'
import styles from '@/pages/DesignPage/IconSet.module.scss'

/** The player's own icons, grouped apart from the app's. */
const PLAYBACK = [
  'play',
  'pause',
  'rewind',
  'forward',
  'shuffle',
  'volume',
  'volumeLow',
  'muted',
  'captions',
  'fullscreen',
  'fullscreenExit',
  'playback',
  'file-play',
] as const satisfies readonly IconName[]

const isPlayback = (name: IconName) => PLAYBACK.some((icon) => icon === name)

const isLibraryIcon = (name: IconName) => isLibraryIconName.values.some((icon) => icon === name)

const GROUPS = [
  {
    name: 'Navigation and app',
    icons: ICON_NAMES.filter((name) => !isPlayback(name) && !isLibraryIcon(name)),
  },
  { name: 'Playback', icons: ICON_NAMES.filter(isPlayback) },
  { name: 'Library types', icons: ICON_NAMES.filter(isLibraryIcon) },
]

/** How long a copied icon says so before it shows its name again. */
const COPIED_MS = 2000

/**
 * Every icon, in groups, each with its name. Each is a button that copies
 * its name, so pointing at one plays the motion it has in any control.
 */
export const IconSet = () => {
  const [copied, setCopied] = useState<IconName | null>(null)

  useEffect(() => {
    if (copied == null) return undefined
    const timer = window.setTimeout(() => setCopied(null), COPIED_MS)
    return () => window.clearTimeout(timer)
  }, [copied])

  const copy = (name: IconName) =>
    copyText(name).then(
      (isCopied) => setCopied(isCopied ? name : null),
      () => setCopied(null),
    )

  return (
    <div className={styles.set}>
      {GROUPS.map((group) => (
        <div key={group.name} className={styles.group}>
          <header className={styles.head}>
            <h4 className={styles.title}>{group.name}</h4>
            <span className={styles.count}>
              {plural({ n: group.icons.length, one: 'icon', many: 'icons' })}
            </span>
          </header>
          <ul className={styles.icons}>
            {group.icons.map((name) => (
              <li key={name}>
                <button
                  type="button"
                  className={styles.icon}
                  aria-label={`Copy ${name}`}
                  onClick={() => {
                    void copy(name)
                  }}
                >
                  <Icon name={name} size={28} />
                  <span className={styles.name}>{copied === name ? 'Copied' : name}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}
      <output className="visually-hidden">{copied == null ? '' : `Copied ${copied}`}</output>
    </div>
  )
}
