import { join } from 'node:path'
import { serveLighthouse } from '@tooling/web/lighthouse'

/*
 * raven's two pages for Lighthouse CI, served by `serveLighthouse` (`@tooling/web/lighthouse`),
 * which says how they are served.
 *
 * The sign-in page's performance floor in lighthouserc.json is 0.90, set from CI's runner: its
 * warm runs score 0.94 to 0.95 there, on mobile and desktop alike, and the first of the five is
 * a cold outlier (0.62 to 0.68 on mobile), so a floor of 0.95 failed whenever the median landed
 * on 0.94. It holds the page where it is; raise it as the page gets faster.
 *
 * Home's performance floor in lighthouserc.json is 0.70: its largest paint is the hero's
 * backdrop, which waits on the app, Home's chunk and `/api/home/hero` before it loads, about 4 s on simulated mobile, and drawing its hero and
 * shelves blocks the main thread for 370 to 570 ms on CI's runner, where Lighthouse slows every
 * task fourfold. The floor comes from that runner, which scored Home 0.72 to 0.78 when it was set
 * (a Mac, with a faster CPU, scores 0.87 to 0.93). It holds Home where it is; raise it as Home
 * gets faster.
 *
 * Both performance floors are held against the median of the five runs' scores (`median`), not
 * the score of Lighthouse CI's `median-run`: that picks the run nearest the median first paint
 * and time to interactive, which can be the cold first run, and failed Home at 0.66 while its
 * other four runs scored 0.81 to 0.84.
 */

const SITES = {
  signIn: { host: '127.0.0.1', port: 4173 },
  home: { host: '127.0.0.1', port: 4174 },
} as const

// Lighthouse CI waits for the line this prints (lighthouserc.json's `startServerReadyPattern`).
await serveLighthouse({ distDir: join(import.meta.dirname, '..', 'dist'), sites: SITES })
