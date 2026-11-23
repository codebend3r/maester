export const SERVER_SWITCHER_COPY = {
  servers: 'Servers',
  server: 'Server',
  using: (name: string) => `Server: ${name}`,
  needsHttps: 'Needs an https address',
} as const
