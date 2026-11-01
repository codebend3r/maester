export const ADMIN_PATH = '/admin'

export const ADMIN_COPY = {
  heading: 'Admin',
  scans: 'Library scans',
  stop: 'Stop all scans',
  resume: 'Allow scans again',
  hint: 'Stops all library scans, matching, ratings, thumbnails, and intro and credits detection. Scans stay stopped until allowed again or the server restarts. A request already in flight may finish.',
  stopped: 'All scans are stopped.',
} as const
