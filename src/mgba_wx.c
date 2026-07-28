#include <minigba/mgba_wx.h>

#include "audio_ring.h"

#include <mgba-util/vfs.h>
#include <mgba/core/blip_buf.h>
#include <mgba/core/config.h>
#include <mgba/core/core.h>
#include <mgba/internal/gba/gba.h>
#include <mgba/internal/gba/savedata.h>

#include <stdbool.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#ifndef MGBA_WX_BUILD_ID
#define MGBA_WX_BUILD_ID "mgba-0.10.5-dev"
#endif

#define MGBA_WX_MAX_ROM_BYTES (32u * 1024u * 1024u)
#define MGBA_WX_DEFAULT_AUDIO_RATE 48000u
#define MGBA_WX_DEFAULT_AUDIO_CAPACITY 4096u
#define MGBA_WX_MAX_AUDIO_CAPACITY 32768u
#define MGBA_WX_AUDIO_CHUNK 2048u
#define MGBA_WX_KEY_MASK 0x3FFu

typedef struct Allocation {
    void* raw;
    uintptr_t aligned;
    uint32_t size;
    uint32_t alignment;
    struct Allocation* next;
} Allocation;

typedef struct Runtime {
    bool created;
    bool rom_loaded;
    bool frame_started;
    struct mCore* core;
    uint8_t* rom_data;
    uint32_t rom_size;
    uint8_t* save_backing;
    uint32_t save_backing_size;
    uint32_t* framebuffer;
    uint64_t frame_number;
    uint64_t save_generation;
    uint32_t key_mask;
    uint32_t sample_rate;
    MgbaWxAudioRing audio;
    struct mCoreCallbacks callbacks;
} Runtime;

static Runtime g_runtime;
static Allocation* g_allocations;
static char g_last_error[256];
static const char g_build_id[] = MGBA_WX_BUILD_ID;

_Static_assert(sizeof(MgbaWxConfig) == 16, "MgbaWxConfig ABI changed");
_Static_assert(sizeof(MgbaWxAudioInfo) == 16, "MgbaWxAudioInfo ABI changed");
_Static_assert(sizeof(MgbaWxSaveInfo) == 16, "MgbaWxSaveInfo ABI changed");
#if UINTPTR_MAX == UINT32_MAX
_Static_assert(sizeof(MgbaWxVideoInfo) == 32, "MgbaWxVideoInfo WASM ABI changed");
#endif

static MgbaWxStatus set_error(MgbaWxStatus status, const char* message) {
    snprintf(g_last_error, sizeof(g_last_error), "%s", message ? message : "");
    return status;
}

static void clear_error(void) {
    g_last_error[0] = '\0';
}

static bool is_power_of_two(uint32_t value) {
    return value && !(value & (value - 1));
}

static bool allocation_contains(uintptr_t ptr, size_t size) {
    if (!ptr || size > UINTPTR_MAX - ptr) {
        return false;
    }
    uintptr_t end = ptr + size;
    for (Allocation* allocation = g_allocations; allocation; allocation = allocation->next) {
        uintptr_t allocation_end = allocation->aligned + allocation->size;
        if (ptr >= allocation->aligned && end <= allocation_end) {
            return true;
        }
    }
    return false;
}

static void release_allocations(void) {
    while (g_allocations) {
        Allocation* next = g_allocations->next;
        free(g_allocations->raw);
        free(g_allocations);
        g_allocations = next;
    }
}

static void savedata_updated(void* context) {
    Runtime* runtime = context;
    ++runtime->save_generation;
}

static void unload_core(void) {
    if (g_runtime.core) {
        g_runtime.core->clearCoreCallbacks(g_runtime.core);
        mCoreConfigDeinit(&g_runtime.core->config);
        g_runtime.core->deinit(g_runtime.core);
    }
    free(g_runtime.rom_data);
    free(g_runtime.save_backing);
    g_runtime.core = NULL;
    g_runtime.rom_data = NULL;
    g_runtime.rom_size = 0;
    g_runtime.save_backing = NULL;
    g_runtime.save_backing_size = 0;
    g_runtime.rom_loaded = false;
    g_runtime.frame_started = false;
    g_runtime.frame_number = 0;
    g_runtime.save_generation = 0;
    g_runtime.key_mask = 0;
    mgba_wx_audio_ring_clear(&g_runtime.audio);
}

