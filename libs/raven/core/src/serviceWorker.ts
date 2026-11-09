/**
 * The web app's service worker: the entry its build names, the file it writes at the site's root,
 * and the path and scope the page registers it at. A worker's scope can not reach above the
 * folder it is served from, so it sits at the root to cover every page.
 */
export const SERVICE_WORKER = {
  entry: 'sw',
  file: 'sw.js',
  path: '/sw.js',
  scope: '/',
} as const
