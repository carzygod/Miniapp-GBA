cmake_minimum_required(VERSION 3.22)
project(minigba_core VERSION 0.1.0 LANGUAGES C CXX)

set(CMAKE_C_STANDARD 11)
set(CMAKE_C_STANDARD_REQUIRED ON)
set(CMAKE_C_EXTENSIONS OFF)

set(BUILD_STATIC ON CACHE BOOL "" FORCE)
set(BUILD_SHARED OFF CACHE BOOL "" FORCE)
set(DISABLE_FRONTENDS ON CACHE BOOL "" FORCE)
set(DISABLE_DEPS ON CACHE BOOL "" FORCE)
set(M_CORE_GBA ON CACHE BOOL "" FORCE)
set(M_CORE_GB OFF CACHE BOOL "" FORCE)
set(MINIMAL_CORE 2 CACHE STRING "" FORCE)
set(ENABLE_EXTRA OFF CACHE BOOL "" FORCE)
set(USE_PTHREADS OFF CACHE BOOL "" FORCE)
set(USE_DEBUGGERS OFF CACHE BOOL "" FORCE)
set(USE_GDB_STUB OFF CACHE BOOL "" FORCE)
set(USE_FFMPEG OFF CACHE BOOL "" FORCE)
set(USE_ZLIB OFF CACHE BOOL "" FORCE)
set(USE_MINIZIP OFF CACHE BOOL "" FORCE)
set(USE_PNG OFF CACHE BOOL "" FORCE)
set(USE_LIBZIP OFF CACHE BOOL "" FORCE)
set(USE_SQLITE3 OFF CACHE BOOL "" FORCE)
set(USE_ELF OFF CACHE BOOL "" FORCE)
set(USE_LUA OFF CACHE BOOL "" FORCE)
set(USE_LZMA OFF CACHE BOOL "" FORCE)
set(USE_DISCORD_RPC OFF CACHE BOOL "" FORCE)
set(BUILD_GL OFF CACHE BOOL "" FORCE)
set(BUILD_GLES2 OFF CACHE BOOL "" FORCE)
set(BUILD_GLES3 OFF CACHE BOOL "" FORCE)
set(BUILD_QT OFF CACHE BOOL "" FORCE)
set(BUILD_SDL OFF CACHE BOOL "" FORCE)
set(BUILD_TEST OFF CACHE BOOL "" FORCE)
set(BUILD_SUITE OFF CACHE BOOL "" FORCE)
set(BUILD_CINEMA OFF CACHE BOOL "" FORCE)
set(BUILD_ROM_TEST OFF CACHE BOOL "" FORCE)
set(BUILD_EXAMPLE OFF CACHE BOOL "" FORCE)
set(BUILD_PYTHON OFF CACHE BOOL "" FORCE)
set(BUILD_LIBRETRO OFF CACHE BOOL "" FORCE)
set(BUILD_LTO OFF CACHE BOOL "" FORCE)

add_compile_definitions(MINIMAL_CORE=2 DISABLE_THREADING MGBA_STANDALONE)
if(EMSCRIPTEN)
    # mGBA treats every CMake UNIX platform as pthread-capable. WXWebAssembly
    # cannot use shared memory, so select mGBA's generic malloc/VFile backend.
    set(MINIGBA_SAVED_UNIX "${UNIX}")
    set(UNIX FALSE)
    add_compile_definitions(_GNU_SOURCE)
endif()
add_subdirectory(vendor/mgba EXCLUDE_FROM_ALL)
if(EMSCRIPTEN)
    set(UNIX "${MINIGBA_SAVED_UNIX}")
endif()

add_library(minigba_core STATIC src/mgba_wx.c src/audio_ring.c)
target_include_directories(minigba_core PUBLIC include PRIVATE src)
target_link_libraries(minigba_core PUBLIC mgba)
target_compile_options(minigba_core PRIVATE
    $<$<C_COMPILER_ID:GNU,Clang>:-Wall;-Wextra;-Wconversion;-Wshadow;-Werror=return-type>
)
target_compile_definitions(minigba_core PRIVATE MGBA_WX_BUILD_ID="mgba-0.10.5-${PROJECT_VERSION}")

if(EMSCRIPTEN)
    add_executable(minigba-core-wasm src/wasm_entry.c)
    target_link_libraries(minigba-core-wasm PRIVATE minigba_core)
    set_target_properties(minigba-core-wasm PROPERTIES OUTPUT_NAME "minigba-core" SUFFIX ".wasm")
    set(MINIGBA_EXPORTED_FUNCTIONS
        "['_mgba_wx_abi_version','_mgba_wx_build_id_ptr','_mgba_wx_build_id_len','_mgba_wx_last_error_ptr','_mgba_wx_last_error_len','_mgba_wx_create','_mgba_wx_load_rom','_mgba_wx_reset','_mgba_wx_run_frame','_mgba_wx_unload_rom','_mgba_wx_destroy','_mgba_wx_alloc','_mgba_wx_free','_mgba_wx_video_info','_mgba_wx_audio_info','_mgba_wx_audio_read','_mgba_wx_audio_clear','_mgba_wx_set_key_mask','_mgba_wx_get_key_mask','_mgba_wx_save_info','_mgba_wx_load_save','_mgba_wx_copy_save','_mgba_wx_save_generation','_mgba_wx_state_max_size','_mgba_wx_state_write','_mgba_wx_state_read']")
    target_link_options(minigba-core-wasm PRIVATE
        --no-entry
        -sSTANDALONE_WASM=1
        -sFILESYSTEM=0
        -sALLOW_MEMORY_GROWTH=1
        -sINITIAL_MEMORY=67108864
        -sMAXIMUM_MEMORY=268435456
        -sSTACK_SIZE=1048576
        -sMALLOC=emmalloc
        -sWASM_BIGINT=1
        "-sEXPORTED_FUNCTIONS=${MINIGBA_EXPORTED_FUNCTIONS}"
    )
else()
    include(CTest)
    if(BUILD_TESTING)
        add_executable(test_audio_ring tests/test_audio_ring.c src/audio_ring.c)
        target_include_directories(test_audio_ring PRIVATE src)
        add_test(NAME audio_ring COMMAND test_audio_ring)

        add_executable(test_abi tests/test_abi.c)
        target_link_libraries(test_abi PRIVATE minigba_core)
        add_test(NAME abi COMMAND test_abi)
    endif()
endif()
