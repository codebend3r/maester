import { describe, expect, it, jest } from '@jest/globals'
import { render, screen } from '@testing-library/react-native'

import { SignIn } from '@/screens/SignIn'

jest.mock('expo-router', () => ({
  useRouter: () => ({ dismissTo: jest.fn() }),
}))
jest.mock('@/account/accountSession', () => ({
  useAccountSession: {
    getState: () => ({ signIn: jest.fn(), signOut: jest.fn() }),
  },
}))
jest.mock('@/servers/ravenServer', () => ({
  IS_SIGN_IN_BYPASSED: true,
  RAVEN_SERVER: {
    id: '7c1f4e2a-3b5d-4a6e-8f90-1a2b3c4d5e6f',
    name: 'raven',
    origin: 'http://127.0.0.1:8490',
    addedAt: 0,
  },
}))
jest.mock('@/servers/serverClient', () => ({ apiFor: jest.fn() }))
jest.mock('@/stores/activeServer', () => ({
  useActiveServer: { getState: jest.fn() },
}))

describe('SignIn for the accountless end to end build', () => {
  it('starts at the fixture PIN instead of asking for an account', async () => {
    await render(<SignIn />)

    expect(screen.getByLabelText('PIN')).toBeTruthy()
    expect(screen.queryByLabelText('Email')).toBeNull()
  })
})
