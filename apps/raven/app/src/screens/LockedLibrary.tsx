import {
  type ApiClient,
  type Library as LibraryRecord,
  LIBRARY_VIEWS,
  type LockState,
  libraryIconOf,
} from '@raven/core'
import { queryKeys } from '@raven/ui/headless'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'expo-router'
import { useState } from 'react'

import { Grid, LockedNotice, PinPad, ToolButton } from '@/layouts'
import { type PadDigit, pinWith, pinWithoutLast } from '@/layouts/lockKit'
import type { AppQueries } from '@/queries/useAppQueries'
import { LIBRARY_COPY } from '@/screens/copy'

/**
 * What the PIN's unlock and Lock both do with the server's answer: keep it as the lock's, and
 * read every query again, now with or without the unlock cookie the answer set in the jar.
 */
const useKeepLock = (): ((lock: LockState) => Promise<void>) => {
  const queryClient = useQueryClient()
  return (lock) => {
    queryClient.setQueryData(queryKeys.lock, lock)
    return queryClient.invalidateQueries()
  }
}

type UsePinUnlockProps = { api: ApiClient; onUnlocked: () => void }

/**
 * The PIN pad's state, as the web's `PinPadDialog` keeps it: the digits entered, and the unlock
 * they are sent with. A press clears the last refusal, and a refusal clears the digits. Once the
 * PIN opens, the lock's answer is kept (`useKeepLock`).
 */
const usePinUnlock = ({ api, onUnlocked }: UsePinUnlockProps) => {
  const keepLock = useKeepLock()
  const [pin, setPin] = useState('')
  const unlock = useMutation({
    mutationFn: (entered: string) => api.unlock(entered),
    onSuccess: (lock) => {
      setPin('')
      onUnlocked()
      return keepLock(lock)
    },
    onError: () => setPin(''),
  })
  return {
    pin,
    error: unlock.isError ? unlock.error.message : null,
    isPending: unlock.isPending,
    onDigit: (digit: PadDigit) => {
      unlock.reset()
      setPin((current) => pinWith({ pin: current, digit }))
    },
    onBackspace: () => setPin(pinWithoutLast),
    onUnlock: () => {
      if (pin !== '' && !unlock.isPending) unlock.mutate(pin)
    },
    clear: () => {
      unlock.reset()
      setPin('')
    },
  }
}

export type LockedLibraryProps = {
  session: AppQueries
  library: LibraryRecord
  /** Whether this account may enter the PIN: the owner, on a raven with a PIN set. */
  canUnlock: boolean
}

/**
 * A locked library still shut to this device, in place of its pages: its name, the lock and the
 * web's message, and for the owner an Unlock button. Only pressing it asks for the PIN, on the
 * web's pad over the screen; anyone else is only told it is locked. The notice stands in the
 * grid's toolbar, the one slot under the header the grid kit has; the pad is a modal beside it.
 */
export const LockedLibrary = ({ session: { api }, library, canUnlock }: LockedLibraryProps) => {
  const router = useRouter()
  const [isAsking, setAsking] = useState(false)
  const { clear, ...pad } = usePinUnlock({ api, onUnlocked: () => setAsking(false) })
  return (
    <>
      <Grid
        icon={libraryIconOf(library.settings)}
        jump={null}
        line={null}
        notice={null}
        onBack={() => router.back()}
        onOpen={() => undefined}
        search={null}
        sections={[]}
        title={library.name}
        toolbar={
          <LockedNotice
            canUnlock={canUnlock}
            name={library.name}
            onUnlock={() => setAsking(true)}
          />
        }
        view={LIBRARY_VIEWS.grid}
      />
      <PinPad
        {...pad}
        isOpen={isAsking}
        onCancel={() => {
          clear()
          setAsking(false)
        }}
      />
    </>
  )
}

type RelockButtonProps = { api: ApiClient; library: LibraryRecord }

/**
 * Lock, as the web's library header offers it on a locked library once it is open: the PIN is
 * asked for again the next time, here and for everything the account's tickets opened past it.
 */
export const RelockButton = ({ api, library }: RelockButtonProps) => {
  const keepLock = useKeepLock()
  const relock = useMutation({ mutationFn: () => api.lock(), onSuccess: keepLock })
  return (
    <ToolButton
      accessibilityLabel={LIBRARY_COPY.lockLibrary(library.name)}
      icon="lock"
      label={LIBRARY_COPY.lock}
      onPress={() => {
        if (!relock.isPending) relock.mutate()
      }}
    />
  )
}
