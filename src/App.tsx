import { useCallback, useEffect, useRef, useState, JSX } from "react";
import { type CanvasInfo, useCanvas } from './use-canvas';

class Rand {
  n: number;
  constructor(n?: number) { this.n = n || 42; for (let i = 0; i < 3; i++) this.f(); }
  f(): number {
    this.n = (2147483629 * this.n + 2147483587) % 2147483647;
    return (this.n & 0xffff) / (1 << 16);
  }
  i(n: number): number {
    return Math.floor(this.f() * n);
  }
}

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
  const rand = new Rand();
  for (let i = 0; i < bufferSize; i++) {
    data[i] = rand.f() * 2 - 1;
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

export type Note = { startSec: number, endSec: number, instName: string | undefined };

type Inst = 'bass' | 'snare';
function instOfChar(c: string): Inst | undefined {
  if (c == 'b') return 'bass';
  if (c == 's') return 'snare';
  return undefined;
}

function parsePat(pat: string, divPerSec: number): Note[] {
  const divisions = pat.length;
  const durSec = divisions / divPerSec;
  return pat.split('').map((p, t) => {
    const instName = instOfChar(p);
    return { startSec: t * durSec / divisions, endSec: (t + 1) * durSec / divisions, instName };
  });
}

function patLength(pat: Note[]): number {
  return Math.max(...pat.map(n => n.endSec));
}

async function playSound(ctx: AudioContext, pat: string) {
  const ff = 8;
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



  const insts: { [key: string]: AudioBuffer } = { bass, snare };
  const notes = parsePat(pat, ff);
  const wholeDur = patLength(notes);

  for (let i = 0; i < 2; i++) {
    notes.forEach(n => {
      if (n.instName != undefined) {
        playBufferAt(ctx, sequencerOut, insts[n.instName], n.startSec + i * wholeDur);
      }
    });
  }
}

function render(ci: CanvasInfo, { pat }: { pat: string }) {
  const { d } = ci;
  d.fillRect(0, 0, 100, 100);
}

function PatDisplay(props: { pat: string }): JSX.Element {
  const { pat } = props;
  const [rc, mr] = useCanvas<{ pat: string }>({ pat }, render, [], () => { });
  return <canvas ref={rc} width="500" height="100" style={{ width: 500, height: 100 }} />;
}

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
      <PatDisplay pat={text} />
      <input value={text} onChange={(e) => { setText(e.target.value) }} /><br />
      <button id="play" onClick={() => handleClick(text)}>Play noise</button>
    </div>
  );
}
