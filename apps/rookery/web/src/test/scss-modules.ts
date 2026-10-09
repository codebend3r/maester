import { plugin } from 'bun'

// Vite compiles `*.module.scss` into a class-name map; Bun has no CSS module
// loader and would hand tests the stylesheet's path as a string, so every
// `styles.foo` would read a property off a String. Tests get an identity
// map instead: `styles.stage` is the string "stage".
const classNames: Record<string, string> = new Proxy(Object.create(null), {
  get: (_target, key) => (typeof key === 'string' ? key : undefined),
})

plugin({
  name: 'scss-modules',
  setup: (build) => {
    build.onLoad({ filter: /\.s?css$/ }, () => ({
      exports: { default: classNames },
      loader: 'object',
    }))
  },
})
