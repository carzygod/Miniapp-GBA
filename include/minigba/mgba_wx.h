#ifndef MINIGBA_MGBA_WX_H
#define MINIGBA_MGBA_WX_H

#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

#if defined(__EMSCRIPTEN__)
#include <emscripten/emscripten.h>
#define MGBA_WX_EXPORT EMSCRIPTEN_KEEPALIVE
#else
#define MGBA_WX_EXPORT
#endif

#define MGBA_WX_ABI_VERSION 1u
#define MGBA_WX_VIDEO_WIDTH 240u
#define MGBA_WX_VIDEO_HEIGHT 160u
#define MGBA_WX_VIDEO_FORMAT_RGBA8888 1u

typedef enum MgbaWxStatus {
    MGBA_WX_OK = 0,
    MGBA_WX_INVALID_ARGUMENT = 1,
    MGBA_WX_INVALID_STATE = 2,
    MGBA_WX_OUT_OF_MEMORY = 3,
    MGBA_WX_INVALID_ROM = 4,
    MGBA_WX_BUFFER_TOO_SMALL = 5,
    MGBA_WX_UNSUPPORTED = 6,
    MGBA_WX_CORE_ERROR = 7
} MgbaWxStatus;

typedef enum MgbaWxKeyMask {
    MGBA_WX_KEY_A = 1u << 0,
    MGBA_WX_KEY_B = 1u << 1,
    MGBA_WX_KEY_SELECT = 1u << 2,
    MGBA_WX_KEY_START = 1u << 3,
    MGBA_WX_KEY_RIGHT = 1u << 4,
    MGBA_WX_KEY_LEFT = 1u << 5,
    MGBA_WX_KEY_UP = 1u << 6,
    MGBA_WX_KEY_DOWN = 1u << 7,
    MGBA_WX_KEY_R = 1u << 8,
    MGBA_WX_KEY_L = 1u << 9
} MgbaWxKeyMask;

typedef enum MgbaWxSaveType {
    MGBA_WX_SAVE_UNDETECTED = 0,
    MGBA_WX_SAVE_NONE = 1,
    MGBA_WX_SAVE_SRAM = 2,
    MGBA_WX_SAVE_FLASH_64K = 3,
    MGBA_WX_SAVE_FLASH_128K = 4,
    MGBA_WX_SAVE_EEPROM_8K = 5,
    MGBA_WX_SAVE_EEPROM_512 = 6,
    MGBA_WX_SAVE_SRAM_64K = 7
} MgbaWxSaveType;

typedef struct MgbaWxConfig {
    uint32_t struct_size;
    uint32_t audio_sample_rate;
    uint32_t audio_capacity_frames;
    uint32_t flags;
} MgbaWxConfig;

typedef struct MgbaWxVideoInfo {
    uintptr_t pixels_ptr;
    uint32_t width;
    uint32_t height;
    uint32_t stride_bytes;
    uint32_t format;
    uint64_t frame_number;
} MgbaWxVideoInfo;

typedef struct MgbaWxAudioInfo {
    uint32_t sample_rate;
    uint32_t channels;
    uint32_t queued_frames;
    uint32_t capacity_frames;
} MgbaWxAudioInfo;

typedef struct MgbaWxSaveInfo {
    uint32_t save_type;
    uint32_t size_bytes;
    uint64_t dirty_generation;
} MgbaWxSaveInfo;

MGBA_WX_EXPORT uint32_t mgba_wx_abi_version(void);
MGBA_WX_EXPORT uintptr_t mgba_wx_build_id_ptr(void);
MGBA_WX_EXPORT uint32_t mgba_wx_build_id_len(void);
MGBA_WX_EXPORT uintptr_t mgba_wx_last_error_ptr(void);
MGBA_WX_EXPORT uint32_t mgba_wx_last_error_len(void);

MGBA_WX_EXPORT MgbaWxStatus mgba_wx_create(uintptr_t config_ptr, uint32_t config_len);
MGBA_WX_EXPORT MgbaWxStatus mgba_wx_load_rom(uintptr_t rom_ptr, uint32_t rom_len);
MGBA_WX_EXPORT MgbaWxStatus mgba_wx_reset(void);
MGBA_WX_EXPORT MgbaWxStatus mgba_wx_run_frame(void);
MGBA_WX_EXPORT MgbaWxStatus mgba_wx_unload_rom(void);
MGBA_WX_EXPORT void mgba_wx_destroy(void);

MGBA_WX_EXPORT uintptr_t mgba_wx_alloc(uint32_t size, uint32_t alignment);
MGBA_WX_EXPORT void mgba_wx_free(uintptr_t ptr, uint32_t size, uint32_t alignment);

MGBA_WX_EXPORT MgbaWxStatus mgba_wx_video_info(uintptr_t out_ptr, uint32_t out_len);
MGBA_WX_EXPORT MgbaWxStatus mgba_wx_audio_info(uintptr_t out_ptr, uint32_t out_len);
MGBA_WX_EXPORT uint32_t mgba_wx_audio_read(uintptr_t dst_ptr, uint32_t max_frames);
MGBA_WX_EXPORT void mgba_wx_audio_clear(void);

MGBA_WX_EXPORT void mgba_wx_set_key_mask(uint32_t mask);
MGBA_WX_EXPORT uint32_t mgba_wx_get_key_mask(void);

MGBA_WX_EXPORT MgbaWxStatus mgba_wx_save_info(uintptr_t out_ptr, uint32_t out_len);
MGBA_WX_EXPORT MgbaWxStatus mgba_wx_load_save(uintptr_t src_ptr, uint32_t src_len);
MGBA_WX_EXPORT MgbaWxStatus mgba_wx_copy_save(uintptr_t dst_ptr, uint32_t dst_len);
MGBA_WX_EXPORT uint64_t mgba_wx_save_generation(void);

MGBA_WX_EXPORT uint32_t mgba_wx_state_max_size(void);
MGBA_WX_EXPORT MgbaWxStatus mgba_wx_state_write(uintptr_t dst_ptr, uint32_t dst_capacity, uintptr_t written_size_ptr);
MGBA_WX_EXPORT MgbaWxStatus mgba_wx_state_read(uintptr_t src_ptr, uint32_t src_len);

#ifdef __cplusplus
}
#endif

#endif
