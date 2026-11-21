import { fileURLToPath } from 'node:url'
import { type HtmlTagDescriptor, type Plugin, defineConfig } from 'vite'

/** Where the splash is served, which a link preview needs whole: it reads no relative address. */
const SITE = 'https://maester.tv'

/** The splash's themes: the green of `globals.scss`, and Ultraviolet, a page's `theme-ultraviolet` body class. */
const THEMES = { green: 'green', ultraviolet: 'ultraviolet' } as const
type Theme = (typeof THEMES)[keyof typeof THEMES]

/** Each theme's ground, its `--color-night`, which a browser tints its own bars with. */
const THEME_GROUNDS = {
  [THEMES.green]: '#15201e',
  [THEMES.ultraviolet]: '#0f0a1f',
} as const satisfies Record<Theme, string>

/** One page as a browser tab and a link preview name it. */
type PageMeta = {
  /** The page's address on the site. */
  path: string
  title: string
  description: string
  /** Matches the page's body class: `theme-ultraviolet` for Ultraviolet, none for the green. */
  theme: Theme
}

/** Every page of the splash by the file Vite builds it from, with its title and description. */
const PAGES: ReadonlyMap<string, PageMeta> = new Map([
  [
    '/index.html',
    {
      path: '/',
      title: 'Maester: your films, shows and music, from your own disk',
      description:
        'Maester is two apps for the media on your own disk: Raven plays your videos and Wren plays your music, on every screen you own.',
      theme: THEMES.ultraviolet,
    },
  ],
  [
    '/raven/index.html',
    {
      path: '/raven/',
      title: 'Raven: your videos, from your own disk',
      description:
        'Raven plays the videos on your own disk: in the browser, in the Raven app for Mac and Windows, and on iPhone, iPad, Apple TV and Android TV.',
      theme: THEMES.green,
    },
  ],
  [
    '/wren/index.html',
    {
      path: '/wren/',
      title: 'Wren: your music, from your own disk',
      description:
        'Wren plays the music on your Raven server, on iPhone, iPad and Android phones: the file itself, your downloads offline, and on with the screen locked.',
      theme: THEMES.green,
    },
  ],
  [
    '/releases/index.html',
    {
      path: '/releases/',
      title: 'Raven: every version',
      description: 'Every version of Raven for Mac and Windows, with its downloads.',
      theme: THEMES.green,
    },
  ],
  [
    '/dev-builds/index.html',
    {
      path: '/dev-builds/',
      title: 'Raven: dev builds',
      description:
        'Every release of Raven with the files that install it: Raven for Mac and Windows, the device app for Android TV and Android phones, and Wren for Android phones.',
      theme: THEMES.green,
    },
  ],
])

/**
 * A page's head: the site's icons and theme colour, then its title, description, canonical
 * address and share tags, the ones WhatsApp, Facebook and the rest build a link preview from.
 * They are written here once, so no page copies the icons, a page's description and its
 * preview's cannot drift apart, and every page shares the one picture, Maester's icon.
 */
const headTagsOf = ({ path, title, description, theme }: PageMeta): HtmlTagDescriptor[] => {
  const url = `${SITE}${path}`
  const share = {
    'og:site_name': 'Maester',
    'og:type': 'website',
    'og:url': url,
    'og:title': title,
    'og:description': description,
    'og:image': `${SITE}/brand/maester-icon-512.png`,
    'og:image:width': '512',
    'og:image:height': '512',
    'og:image:alt': 'The Maester mark',
  } as const
  return [
    { tag: 'meta', attrs: { name: 'theme-color', content: THEME_GROUNDS[theme] } },
    { tag: 'link', attrs: { rel: 'icon', href: '/favicon.ico', sizes: '32x32' } },
    { tag: 'link', attrs: { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' } },
    { tag: 'link', attrs: { rel: 'apple-touch-icon', href: '/apple-touch-icon.png' } },
    { tag: 'title', children: title },
    { tag: 'meta', attrs: { name: 'description', content: description } },
    { tag: 'link', attrs: { rel: 'canonical', href: url } },
    ...Object.entries(share).map(([property, content]) => ({
      tag: 'meta',
      attrs: { property, content },
    })),
    { tag: 'meta', attrs: { name: 'twitter:card', content: 'summary' } },
    // Appended, so the charset stays the first thing in the head.
  ].map((tag): HtmlTagDescriptor => ({ ...tag, injectTo: 'head' }))
}

/** Gives each page its head tags from `PAGES`; a page missing there fails the build. */
const pageHead = (): Plugin => ({
  name: 'splash-page-head',
  transformIndexHtml: (_html, { path }) => {
    const page = PAGES.get(path)
    if (page === undefined) throw new Error(`${path} has no title and description in PAGES`)
    return headTagsOf(page)
  },
})

export default defineConfig({
  plugins: [pageHead()],
  build: {
    rollupOptions: {
      input: {
        index: fileURLToPath(new URL('./index.html', import.meta.url)),
        raven: fileURLToPath(new URL('./raven/index.html', import.meta.url)),
        wren: fileURLToPath(new URL('./wren/index.html', import.meta.url)),
        releases: fileURLToPath(new URL('./releases/index.html', import.meta.url)),
        devBuilds: fileURLToPath(new URL('./dev-builds/index.html', import.meta.url)),
      },
    },
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    // Its own port, beside raven's web app (5173) and rookery's (5180).
    port: 5190,
    strictPort: true,
  },
})
