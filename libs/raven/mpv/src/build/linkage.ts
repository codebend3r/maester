/**
 * Static libraries libmpv must link by name. libplacebo's generated pkg-config file
 * names only glslang's empty compatibility archives (SPIRV, MachineIndependent,
 * OSDependent, GenericCodeGen): its meson searches for `glslang` and
 * `glslang-default-resource-limits` without the `vulkan-sdk` directory, so neither is
 * found, and it never names the C++ runtime its glslang wrapper needs.
 */
export const libmpvLinkLibraries = ['glslang', 'glslang-default-resource-limits', 'c++'] as const

/** The search paths a bundled library or the addon may carry: beside itself, or its `lib`. */
export const RPATHS = { loaderPath: '@loader_path', loaderPathLib: '@loader_path/lib' } as const

type WithLinkLibrariesProps<T extends { LDFLAGS: string }> = {
  env: T
  libraries: readonly string[]
}

export const withLinkLibraries = <T extends { LDFLAGS: string }>({
  env,
  libraries,
}: WithLinkLibrariesProps<T>) => ({
  ...env,
  LDFLAGS: [env.LDFLAGS, ...libraries.map((library) => `-l${library}`)].join(' '),
})