static void drain_audio(void) {
    blip_t* left = g_runtime.core->getAudioChannel(g_runtime.core, 0);
    blip_t* right = g_runtime.core->getAudioChannel(g_runtime.core, 1);
    if (!left || !right) {
        return;
    }
    int16_t buffer[MGBA_WX_AUDIO_CHUNK * 2];
    int available = blip_samples_avail(left);
    while (available > 0) {
        int requested = available > (int) MGBA_WX_AUDIO_CHUNK ? (int) MGBA_WX_AUDIO_CHUNK : available;
        int produced = blip_read_samples(left, buffer, requested, true);
        int right_produced = blip_read_samples(right, buffer + 1, requested, true);
        if (produced <= 0 || right_produced != produced) {
            break;
        }
        mgba_wx_audio_ring_write(&g_runtime.audio, buffer, (size_t) produced);
        available = blip_samples_avail(left);
    }
}

uint32_t mgba_wx_abi_version(void) {
    return MGBA_WX_ABI_VERSION;
}

uintptr_t mgba_wx_build_id_ptr(void) {
    return (uintptr_t) g_build_id;
}

uint32_t mgba_wx_build_id_len(void) {
    return (uint32_t) (sizeof(g_build_id) - 1);
}

uintptr_t mgba_wx_last_error_ptr(void) {
    return (uintptr_t) g_last_error;
}

uint32_t mgba_wx_last_error_len(void) {
    return (uint32_t) strlen(g_last_error);
}

MgbaWxStatus mgba_wx_create(uintptr_t config_ptr, uint32_t config_len) {
    if (g_runtime.created) {
        return set_error(MGBA_WX_INVALID_STATE, "runtime already created");
    }
    MgbaWxConfig config = { sizeof(config), MGBA_WX_DEFAULT_AUDIO_RATE, MGBA_WX_DEFAULT_AUDIO_CAPACITY, 0 };
    if (config_ptr || config_len) {
        if (config_len < sizeof(config) || !allocation_contains(config_ptr, sizeof(config))) {
            return set_error(MGBA_WX_INVALID_ARGUMENT, "invalid config buffer");
        }
        memcpy(&config, (const void*) config_ptr, sizeof(config));
        if (config.struct_size < sizeof(config)) {
            return set_error(MGBA_WX_INVALID_ARGUMENT, "unsupported config size");
        }
    }
    if (config.audio_sample_rate < 8000 || config.audio_sample_rate > 96000 ||
        config.audio_capacity_frames < 256 || config.audio_capacity_frames > MGBA_WX_MAX_AUDIO_CAPACITY || config.flags) {
        return set_error(MGBA_WX_INVALID_ARGUMENT, "unsupported runtime configuration");
    }
    memset(&g_runtime, 0, sizeof(g_runtime));
    g_runtime.framebuffer = calloc(MGBA_WX_VIDEO_WIDTH * MGBA_WX_VIDEO_HEIGHT, sizeof(uint32_t));
    if (!g_runtime.framebuffer || !mgba_wx_audio_ring_init(&g_runtime.audio, config.audio_capacity_frames)) {
        free(g_runtime.framebuffer);
        memset(&g_runtime, 0, sizeof(g_runtime));
        return set_error(MGBA_WX_OUT_OF_MEMORY, "runtime buffer allocation failed");
    }
    g_runtime.sample_rate = config.audio_sample_rate;
    g_runtime.created = true;
    clear_error();
    return MGBA_WX_OK;
}

