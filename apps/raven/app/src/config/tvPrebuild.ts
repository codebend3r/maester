/**
 * The values `EXPO_TV` turns a prebuild to the TV with, exactly as `@react-native-tvos/config-tv`
 * reads it (getenv's `boolish`): no other spelling, case or padding. config-tv fails a prebuild
 * on any value but these, `0` and `false`, so every other one is a phone prebuild here.
 */
const TV_ON = ['1', 'true'] as const

/** Whether `EXPO_TV` asks for the Apple TV's or Android TV's native project. */
export const isTvPrebuild = ({ value }: { value: string | undefined }): boolean =>
  TV_ON.some((on) => on === value)
