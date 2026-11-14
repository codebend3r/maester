import { jest } from '@jest/globals'
import type * as Core from '@raven/core'
import { configure } from '@testing-library/react-native'

/*
 * A loaded CI runner can spend seconds on a file's first render while jest compiles what
 * the screen imports, past the library's one second wait.
 */
configure({ asyncUtilTimeout: 10_000 })

/*
 * jest's React Native has no native view commands, and a focus guide given `destinations` (the
 * TV music strip's left edge) sends one as it mounts; here it is heard and does nothing.
 */
jest.mock('react-native/Libraries/Components/View/ViewNativeComponent', () => {
  const actual = jest.requireActual<Record<string, unknown>>(
    'react-native/Libraries/Components/View/ViewNativeComponent',
  )
  const { isRecord: mockIsRecord } = jest.requireActual<typeof Core>('@raven/core')
  const commands = mockIsRecord(actual.Commands) ? actual.Commands : {}
  return {
    ...actual,
    __esModule: true,
    Commands: { ...commands, setDestinations: () => undefined },
  }
})
