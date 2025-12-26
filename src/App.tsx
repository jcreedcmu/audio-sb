import { useCallback, useEffect, useRef, useState, JSX } from "react";
import { type CanvasInfo, useCanvas } from './use-canvas';

function fmod(a: number, b: number): number {
  return a - Math.floor(a / b) * b;
}

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

async function playSound(ctx: AudioContext, pat: Note[], divPerSec: number) {
  const bass = await mkDrum(ctx, { freq: 70, gain: 16, durationSec: 1 / (divPerSec), env: false });
  const snare = await mkDrum(ctx, { freq: 6000, gain: 0.5, durationSec: 1 / (2 * divPerSec), env: true });

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

  const wholeDur = patLength(pat);

  for (let i = 0; i < 2; i++) {
    pat.forEach(n => {
      if (n.instName != undefined) {
        playBufferAt(ctx, sequencerOut, insts[n.instName], n.startSec + i * wholeDur);
      }
    });
  }
}

const WIDTH = 500;
const HEIGHT = 100;

function render(ci: CanvasInfo, { pat, playhead }: { pat: Note[], playhead: number | undefined }) {
  const { d } = ci;
  d.clearRect(0, 0, WIDTH, HEIGHT);
  const ww = WIDTH - 1;
  const hh = HEIGHT - 1;
  const length = patLength(pat);

  pat.forEach(n => {
    if (n.instName != undefined) {
      if (n.instName == 'bass') d.fillStyle = '#def';
      if (n.instName == 'snare') d.fillStyle = '#fed';
      if (playhead > n.startSec && playhead < n.endSec) d.fillStyle = "yellow";
      d.lineWidth = 1;
      d.fillRect(0.5 + Math.floor(ww * n.startSec / length), 0.5, Math.floor(ww * (n.endSec - n.startSec) / length), hh);
      d.strokeRect(0.5 + Math.floor(ww * n.startSec / length), 0.5, Math.floor(ww * (n.endSec - n.startSec) / length), hh);
    }
  });
  if (playhead != undefined) {
    d.fillStyle = 'red';
    const p = ww * playhead / length;
    d.fillRect(p - 3, 0, 6, hh);
  }
}


function PatDisplay(props: { pat: Note[], playhead: number | undefined }): JSX.Element {
  const { pat, playhead } = props;
  const [rc, mr] = useCanvas<{ pat: Note[], playhead: number | undefined }>({ pat, playhead }, render, [pat, playhead], (ci) => { ci.c.width = ci.size.x; ci.c.height = ci.size.y; });
  return <canvas ref={rc} style={{ width: 500, height: 100 }} />;
}

export function App() {
  const ff = 6;
  const audioContextRef = useRef(null);
  const [text, setText] = useState('bbbbsb  bbbbs  s');
  const [playhead, setPlayhead] = useState<number | undefined>(0);

  const getAudioContext = useCallback(() => {
    if (!audioContextRef.current) {
      audioContextRef.current = new AudioContext();
    }
    return audioContextRef.current;
  }, []);

  function follow(ctx: AudioContext, startSec: number, patLength: number, untilSec: number) {
    const elapsed = ctx.currentTime - startSec;
    setPlayhead(fmod(elapsed, patLength));
    if (elapsed < untilSec)
      setTimeout(() => follow(ctx, startSec, patLength, untilSec), 20);
    else
      setPlayhead(0);
  }

  const handleClick = useCallback((text: string) => {
    const ctx = getAudioContext();
    const notes = parsePat(text, ff);
    playSound(ctx, notes, ff);
    const length = patLength(notes);
    follow(ctx, ctx.currentTime, length, 2 * length);
  }, [getAudioContext]);

  useEffect(() => {
    return () => {
      if (audioContextRef.current) {
        audioContextRef.current.close();
      }
    };
  }, []);

  const pat = parsePat(text, ff);
  return (
    <div className="content">
      <PatDisplay pat={pat} playhead={playhead} /><br />
      <input value={text} onChange={(e) => { setText(e.target.value) }} /><br />
      <button id="play" onClick={() => handleClick(text)}>Play noise</button>
    </div>
  );
}
