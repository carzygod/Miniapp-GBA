#include "audio_ring.h"

#include <assert.h>
#include <stdint.h>

int main(void) {
    MgbaWxAudioRing ring;
    assert(mgba_wx_audio_ring_init(&ring, 3));
    const int16_t first[] = { 1, 11, 2, 12 };
    mgba_wx_audio_ring_write(&ring, first, 2);
    int16_t output[6] = { 0 };
    assert(mgba_wx_audio_ring_read(&ring, output, 1) == 1);
    assert(output[0] == 1 && output[1] == 11);

    const int16_t second[] = { 3, 13, 4, 14, 5, 15 };
    mgba_wx_audio_ring_write(&ring, second, 3);
    assert(ring.queued_frames == 3);
    assert(mgba_wx_audio_ring_read(&ring, output, 3) == 3);
    assert(output[0] == 3 && output[1] == 13);
    assert(output[2] == 4 && output[3] == 14);
    assert(output[4] == 5 && output[5] == 15);

    mgba_wx_audio_ring_clear(&ring);
    assert(ring.queued_frames == 0);
    mgba_wx_audio_ring_deinit(&ring);
    return 0;
}

