// What Metro hands the app for a picture it bundles: the asset's number in its registry.
declare module '*.png' {
  import type { ImageRequireSource } from 'react-native'

  const source: ImageRequireSource
  export default source
}