MgbaWxStatus mgba_wx_load_rom(uintptr_t rom_ptr, uint32_t rom_len) {
    if (!g_runtime.created) {
        return set_error(MGBA_WX_INVALID_STATE, "runtime is not created");
    }
    if (rom_len < 0xC0 || rom_len > MGBA_WX_MAX_ROM_BYTES || !allocation_contains(rom_ptr, rom_len)) {
        return set_error(MGBA_WX_INVALID_ARGUMENT, "invalid ROM buffer");
    }
    unload_core();
    g_runtime.rom_data = malloc(rom_len);
    if (!g_runtime.rom_data) {
        return set_error(MGBA_WX_OUT_OF_MEMORY, "ROM allocation failed");
    }
    memcpy(g_runtime.rom_data, (const void*) rom_ptr, rom_len);
    g_runtime.rom_size = rom_len;
    struct VFile* rom = VFileFromMemory(g_runtime.rom_data, rom_len);
    if (!rom) {
        unload_core();
        return set_error(MGBA_WX_OUT_OF_MEMORY, "ROM virtual file allocation failed");
    }
    g_runtime.core = mCoreFindVF(rom);
    if (!g_runtime.core || g_runtime.core->platform(g_runtime.core) != mPLATFORM_GBA) {
        if (g_runtime.core) {
            g_runtime.core->deinit(g_runtime.core);
            g_runtime.core = NULL;
        }
        rom->close(rom);
        unload_core();
        return set_error(MGBA_WX_INVALID_ROM, "content is not a supported GBA ROM");
    }
    mCoreInitConfig(g_runtime.core, NULL);
    if (!g_runtime.core->init(g_runtime.core)) {
        rom->close(rom);
        unload_core();
        return set_error(MGBA_WX_CORE_ERROR, "mGBA initialization failed");
    }
    g_runtime.core->setVideoBuffer(g_runtime.core, (color_t*) g_runtime.framebuffer, MGBA_WX_VIDEO_WIDTH);
    g_runtime.core->setAudioBufferSize(g_runtime.core, MGBA_WX_AUDIO_CHUNK);
    blip_set_rates(g_runtime.core->getAudioChannel(g_runtime.core, 0), g_runtime.core->frequency(g_runtime.core), g_runtime.sample_rate);
    blip_set_rates(g_runtime.core->getAudioChannel(g_runtime.core, 1), g_runtime.core->frequency(g_runtime.core), g_runtime.sample_rate);
    memset(&g_runtime.callbacks, 0, sizeof(g_runtime.callbacks));
    g_runtime.callbacks.context = &g_runtime;
    g_runtime.callbacks.savedataUpdated = savedata_updated;
    g_runtime.core->addCoreCallbacks(g_runtime.core, &g_runtime.callbacks);
    if (!g_runtime.core->loadROM(g_runtime.core, rom)) {
        rom->close(rom);
        unload_core();
        return set_error(MGBA_WX_INVALID_ROM, "mGBA rejected the ROM");
    }
    g_runtime.core->reset(g_runtime.core);
    g_runtime.rom_loaded = true;
    clear_error();
    return MGBA_WX_OK;
}

MgbaWxStatus mgba_wx_reset(void) {
    if (!g_runtime.rom_loaded) {
        return set_error(MGBA_WX_INVALID_STATE, "no ROM is loaded");
    }
    g_runtime.core->reset(g_runtime.core);
    g_runtime.frame_number = 0;
    g_runtime.frame_started = false;
    mgba_wx_audio_ring_clear(&g_runtime.audio);
    clear_error();
    return MGBA_WX_OK;
}

MgbaWxStatus mgba_wx_run_frame(void) {
    if (!g_runtime.rom_loaded) {
        return set_error(MGBA_WX_INVALID_STATE, "no ROM is loaded");
    }
    g_runtime.frame_started = true;
    g_runtime.core->setKeys(g_runtime.core, g_runtime.key_mask);
    g_runtime.core->runFrame(g_runtime.core);
    drain_audio();
    for (size_t i = 0; i < MGBA_WX_VIDEO_WIDTH * MGBA_WX_VIDEO_HEIGHT; ++i) {
        g_runtime.framebuffer[i] |= 0xFF000000u;
    }
    ++g_runtime.frame_number;
    clear_error();
    return MGBA_WX_OK;
}

MgbaWxStatus mgba_wx_unload_rom(void) {
    if (!g_runtime.created) {
        return set_error(MGBA_WX_INVALID_STATE, "runtime is not created");
    }
    unload_core();
    clear_error();
    return MGBA_WX_OK;
}

void mgba_wx_destroy(void) {
    unload_core();
    free(g_runtime.framebuffer);
    mgba_wx_audio_ring_deinit(&g_runtime.audio);
    memset(&g_runtime, 0, sizeof(g_runtime));
    release_allocations();
    clear_error();
}

uintptr_t mgba_wx_alloc(uint32_t size, uint32_t alignment) {
    if (!size || !is_power_of_two(alignment) || alignment > 4096) {
        set_error(MGBA_WX_INVALID_ARGUMENT, "invalid allocation size or alignment");
        return 0;
    }
    if ((size_t) size > SIZE_MAX - alignment) {
        set_error(MGBA_WX_OUT_OF_MEMORY, "allocation size overflow");
        return 0;
    }
    Allocation* allocation = calloc(1, sizeof(*allocation));
    void* raw = malloc((size_t) size + alignment - 1);
    if (!allocation || !raw) {
        free(allocation);
        free(raw);
        set_error(MGBA_WX_OUT_OF_MEMORY, "allocation failed");
        return 0;
    }
    uintptr_t aligned = ((uintptr_t) raw + alignment - 1) & ~((uintptr_t) alignment - 1);
    allocation->raw = raw;
    allocation->aligned = aligned;
    allocation->size = size;
    allocation->alignment = alignment;
    allocation->next = g_allocations;
    g_allocations = allocation;
    clear_error();
    return aligned;
}

