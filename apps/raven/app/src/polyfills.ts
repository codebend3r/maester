// Hermes has no Intl.Locale, Intl.PluralRules, Intl.RelativeTimeFormat or
// Intl.DisplayNames on Apple TV or Android TV, and @raven/core builds the
// last two at module scope. Each `polyfill.js` entry installs itself only when
// the engine lacks the constructor or its English data, so what Hermes has
// natively (NumberFormat, DateTimeFormat) stays native. Each one needs the
// ones above it, and each locale's data follows its polyfill.
import '@formatjs/intl-getcanonicallocales/polyfill.js'
import '@formatjs/intl-locale/polyfill.js'
import '@formatjs/intl-pluralrules/polyfill.js'
import '@formatjs/intl-pluralrules/locale-data/en.js'
import '@formatjs/intl-relativetimeformat/polyfill.js'
import '@formatjs/intl-relativetimeformat/locale-data/en.js'
import '@formatjs/intl-displaynames/polyfill.js'
import '@formatjs/intl-displaynames/locale-data/en.js'
