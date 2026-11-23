import { join } from 'node:path'
import { serveLighthouse } from '@tooling/web/lighthouse'

/*
 * Wren's two pages for Lighthouse CI, served by `serveLighthouse` (`@tooling/web/lighthouse`),
 * which says how they are served: the sign-in page, and Home over the Lighthouse fixture's music
 * library. Ports of their own, so neither is ever raven's. The floors in lighthouserc.json start
 * at raven's (0.90 for sign-in, 0.70 for Home, against the median of five runs); set them from
 * CI's runner once it has scored Wren, and raise them as the pages get faster.
 */

const SITES = {
  signIn: { host: '127.0.0.1', port: 4175 },
  home: { host: '127.0.0.1', port: 4176 },
} as const

// Lighthouse CI waits for the line this prints (lighthouserc.json's `startServerReadyPattern`).
await serveLighthouse({ distDir: join(import.meta.dirname, '..', 'dist'), sites: SITES })
