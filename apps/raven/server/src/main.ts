import { createApp } from '@/app'
import { readServerConfig } from '@/config'
import { sizeThreadpool } from '@/threadpool'

sizeThreadpool()
const config = readServerConfig()
const app = await createApp({ config })
await app.listen({ port: config.port, host: config.host })
