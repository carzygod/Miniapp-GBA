#include <minigba/mgba_wx.h>

#include <assert.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>

static uintptr_t make_test_rom(uint32_t size) {
    uintptr_t pointer = mgba_wx_alloc(size, 16);
    assert(pointer);
    uint8_t* rom = (uint8_t*) pointer;
    memset(rom, 0, size);
    // Branch over the GBA header to a stable ARM loop at 0xC0.
    rom[0] = 0x2E;
    rom[1] = 0x00;
    rom[2] = 0x00;
    rom[3] = 0xEA;
    memcpy(rom + 0xA0, "MINIGBA TEST", 12);
    memcpy(rom + 0xAC, "MGTE", 4);
    rom[0xB2] = 0x96;
    rom[0xC0] = 0xFE;
    rom[0xC1] = 0xFF;
    rom[0xC2] = 0xFF;
    rom[0xC3] = 0xEA;
    uint8_t checksum = 0;
    for (uint32_t offset = 0xA0; offset <= 0xBC; ++offset) {
        checksum -= rom[offset];
    }
    rom[0xBD] = checksum - 0x19;
    return pointer;
}

int main(void) {
    assert(mgba_wx_abi_version() == MGBA_WX_ABI_VERSION);
    assert(mgba_wx_build_id_len() > 0);
    assert(mgba_wx_run_frame() == MGBA_WX_INVALID_STATE);

    uintptr_t config_ptr = mgba_wx_alloc(sizeof(MgbaWxConfig), 8);
    assert(config_ptr && config_ptr % 8 == 0);
    MgbaWxConfig config = { sizeof(config), 32768, 2048, 0 };
    memcpy((void*) config_ptr, &config, sizeof(config));
    assert(mgba_wx_create(config_ptr, sizeof(config)) == MGBA_WX_OK);
    assert(mgba_wx_create(0, 0) == MGBA_WX_INVALID_STATE);

    uintptr_t bad_rom = mgba_wx_alloc(256, 16);
    memset((void*) bad_rom, 0xFF, 256);
    assert(mgba_wx_load_rom(bad_rom, 256) == MGBA_WX_INVALID_ROM);
    mgba_wx_free(bad_rom, 256, 16);

    const uint32_t rom_size = 256 * 1024;
    uintptr_t rom = make_test_rom(rom_size);
    assert(mgba_wx_load_rom(rom, rom_size) == MGBA_WX_OK);

    mgba_wx_set_key_mask(MGBA_WX_KEY_A | MGBA_WX_KEY_RIGHT | (1u << 31));
    assert(mgba_wx_get_key_mask() == (MGBA_WX_KEY_A | MGBA_WX_KEY_RIGHT));
    assert(mgba_wx_run_frame() == MGBA_WX_OK);

    uintptr_t video_ptr = mgba_wx_alloc(sizeof(MgbaWxVideoInfo), 8);
    assert(mgba_wx_video_info(video_ptr, sizeof(MgbaWxVideoInfo)) == MGBA_WX_OK);
    MgbaWxVideoInfo video;
    memcpy(&video, (const void*) video_ptr, sizeof(video));
    assert(video.width == 240 && video.height == 160 && video.frame_number == 1);
    assert(video.pixels_ptr != 0 && video.stride_bytes == 240 * 4);

    uint32_t state_size = mgba_wx_state_max_size();
    assert(state_size > 0);
    uintptr_t state = mgba_wx_alloc(state_size, 16);
    uintptr_t written_ptr = mgba_wx_alloc(sizeof(uint32_t), 4);
    assert(mgba_wx_state_write(state, state_size, written_ptr) == MGBA_WX_OK);
    uint32_t written = 0;
    memcpy(&written, (const void*) written_ptr, sizeof(written));
    assert(written == state_size);
    assert(mgba_wx_state_read(state, state_size) == MGBA_WX_OK);

    assert(mgba_wx_unload_rom() == MGBA_WX_OK);
    mgba_wx_free(rom, rom_size, 16);
    mgba_wx_destroy();
    return 0;
}
