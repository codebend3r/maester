import { configure } from '@testing-library/react-native'

// A loaded CI runner can spend seconds on a file's first render while jest compiles what
// the screen imports, past the library's one second wait.
configure({ asyncUtilTimeout: 10_000 })
