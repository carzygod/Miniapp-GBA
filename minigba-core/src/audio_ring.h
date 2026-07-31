#ifndef MINIGBA_AUDIO_RING_H
#define MINIGBA_AUDIO_RING_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

typedef struct MgbaWxAudioRing {
    int16_t* samples;
    size_t capacity_frames;
    size_t read_frame;
    size_t queued_frames;
} MgbaWxAudioRing;

bool mgba_wx_audio_ring_init(MgbaWxAudioRing* ring, size_t capacity_frames);
void mgba_wx_audio_ring_deinit(MgbaWxAudioRing* ring);
void mgba_wx_audio_ring_clear(MgbaWxAudioRing* ring);
void mgba_wx_audio_ring_write(MgbaWxAudioRing* ring, const int16_t* interleaved, size_t frames);
size_t mgba_wx_audio_ring_read(MgbaWxAudioRing* ring, int16_t* interleaved, size_t max_frames);

#endif

