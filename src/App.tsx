import { useCallback, useEffect, useRef, useState } from "react";

function playBuffer(ctx: AudioContext, buffer: AudioBuffer) {
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.connect(ctx.destination);
  source.start();
}

function playBufferAt(
  ctx: AudioContext,
  dst: AudioNode,
  buffer: AudioBuffer,
  when: number // seconds from now
) {
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.connect(dst);
  source.start(ctx.currentTime + when);
}

type DrumParams = {
  freq: number,
  durationSec: number,
  env: boolean,
  gain: number,
};

async function mkDrum(ctx: AudioContext, { freq, durationSec, env, gain }: DrumParams): Promise<AudioBuffer> {
  const sampleRate = ctx.sampleRate;
  const bufferSize = sampleRate * durationSec;
  const d = new OfflineAudioContext(1, sampleRate * durationSec, sampleRate);
  const now = d.currentTime;
  const buffer = d.createBuffer(1, bufferSize, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) {
    data[i] = Math.random() * 2 - 1;
  }

  const source = d.createBufferSource();
  source.buffer = buffer;

  const filter = d.createBiquadFilter();

  const gainNode = d.createGain();
  gainNode.gain.value = gain;

  if (env) {
    gainNode.gain.linearRampToValueAtTime(0.0, now + durationSec);
  }

  source.connect(filter);
  filter.connect(gainNode);
  gainNode.connect(d.destination);


  filter.type = 'lowpass';

  filter.frequency.setValueAtTime(freq, now);

  source.start(now);

  return d.startRendering();
}

async function playSound(ctx: AudioContext, pat: string) {
  const ff = 6;
  const bass = await mkDrum(ctx, { freq: 100, gain: 8, durationSec: 1 / ff, env: true });
  const snare = await mkDrum(ctx, { freq: 5000, gain: 0.5, durationSec: 1 / (2 * ff), env: true });


  const convolver = ctx.createConvolver();

  try {
    const response = await fetch(
      "680466__jzazvurek__bathroom-mono-impulse-rear-side-of-mic-diaphragm-ir.wav",
    );
    const arrayBuffer = await response.arrayBuffer();
    const decodedAudio = await ctx.decodeAudioData(arrayBuffer);
    convolver.buffer = decodedAudio;
  } catch (error) {
    console.error(
      `Unable to fetch the audio file: ${name} Error: ${error}`,
    );
  }

  let sequencerOut: AudioNode = convolver;

  const master = ctx.createGain();
  master.gain.value = 1;

  convolver.connect(master);
  master.connect(ctx.destination);

  if (false) {
    sequencerOut = master;
  }

  function getInst(x: string) {
    if (x == 'b') return bass;
    if (x == 's') return snare;
  }
  for (let i = 0; i < 2; i++) {
    pat.split('').forEach((p, t) => {
      const inst = getInst(p);
      if (inst != undefined)
        playBufferAt(ctx, sequencerOut, inst, t / ff + i * pat.length / ff);
    });
  }

};

export function App() {
  const audioContextRef = useRef(null);
  const [text, setText] = useState('b s b s ');

  const getAudioContext = useCallback(() => {
    if (!audioContextRef.current) {
      audioContextRef.current = new AudioContext();
    }
    return audioContextRef.current;
  }, []);

  const handleClick = useCallback((text: string) => {
    const ctx = getAudioContext();
    playSound(ctx, text);
  }, [getAudioContext]);

  useEffect(() => {
    return () => {
      if (audioContextRef.current) {
        audioContextRef.current.close();
      }
    };
  }, []);


  return (
    <div className="content">
      <input value={text} onChange={(e) => { setText(e.target.value) }} /><br />
      <button id="play" onClick={() => handleClick(text)}>Play noise</button>
    </div>
  );
}
