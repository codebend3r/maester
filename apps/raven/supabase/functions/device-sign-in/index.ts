import { handleClaim } from '@/claim'

// Supabase sets both for every Edge Function; neither is ever sent to a client.
const CLAIM_ENV = { url: 'SUPABASE_URL', serviceKey: 'SUPABASE_SERVICE_ROLE_KEY' } as const

type ClaimEnvName = (typeof CLAIM_ENV)[keyof typeof CLAIM_ENV]

const readEnv = (name: ClaimEnvName) => {
  const value = Deno.env.get(name)
  if (!value) throw new Error(`${name} is not set`)
  return value
}

const project = {
  url: readEnv(CLAIM_ENV.url).replace(/\/+$/, ''),
  serviceKey: readEnv(CLAIM_ENV.serviceKey),
}

Deno.serve((request) => handleClaim({ request, project, fetch }))
