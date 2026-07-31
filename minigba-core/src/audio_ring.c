#include "audio_ring.h"

#include <stdlib.h>
#include <string.h>

bool mgba_wx_audio_ring_init(MgbaWxAudioRing* ring, size_t capacity_frames) {
    if (!ring || !capacity_frames || capacity_frames > SIZE_MAX / (2 * sizeof(int16_t))) {
        return false;
    }
    memset(ring, 0, sizeof(*ring));
    ring->samples = calloc(capacity_frames * 2, sizeof(int16_t));
    if (!ring->samples) {
        return false;
    }
    ring->capacity_frames = capacity_frames;
    return true;
}

void mgba_wx_audio_ring_deinit(MgbaWxAudioRing* ring) {
    if (!ring) {
        return;
    }
    free(ring->samples);
    memset(ring, 0, sizeof(*ring));
}

void mgba_wx_audio_ring_clear(MgbaWxAudioRing* ring) {
    if (!ring) {
        return;
    }
    ring->read_frame = 0;
    ring->queued_frames = 0;
}

void mgba_wx_audio_ring_write(MgbaWxAudioRing* ring, const int16_t* input, size_t frames) {
    if (!ring || !ring->samples || !input || !frames) {
        return;
    }
    if (frames >= ring->capacity_frames) {
        input += (frames - ring->capacity_frames) * 2;
        frames = ring->capacity_frames;
        ring->read_frame = 0;
        ring->queued_frames = 0;
    }
    size_t free_frames = ring->capacity_frames - ring->queued_frames;
    if (frames > free_frames) {
        size_t dropped = frames - free_frames;
        ring->read_frame = (ring->read_frame + dropped) % ring->capacity_frames;
        ring->queued_frames -= dropped;
    }
    size_t write_frame = (ring->read_frame + ring->queued_frames) % ring->capacity_frames;
    for (size_t i = 0; i < frames; ++i) {
        size_t target = ((write_frame + i) % ring->capacity_frames) * 2;
        ring->samples[target] = input[i * 2];
        ring->samples[target + 1] = input[i * 2 + 1];
    }
    ring->queued_frames += frames;
}

size_t mgba_wx_audio_ring_read(MgbaWxAudioRing* ring, int16_t* output, size_t max_frames) {
    if (!ring || !ring->samples || !output || !max_frames) {
        return 0;
    }
    size_t frames = ring->queued_frames < max_frames ? ring->queued_frames : max_frames;
    for (size_t i = 0; i < frames; ++i) {
        size_t source = ((ring->read_frame + i) % ring->capacity_frames) * 2;
        output[i * 2] = ring->samples[source];
        output[i * 2 + 1] = ring->samples[source + 1];
    }
    ring->read_frame = (ring->read_frame + frames) % ring->capacity_frames;
    ring->queued_frames -= frames;
    return frames;
}

