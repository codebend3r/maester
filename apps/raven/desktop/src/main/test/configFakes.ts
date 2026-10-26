import { DEFAULT_OUTPUT_SETTINGS } from '@raven/core'
import { DEFAULT_UPDATE_SETTINGS, type DesktopConfig } from '@/main/desktopConfig'

/** The fixed server's id and origin in the tests that need only one. */
export const SERVER = {
  id: '0f8fad5b-d9cb-469f-a165-70867728950e',
  origin: 'https://raven.example',
} as const

type ConfigForProps = { id: string; origin: string }

/** A version 5 config for the server given, with the default output and release check. */
export const configFor = ({ id, origin }: ConfigForProps): DesktopConfig => ({
  version: 5,
  output: DEFAULT_OUTPUT_SETTINGS,
  server: { id, origin },
  updates: { ...DEFAULT_UPDATE_SETTINGS },
  lastAccountId: null,
})
