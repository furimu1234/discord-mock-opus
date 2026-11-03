import { VOICE_CHANNELS as CHANNELS, VOICE_SAMPLE_RATE as SAMPLE_RATE } from '@dismock/server/constants';
import { useCallback, useEffect, useRef, useState } from 'react';
import { streamAudio } from './api';

const BYTES_PER_SAMPLE = 2;
const MAX_SAMPLE = 32768;
const PLAYBACK_DELAY_S = 0.2;
const VOLUME_STORAGE_KEY = 'dismock-voice-volumes';
const FULL_VOLUME = 100;

export const MAX_VOLUME = 200;
export const DEFAULT_VOLUME = FULL_VOLUME;

type Volumes = Record<string, number>;

function loadVolumes(): Volumes {
  try {
    return JSON.parse(localStorage.getItem(VOLUME_STORAGE_KEY) ?? '{}') as Volumes;
  } catch {
    return {};
  }
}

/** ユーザーごとの音量。このブラウザの設定なので、他の画面には影響しない。 */
export function useVolumes(): [Volumes, (userId: string, volume: number) => void] {
  const [volumes, setVolumes] = useState(loadVolumes);
  const setVolume = useCallback((userId: string, volume: number) => {
    setVolumes((current) => {
      const next = { ...current, [userId]: volume };
      try {
        localStorage.setItem(VOLUME_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // 保存できなくても、開いている間の音量は変更できる。
      }
      return next;
    });
  }, []);
  return [volumes, setVolume];
}

/** インターリーブされた 16 ビットの PCM を AudioBuffer に変換する。 */
function toAudioBuffer(context: AudioContext, pcm: DataView): AudioBuffer {
  const frames = pcm.byteLength / BYTES_PER_SAMPLE / CHANNELS;
  const buffer = context.createBuffer(CHANNELS, frames, SAMPLE_RATE);
  for (let channel = 0; channel < CHANNELS; channel += 1) {
    const samples = buffer.getChannelData(channel);
    for (let frame = 0; frame < frames; frame += 1) {
      samples[frame] = pcm.getInt16((frame * CHANNELS + channel) * BYTES_PER_SAMPLE, true) / MAX_SAMPLE;
    }
  }
  return buffer;
}

/** ボイスチャンネルに接続している間、Bot の音声を再生する。流すかどうかは Mock が判定する。 */
export function useVoiceAudio(connected: boolean, volume: number, onError: (message: string) => void): void {
  const gain = useRef<GainNode | null>(null);

  useEffect(() => {
    if (!connected) return;
    const context = new AudioContext({ sampleRate: SAMPLE_RATE });
    const output = context.createGain();
    output.connect(context.destination);
    gain.current = output;
    // テストが接続したときなど、操作なしでは再生が許可されない。次の操作で再開する。
    const resume = () => void context.resume();
    window.addEventListener('pointerdown', resume);

    let playAt = 0;
    const controller = new AbortController();
    streamAudio(controller.signal, (pcm) => {
      if (context.state !== 'running') return;
      const source = context.createBufferSource();
      source.buffer = toAudioBuffer(context, pcm);
      source.connect(output);
      playAt = Math.max(playAt, context.currentTime + PLAYBACK_DELAY_S);
      source.start(playAt);
      playAt += source.buffer.duration;
    }).catch((error: Error) => {
      if (!controller.signal.aborted) onError(error.message);
    });

    return () => {
      controller.abort();
      window.removeEventListener('pointerdown', resume);
      void context.close();
      gain.current = null;
    };
  }, [connected, onError]);

  useEffect(() => {
    if (gain.current) gain.current.gain.value = volume / FULL_VOLUME;
  }, [connected, volume]);
}
