import { createApp } from '@/app'
import { readServerConfig } from '@/config'
import { StartupWork } from '@/startupWork'
import { sizeThreadpool } from '@/threadpool'

sizeThreadpool()
const config = readServerConfig()
const app = await createApp({ config, shouldHoldStartupWork: true })
await app.listen({ port: config.port, host: config.host })
app.get(StartupWork).release()
