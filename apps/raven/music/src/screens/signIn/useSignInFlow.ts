import { apiFor } from '@raven/native'
import { RAVEN_SERVER, signInFlowFor } from '@raven/native/headless'

import { useWrenAccount } from '@/session'
import { useActiveServer } from '@/stores/activeServer'

/** Sign-in's steps, fields and outcomes, the device app's own flow over Wren's stores. */
export const useSignInFlow = signInFlowFor({
  account: useWrenAccount,
  servers: useActiveServer,
  apiOf: (server) => apiFor({ server, session: useWrenAccount }),
  server: RAVEN_SERVER,
})

/** What the flow hands a step's form: the fields, their setters, the error and the submit. */
export type SignInFlow = ReturnType<typeof useSignInFlow>
