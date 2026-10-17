import { createContext, useContext } from 'react'

/** Main's release check status, as Settings reads it and the Shell refreshes it. */
export const UPDATES_KEY = ['desktop', 'updates'] as const

export const UNOPENED = 'raven player could not open the release page. Try again.'

const HideUpdateContext = createContext<() => void>(() => undefined)

export const HideUpdateProvider = HideUpdateContext.Provider

/** Hides the Shell's update notice for the session, as its own Dismiss does. */
export const useHideUpdate = (): (() => void) => useContext(HideUpdateContext)
