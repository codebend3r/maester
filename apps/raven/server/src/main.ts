import { createApp } from '@/app'
import { readServerConfig } from '@/config'

const config = readServerConfig()
const app = await createApp({ config })
await app.listen({ port: config.port, host: config.host })
