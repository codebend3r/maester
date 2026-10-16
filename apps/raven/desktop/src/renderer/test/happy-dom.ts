import { GlobalRegistrator } from '@happy-dom/global-registrator'

// Bun test has no DOM by default. Register happy-dom's globals before any test
// module, or Testing Library, evaluates. The page lives on app://raven.
GlobalRegistrator.register({ url: 'app://raven/' })
