import type { ReactNode } from 'react'

/** The pad's three rows of digits, as a phone's keypad; zero sits under them, between Backspace and Unlock. */
export const PAD_ROWS = [
  ['1', '2', '3'],
  ['4', '5', '6'],
  ['7', '8', '9'],
] as const
export const PAD_ZERO = '0'

/** The key the remote starts on as the pad opens. */
export const PAD_FIRST = PAD_ROWS[0][0]

export type PadDigit = (typeof PAD_ROWS)[number][number] | typeof PAD_ZERO

/** Longer than any PIN worth typing on a pad, as the web's, so a held key cannot run on. */
export const PIN_MAX_DIGITS = 12

type PinWithProps = { pin: string; digit: PadDigit }

/** The PIN with `digit` added at its end, unless it is as long as a PIN may be. */
export const pinWith = ({ pin, digit }: PinWithProps): string =>
  pin.length < PIN_MAX_DIGITS ? `${pin}${digit}` : pin

/** The PIN with its last digit taken back. */
export const pinWithoutLast = (pin: string): string => pin.slice(0, -1)

export type LockedNoticeProps = {
  /** The library's name, which the message names. */
  name: string
  /** Whether this account may enter the PIN: only then is there an Unlock button. */
  canUnlock: boolean
  onUnlock: () => void
}

export type PinPadProps = {
  isOpen: boolean
  /** The digits entered so far, drawn only as dots. */
  pin: string
  /** The server's refusal of the last PIN, or null. */
  error: string | null
  /** Whether the PIN is on its way to the server, when Unlock waits. */
  isPending: boolean
  onDigit: (digit: PadDigit) => void
  onBackspace: () => void
  onUnlock: () => void
  onCancel: () => void
}

/**
 * The PIN lock's pieces, which each platform sizes for the distance it is read from: what stands
 * in place of a locked library's videos, and the web's pad of digits over the screen.
 */
export type LockKit = {
  LockedNotice: (props: LockedNoticeProps) => ReactNode
  PinPad: (props: PinPadProps) => ReactNode
}
