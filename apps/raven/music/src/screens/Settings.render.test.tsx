import { beforeEach, describe, expect, it, jest } from '@jest/globals'
import type * as Native from '@raven/native'
import { RAVEN_SERVER } from '@raven/native/headless'
import { fireEvent, renderRouter, screen } from 'expo-router/testing-library'

import packageJson from '#package'
import { WREN_ROUTES } from '@/routes'
import { Home } from '@/screens/Home'
import { Settings } from '@/screens/Settings'
import { SignIn } from '@/screens/SignIn'
import { useWrenAccount } from '@/session'
import { useActiveServer } from '@/stores/activeServer'
import { WrenRoot } from '@/WrenRoot'
import { WrenTabs } from '@/WrenTabs'

const SESSION = {
  accessToken: 'access',
  refreshToken: 'refresh',
  expiresAt: Date.now() + 3_600_000,
  userId: 'u1',
  email: 'listener@example.com',
}

jest.mock('expo-splash-screen', () => ({
  preventAutoHideAsync: async () => true,
  hideAsync: async () => {},
}))
jest.mock('@raven/native', () => ({
  ...jest.requireActual<typeof Native>('@raven/native'),
  apiFor: () => ({}),
  cookieJar: { forget: async () => {} },
  secretStore: {
    getItemAsync: async () => null,
    setItemAsync: async () => {},
    deleteItemAsync: async () => {},
  },
}))

/** Wren's own route tree, with the screens Settings leads to. */
const WREN = {
  _layout: WrenRoot,
  '(tabs)/_layout': WrenTabs,
  '(tabs)/index': Home,
  '(tabs)/settings': Settings,
  'sign-in': SignIn,
}

describe('Settings', () => {
  beforeEach(() => {
    useWrenAccount.setState({ session: SESSION })
    useActiveServer.setState({ servers: [], activeId: null })
  })

  it('says who is signed in, to which server, and which Wren this is', async () => {
    await renderRouter(WREN, { initialUrl: WREN_ROUTES.settings })
    expect(await screen.findByText(`Signed in as ${SESSION.email}`)).toBeTruthy()
    expect(screen.getByText(RAVEN_SERVER.origin)).toBeTruthy()
    expect(screen.getByText(`Wren ${packageJson.version}`)).toBeTruthy()
  })

  it('signs out, forgetting the account, and lands on sign-in', async () => {
    const router = await renderRouter(WREN, { initialUrl: WREN_ROUTES.settings })
    await fireEvent.press(await screen.findByRole('button', { name: 'Sign out' }))

    expect(useWrenAccount.getState().session).toBeNull()
    expect(await screen.findByLabelText('Email')).toBeTruthy()
    expect(router.getPathname()).toBe(WREN_ROUTES.signIn)
  })

  it('sends a listener who is not signed in to sign-in', async () => {
    useWrenAccount.setState({ session: null })
    const router = await renderRouter(WREN, { initialUrl: WREN_ROUTES.settings })
    expect(await screen.findByLabelText('Email')).toBeTruthy()
    expect(router.getPathname()).toBe(WREN_ROUTES.signIn)
  })
})
