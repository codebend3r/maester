// The polyfills come first: @raven/core builds Intl constructors Hermes lacks
// as soon as a route imports it, and imports run in the order written here.
import '@raven/native/polyfills'
import 'expo-router/entry'
