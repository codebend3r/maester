cmake_minimum_required(VERSION 3.24)
project(raven_mpv LANGUAGES CXX)
set(CMAKE_CXX_STANDARD 17)
execute_process(COMMAND node -p "require('node-addon-api').include"
  WORKING_DIRECTORY "${CMAKE_CURRENT_SOURCE_DIR}/.."
  OUTPUT_VARIABLE NAPI_INCLUDE OUTPUT_STRIP_TRAILING_WHITESPACE COMMAND_ERROR_IS_FATAL ANY)
string(REPLACE "\"" "" NAPI_INCLUDE "${NAPI_INCLUDE}")

if(APPLE AND CMAKE_SYSTEM_PROCESSOR MATCHES "^(arm64|aarch64)$")
  # macOS arm64: the source-built libmpv and MoltenVK, a CAMetalLayer surface.
  enable_language(OBJCXX)
  set(CMAKE_OBJCXX_STANDARD 17)
  set(CMAKE_OSX_ARCHITECTURES arm64)
  set(CMAKE_OSX_DEPLOYMENT_TARGET 12.0)
  set(RESOURCES "${CMAKE_CURRENT_SOURCE_DIR}/../resources/darwin-arm64")
  if(NOT EXISTS "${RESOURCES}/lib/libmpv.2.dylib")
    message(FATAL_ERROR "Run the @raven/mpv fetch:libmpv target first. Host libmpv is never used.")
  endif()
  add_library(raven_mpv SHARED addon.cpp surface_mac.mm ${CMAKE_JS_SRC})
  set_target_properties(raven_mpv PROPERTIES PREFIX "" SUFFIX ".node"
    LIBRARY_OUTPUT_DIRECTORY "${RESOURCES}"
    BUILD_WITH_INSTALL_RPATH TRUE INSTALL_RPATH "@loader_path/lib"
    BUILD_WITH_INSTALL_NAME_DIR TRUE INSTALL_NAME_DIR "@rpath")
  target_include_directories(raven_mpv PRIVATE ${CMAKE_JS_INC} "${NAPI_INCLUDE}"
    "${CMAKE_CURRENT_SOURCE_DIR}/../native-build/prefix/include")
  target_compile_definitions(raven_mpv PRIVATE NAPI_VERSION=8 NAPI_CPP_EXCEPTIONS)
  target_compile_options(raven_mpv PRIVATE -fobjc-arc -fexceptions -Wall -Wextra -Wno-unused-parameter)
  target_link_libraries(raven_mpv PRIVATE ${CMAKE_JS_LIB} "${RESOURCES}/lib/libmpv.2.dylib"
    "-framework Cocoa" "-framework QuartzCore" "-framework CoreGraphics")
elseif(WIN32 AND CMAKE_SIZEOF_VOID_P EQUAL 8)
  # Windows x64: the pinned prebuilt libmpv-2.dll, the BrowserWindow's HWND as the surface.
  # The DLL came from MinGW, so its import library is made here from the export list
  # buildAddon.ts writes (RAVEN_LIBMPV_DEF), and the addon loads the DLL beside itself.
  set(RESOURCES "${CMAKE_CURRENT_SOURCE_DIR}/../resources/win32-x64")
  if(NOT EXISTS "${RESOURCES}/libmpv-2.dll")
    message(FATAL_ERROR "Run the @raven/mpv fetch:libmpv:windows target first.")
  endif()
  if(NOT DEFINED RAVEN_LIBMPV_DEF OR NOT EXISTS "${RAVEN_LIBMPV_DEF}")
    message(FATAL_ERROR "RAVEN_LIBMPV_DEF must name libmpv's export list; buildAddon.ts writes it.")
  endif()
  set(LIBMPV_IMPORT "${CMAKE_CURRENT_BINARY_DIR}/libmpv-2.lib")
  add_custom_command(OUTPUT "${LIBMPV_IMPORT}"
    COMMAND "${CMAKE_AR}" /nologo "/def:${RAVEN_LIBMPV_DEF}" /machine:x64 "/out:${LIBMPV_IMPORT}"
    DEPENDS "${RAVEN_LIBMPV_DEF}" COMMENT "Import library for libmpv-2.dll")
  add_custom_target(libmpv_import DEPENDS "${LIBMPV_IMPORT}")
  add_library(raven_mpv SHARED addon.cpp surface_win.cpp ${CMAKE_JS_SRC})
  add_dependencies(raven_mpv libmpv_import)
  set_target_properties(raven_mpv PROPERTIES PREFIX "" SUFFIX ".node"
    RUNTIME_OUTPUT_DIRECTORY "${RESOURCES}" RUNTIME_OUTPUT_DIRECTORY_RELEASE "${RESOURCES}"
    LIBRARY_OUTPUT_DIRECTORY "${RESOURCES}" LIBRARY_OUTPUT_DIRECTORY_RELEASE "${RESOURCES}")
  target_include_directories(raven_mpv PRIVATE ${CMAKE_JS_INC} "${NAPI_INCLUDE}" "${RESOURCES}/include")
  target_compile_definitions(raven_mpv PRIVATE NAPI_VERSION=8 NAPI_CPP_EXCEPTIONS
    WIN32_LEAN_AND_MEAN NOMINMAX _CRT_SECURE_NO_WARNINGS)
  target_compile_options(raven_mpv PRIVATE /EHsc /W3)
  # delayimp resolves the delay-load helper that cmake-js's /DELAYLOAD:NODE.EXE hook needs.
  target_link_libraries(raven_mpv PRIVATE ${CMAKE_JS_LIB} "${LIBMPV_IMPORT}" user32 gdi32 delayimp)
else()
  message(FATAL_ERROR "raven mpv supports macOS arm64 and Windows x64 only")
endif()
