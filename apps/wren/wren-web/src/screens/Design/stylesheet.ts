/**
 * The stylesheet as text, which Vite hands over through `?raw`. It is a module of its own so the
 * tests, which Bun runs and which cannot load `?raw`, put a small stylesheet in its place and
 * run everything that reads it for real.
 */
export { default as stylesheet } from '@/styles/globals.scss?raw'
