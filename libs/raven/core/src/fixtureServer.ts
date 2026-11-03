/**
 * What `@raven/server`'s `serve:fixture` holds and how it is started, shared by the server that
 * builds it and the web's browser end to end suite that reads it. The device app's and Wren's
 * Maestro flows name the same titles in YAML, which can import nothing.
 */
export const FIXTURE_SERVER = {
  /** The device apps' fixture listens here, the port their builds name. */
  appPort: 8490,
  /** The web suite's listens here, so it never meets a device fixture left running. */
  webPort: 8491,
  host: '127.0.0.1',
  /** What a runner polls until the fixture answers: it listens only once its scans are done. */
  readyPath: '/api/health',
  env: {
    /** The built web app's folder, which the fixture then serves beside its API. */
    webDir: 'RAVEN_FIXTURE_WEB_DIR',
    port: 'RAVEN_FIXTURE_PORT',
  },
  movie: { library: 'Films', title: 'Kestrel Point' },
  show: {
    library: 'Series',
    title: 'Lantern Bay',
    episodes: ['Low Tide', 'High Water'],
  },
  album: {
    library: 'Music',
    title: 'Morning Chorus',
    artist: 'The Fixture Birds',
    tracks: ['First Light', 'Dawn Song', 'Open Sky'],
  },
} as const