void mgba_wx_free(uintptr_t ptr, uint32_t size, uint32_t alignment) {
    Allocation** cursor = &g_allocations;
    while (*cursor) {
        Allocation* allocation = *cursor;
        if (allocation->aligned == ptr) {
            if (allocation->size != size || allocation->alignment != alignment) {
                set_error(MGBA_WX_INVALID_ARGUMENT, "allocation metadata mismatch");
                return;
            }
            *cursor = allocation->next;
            free(allocation->raw);
            free(allocation);
            clear_error();
            return;
        }
        cursor = &allocation->next;
    }
    set_error(MGBA_WX_INVALID_ARGUMENT, "unknown allocation");
}

MgbaWxStatus mgba_wx_video_info(uintptr_t out_ptr, uint32_t out_len) {
    if (!g_runtime.created || !allocation_contains(out_ptr, sizeof(MgbaWxVideoInfo)) || out_len < sizeof(MgbaWxVideoInfo)) {
        return set_error(MGBA_WX_INVALID_ARGUMENT, "invalid video info buffer");
    }
    MgbaWxVideoInfo info = { (uintptr_t) g_runtime.framebuffer, MGBA_WX_VIDEO_WIDTH, MGBA_WX_VIDEO_HEIGHT,
        MGBA_WX_VIDEO_WIDTH * sizeof(uint32_t), MGBA_WX_VIDEO_FORMAT_RGBA8888, g_runtime.frame_number };
    memcpy((void*) out_ptr, &info, sizeof(info));
    clear_error();
    return MGBA_WX_OK;
}

MgbaWxStatus mgba_wx_audio_info(uintptr_t out_ptr, uint32_t out_len) {
    if (!g_runtime.created || !allocation_contains(out_ptr, sizeof(MgbaWxAudioInfo)) || out_len < sizeof(MgbaWxAudioInfo)) {
        return set_error(MGBA_WX_INVALID_ARGUMENT, "invalid audio info buffer");
    }
    MgbaWxAudioInfo info = { g_runtime.sample_rate, 2, (uint32_t) g_runtime.audio.queued_frames, (uint32_t) g_runtime.audio.capacity_frames };
    memcpy((void*) out_ptr, &info, sizeof(info));
    clear_error();
    return MGBA_WX_OK;
}

uint32_t mgba_wx_audio_read(uintptr_t dst_ptr, uint32_t max_frames) {
    if (!g_runtime.created || max_frames > SIZE_MAX / (2 * sizeof(int16_t))) {
        set_error(MGBA_WX_INVALID_ARGUMENT, "invalid audio output buffer");
        return 0;
    }
    size_t bytes = (size_t) max_frames * 2 * sizeof(int16_t);
    if (!allocation_contains(dst_ptr, bytes)) {
        set_error(MGBA_WX_INVALID_ARGUMENT, "invalid audio output buffer");
        return 0;
    }
    uint32_t read = (uint32_t) mgba_wx_audio_ring_read(&g_runtime.audio, (int16_t*) dst_ptr, max_frames);
    clear_error();
    return read;
}

void mgba_wx_audio_clear(void) {
    mgba_wx_audio_ring_clear(&g_runtime.audio);
}

void mgba_wx_set_key_mask(uint32_t mask) {
    g_runtime.key_mask = mask & MGBA_WX_KEY_MASK;
    if (g_runtime.core) {
        g_runtime.core->setKeys(g_runtime.core, g_runtime.key_mask);
    }
}

uint32_t mgba_wx_get_key_mask(void) {
    return g_runtime.key_mask;
}

MgbaWxStatus mgba_wx_save_info(uintptr_t out_ptr, uint32_t out_len) {
    if (!g_runtime.rom_loaded) {
        return set_error(MGBA_WX_INVALID_STATE, "no ROM is loaded");
    }
    if (!allocation_contains(out_ptr, sizeof(MgbaWxSaveInfo)) || out_len < sizeof(MgbaWxSaveInfo)) {
        return set_error(MGBA_WX_INVALID_ARGUMENT, "invalid save info buffer");
    }
    struct GBA* gba = g_runtime.core->board;
    MgbaWxSaveInfo info = { (uint32_t) (gba->memory.savedata.type + 1), (uint32_t) GBASavedataSize(&gba->memory.savedata), g_runtime.save_generation };
    memcpy((void*) out_ptr, &info, sizeof(info));
    clear_error();
    return MGBA_WX_OK;
}

