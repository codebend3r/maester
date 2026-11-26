import { createApp } from '@/app'
import { readServerConfig } from '@/config'
import { StartupWork } from '@/startupWork'
import { sizeThreadpool } from '@/threadpool'
import { withSecretFiles } from '@shared/server'

sizeThreadpool()
const config = readServerConfig(withSecretFiles({ env: process.env }))
const app = await createApp({ config, shouldHoldStartupWork: true })
await app.listen({ port: config.port, host: config.host })
app.get(StartupWork).release()
