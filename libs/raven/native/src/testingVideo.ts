/**
 * The apps' stand-in for `react-native-video` under jest, kept out of `testing.ts` since it loads
 * jest and React Native, which bun's tests cannot. Nothing here is bundled into an app; only the
 * jest tests import it.
 */
export {
  drawnVideo,
  moveVideoTo,
  resetDrawnVideo,
  startVideo,
  videoModuleMock,
} from '@/test/videoMock'