MgbaWxStatus mgba_wx_load_save(uintptr_t src_ptr, uint32_t src_len) {
    if (!g_runtime.rom_loaded || g_runtime.frame_started) {
        return set_error(MGBA_WX_INVALID_STATE, "save data must be loaded before the first frame");
    }
    if (!src_len || src_len > 1024u * 1024u || !allocation_contains(src_ptr, src_len)) {
        return set_error(MGBA_WX_INVALID_ARGUMENT, "invalid save buffer");
    }
    uint8_t* copy = malloc(src_len);
    if (!copy) {
        return set_error(MGBA_WX_OUT_OF_MEMORY, "save allocation failed");
    }
    memcpy(copy, (const void*) src_ptr, src_len);
    struct VFile* file = VFileFromMemory(copy, src_len);
    if (!file) {
        free(copy);
        return set_error(MGBA_WX_OUT_OF_MEMORY, "save virtual file allocation failed");
    }
    if (!g_runtime.core->loadSave(g_runtime.core, file)) {
        file->close(file);
        free(copy);
        return set_error(MGBA_WX_CORE_ERROR, "mGBA rejected save data");
    }
    free(g_runtime.save_backing);
    g_runtime.save_backing = copy;
    g_runtime.save_backing_size = src_len;
    clear_error();
    return MGBA_WX_OK;
}

MgbaWxStatus mgba_wx_copy_save(uintptr_t dst_ptr, uint32_t dst_len) {
    if (!g_runtime.rom_loaded) {
        return set_error(MGBA_WX_INVALID_STATE, "no ROM is loaded");
    }
    void* copy = NULL;
    size_t size = g_runtime.core->savedataClone(g_runtime.core, &copy);
    if (!size || !copy) {
        free(copy);
        return set_error(MGBA_WX_UNSUPPORTED, "the ROM has no detected save data");
    }
    if (dst_len < size || !allocation_contains(dst_ptr, size)) {
        free(copy);
        return set_error(MGBA_WX_BUFFER_TOO_SMALL, "save output buffer is too small");
    }
    memcpy((void*) dst_ptr, copy, size);
    free(copy);
    clear_error();
    return MGBA_WX_OK;
}

uint64_t mgba_wx_save_generation(void) {
    return g_runtime.save_generation;
}

uint32_t mgba_wx_state_max_size(void) {
    if (!g_runtime.rom_loaded) {
        return 0;
    }
    size_t size = g_runtime.core->stateSize(g_runtime.core);
    return size > UINT32_MAX ? 0 : (uint32_t) size;
}

MgbaWxStatus mgba_wx_state_write(uintptr_t dst_ptr, uint32_t dst_capacity, uintptr_t written_size_ptr) {
    if (!g_runtime.rom_loaded) {
        return set_error(MGBA_WX_INVALID_STATE, "no ROM is loaded");
    }
    uint32_t size = mgba_wx_state_max_size();
    if (!size) {
        return set_error(MGBA_WX_UNSUPPORTED, "state serialization is unavailable");
    }
    if (dst_capacity < size || !allocation_contains(dst_ptr, size) || !allocation_contains(written_size_ptr, sizeof(uint32_t))) {
        return set_error(MGBA_WX_BUFFER_TOO_SMALL, "state output buffer is too small");
    }
    if (!g_runtime.core->saveState(g_runtime.core, (void*) dst_ptr)) {
        return set_error(MGBA_WX_CORE_ERROR, "mGBA state serialization failed");
    }
    memcpy((void*) written_size_ptr, &size, sizeof(size));
    clear_error();
    return MGBA_WX_OK;
}

MgbaWxStatus mgba_wx_state_read(uintptr_t src_ptr, uint32_t src_len) {
    if (!g_runtime.rom_loaded) {
        return set_error(MGBA_WX_INVALID_STATE, "no ROM is loaded");
    }
    uint32_t expected = mgba_wx_state_max_size();
    if (src_len != expected || !allocation_contains(src_ptr, src_len)) {
        return set_error(MGBA_WX_INVALID_ARGUMENT, "state size does not match this core build");
    }
    if (!g_runtime.core->loadState(g_runtime.core, (const void*) src_ptr)) {
        return set_error(MGBA_WX_CORE_ERROR, "mGBA state restore failed");
    }
    mgba_wx_audio_ring_clear(&g_runtime.audio);
    clear_error();
    return MGBA_WX_OK;
}
