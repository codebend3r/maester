/// <reference types="vite/client" />

declare module '*.module.scss' {
  const classes: Record<string, string>
  export default classes
}

// The @fontsource packages ship CSS with no type declarations. tsgo rejects
// untyped side-effect imports (TS2882), so name them here.
declare module '@fontsource/*' {}
declare module '@fontsource-variable/*' {}
