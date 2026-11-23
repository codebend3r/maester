import { type Library, type ServerId, PINS_CAP } from '@raven/core'
import { Button } from '@raven/ui'
import { type PinToggle, usePinToggle } from '@raven/ui/headless'
import { usePins } from '@/lib/pins'
import { type AccountKeeping, useAccountKeeping } from '@/lib/accountData'
import { useActiveServerId } from '@/lib/servers'
import { LIBRARIES_COPY } from '@/pages/LibrariesPage/copy'
import styles from '@/pages/LibrariesPage/LibrariesPage.module.scss'

/** What pinning needs: the account database, who is signed in, and the server in use's id. */
type Pinning = AccountKeeping & { serverId: ServerId }

/**
 * How this viewer pins, or null where they cannot: accounts off, no one signed in, or a server
 * too old to say its id, which a pin could not name.
 */
export const usePinning = (): Pinning | null => {
  const keeping = useAccountKeeping()
  const serverId = useActiveServerId()
  return keeping === null || serverId === null ? null : { ...keeping, serverId }
}

type PinButtonProps = { library: Library; pinning: Pinning }

/** The button's tooltip: why it is greyed out when the pins are full, else what a press does. */
const titleOf = ({ isPinned, isFull }: PinToggle): string => {
  if (isFull) return LIBRARIES_COPY.pinsFull(PINS_CAP)
  return isPinned ? LIBRARIES_COPY.pinnedTitle : LIBRARIES_COPY.pinTitle
}

/**
 * Pin as a toggle: outlined while off, filled while on, when it reads Pinned. A pin is the
 * account's, kept in its own database for this server and library, so it shows in the side
 * menu of every device the account signs in on, beside the pins on its other servers. It shows
 * at once and goes back if the database refuses it. A toggle keeps one name whatever its state,
 * which `aria-pressed` carries, so the word on screen is for the eye and the name stays "Pin"
 * and the library's. Past the account's `PINS_CAP` pins, an unpinned library cannot be pinned.
 */
export const PinButton = ({ library, pinning: { client, userId, serverId } }: PinButtonProps) => {
  const pin = usePinToggle({
    userId,
    serverId,
    libraryId: library.id,
    pins: usePins(),
    setPin: ({ shouldPin, ...named }) =>
      shouldPin ? client.pinLibrary(named) : client.unpinLibrary(named),
  })
  return (
    pin && (
      <Button
        icon="pin"
        className={styles.pin}
        aria-pressed={pin.isPinned}
        disabled={pin.isFull}
        title={titleOf(pin)}
        onClick={pin.toggle}
      >
        <span aria-hidden="true">{pin.isPinned ? LIBRARIES_COPY.pinned : LIBRARIES_COPY.pin}</span>
        <span className="visually-hidden">{LIBRARIES_COPY.pinName(library.name)}</span>
      </Button>
    )
  )
}
