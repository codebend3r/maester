cmake_minimum_required(VERSION 3.24)
project(raven_mpv LANGUAGES CXX OBJCXX)
if(NOT APPLE OR NOT CMAKE_SYSTEM_PROCESSOR MATCHES "^(arm64|aarch64)$")
  message(FATAL_ERROR "raven mpv currently supports macOS arm64 only")
endif()
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_OBJCXX_STANDARD 17)
set(CMAKE_OSX_ARCHITECTURES arm64)
set(CMAKE_OSX_DEPLOYMENT_TARGET 12.0)
set(RESOURCES "${CMAKE_CURRENT_SOURCE_DIR}/../resources/darwin-arm64")
if(NOT EXISTS "${RESOURCES}/lib/libmpv.2.dylib")
  message(FATAL_ERROR "Run the @raven/mpv fetch:libmpv target first. Host libmpv is never used.")
endif()
execute_process(COMMAND node -p "require('node-addon-api').include"
  WORKING_DIRECTORY "${CMAKE_CURRENT_SOURCE_DIR}/.."
  OUTPUT_VARIABLE NAPI_INCLUDE OUTPUT_STRIP_TRAILING_WHITESPACE COMMAND_ERROR_IS_FATAL ANY)
string(REPLACE "\"" "" NAPI_INCLUDE "${NAPI_INCLUDE}")
add_library(raven_mpv SHARED addon.mm surface.mm ${CMAKE_JS_SRC})
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
