/** The words `EXPO_TV` turns a prebuild to the TV with, as `@react-native-tvos/config-tv` reads it. */
const TV_ON = ['1', 'true'] as const

/** Whether `EXPO_TV` asks for the Apple TV's or Android TV's native project. */
export const isTvPrebuild = ({ value }: { value: string | undefined }): boolean => {
  const word = value?.trim().toLowerCase() ?? ''
  return TV_ON.some((on) => on === word)
}
