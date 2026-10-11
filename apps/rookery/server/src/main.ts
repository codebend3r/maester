import { createApp } from '@/app'
import { ConfigError, loadEnvFile, readServerConfig } from '@/config'

loadEnvFile()

const readConfig = () => {
  try {
    return readServerConfig()
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error
    console.error(`rookery: ${error.message}`)
    process.exit(1)
  }
}

const config = readConfig()
const app = await createApp({ config })
await app.listen({ port: config.port, host: config.host })
