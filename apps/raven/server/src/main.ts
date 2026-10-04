import { createApp } from '@/app.js'
import { readServerConfig } from '@/config.js'

const config = readServerConfig()
const app = await createApp({ config })
await app.listen({ port: config.port, host: config.host })
