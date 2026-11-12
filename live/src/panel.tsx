import { useEffect, useRef, useState, type FormEvent } from 'react';
import { createRoot } from 'react-dom/client';
import type { Position, Snapshot } from './engine.ts';
import type { Selection } from './plan.ts';
import './panel.css';

type PanelState = Snapshot & { voiceStatus: string; localError: string; backtest: string; bookmapMode: string; bookmapDate: string };
declare global {
  interface Window {
    cairo: {
      snapshot(): Promise<PanelState>; onSnapshot(handler: (value: PanelState) => void): () => void;
      onMuteOutput(handler: (muted: boolean) => void): () => void;
      selection(value: Selection): Promise<void>; backtest(): Promise<void>; shadow(value: boolean): Promise<void>;
      identify(id: string, note: { pattern: string; intendedStop: number }): Promise<string>;
      review(id: string): Promise<string>; approve(id: string): Promise<void>;
      feedback(key: string, value: string): Promise<void>; voiceStart(sdp: string): Promise<string>; voiceStop(): Promise<void>;
    };
  }
}

type AudioSession = { peer: RTCPeerConnection; events: RTCDataChannel; mic?: MediaStream; timer?: ReturnType<typeof setTimeout> };

function waitForIce(peer: RTCPeerConnection) {
  if (peer.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    function complete() {
      if (peer.iceGatheringState !== 'complete') return;
      clearTimeout(timer); peer.removeEventListener('icegatheringstatechange', complete); resolve();
    }
    const timer = setTimeout(() => { peer.removeEventListener('icegatheringstatechange', complete); reject(new Error('Audio connection timed out')); }, 10_000);
    peer.addEventListener('icegatheringstatechange', complete);
    complete();
  });
}

function PositionCard({ position, run }: { position: Position; run: (work: () => Promise<unknown>) => void }) {
  const [pattern, setPattern] = useState(position.note?.pattern ?? '');
  const [stop, setStop] = useState(position.note?.intendedStop.toString() ?? '');
  const [busy, setBusy] = useState(false);
  async function identify(event: FormEvent) {
    event.preventDefault();
    run(async () => {
      setBusy(true);
      try { await window.cairo.identify(position.id, { pattern, intendedStop: Number(stop) }); }
      finally { setBusy(false); }
    });
  }
  return <article className="position">
    <div className="line"><h3>{position.symbol} {position.quantity > 0 ? 'long' : 'short'}</h3><span>{Math.abs(position.quantity)} shares · ${position.average.toFixed(2)}</span></div>
    <p className="secondary">{position.fresh ? `Working stop ${position.brokerStops.length ? position.brokerStops.join(', ') : 'unavailable'}` : 'Position data stale'}</p>
    {position.note && <p>{position.note.pattern} · Intended stop ${position.note.intendedStop}</p>}
    {position.fresh && <form className="entry" onSubmit={identify}>
      <label>Pattern<input required maxLength={200} placeholder="Bookmap pattern" value={pattern} onChange={event => setPattern(event.target.value)} /></label>
      <label>Intended stop<input required type="number" step="any" min="0.0001" value={stop} onChange={event => setStop(event.target.value)} /></label>
      <button disabled={busy}>{busy ? 'Checking…' : 'Save and review'}</button>
    </form>}
    {position.note?.management && <p className="rule">{position.note.management.condition ? `Watching ${position.note.management.condition.label} at ${position.note.management.condition.level}` : position.note.management.summary}</p>}
    {position.pending && <div className="proposal"><p>{position.pending.summary}</p>{position.pending.condition && <p>Proposed alert at {position.pending.condition.level}</p>}<button disabled={!position.fresh} onClick={() => run(() => window.cairo.approve(position.id))}>Watch that</button></div>}
    {position.fresh && position.note && !position.pending && <button onClick={() => run(() => window.cairo.review(position.id))}>Review management</button>}
  </article>;
}

function Panel() {
  const [state, setState] = useState<PanelState>();
  const [error, setError] = useState('');
  const [mode, setMode] = useState<'off' | 'connecting' | 'listening'>('off');
  const [date, setDate] = useState('');
  const [runId, setRunId] = useState('');
  const [caption, setCaption] = useState('');
  const [heard, setHeard] = useState('');
  const [audioBlocked, setAudioBlocked] = useState(false);
  const voice = useRef<AudioSession | null>(null);
  const speaker = useRef<HTMLAudioElement>(null);

  function closeVoice() {
    const current = voice.current;
    if (current) {
      voice.current = null;
      clearTimeout(current.timer);
      current.mic?.getTracks().forEach(track => track.stop());
      if (current.events.readyState === 'open') current.events.send(JSON.stringify({ type: 'session.close' }));
      current.peer.close();
    }
    if (speaker.current) speaker.current.srcObject = null;
    setAudioBlocked(false);
    setMode('off');
  }

  useEffect(() => {
    const off = window.cairo.onSnapshot(setState);
    const unmute = window.cairo.onMuteOutput(muted => { if (speaker.current) speaker.current.muted = muted; });
    void window.cairo.snapshot().then(setState).catch(error => setError(error.message));
    return () => { off(); unmute(); closeVoice(); };
  }, []);

  useEffect(() => {
    if (mode === 'listening' && state?.voiceStatus !== 'Voice connected') {
      if (state?.voiceStatus === 'Voice disconnected' || state?.voiceStatus === 'Voice control connection failed') {
        closeVoice();
        setError('Voice control disconnected. Start voice again.');
      }
    }
  }, [state?.voiceStatus]);

  function run(work: () => Promise<unknown>) { setError(''); void work().catch(error => setError(error.message)); }

  async function startVoice() {
    if (voice.current) return;
    const peer = new RTCPeerConnection();
    const events = peer.createDataChannel('oai-events');
    const active: AudioSession = { peer, events };
    voice.current = active;
    setMode('connecting'); setCaption(''); setHeard('');
    try {
      peer.addEventListener('track', event => {
        if (voice.current !== active || !speaker.current) return;
        speaker.current.srcObject = new MediaStream([event.track]);
        void speaker.current.play().catch(() => setAudioBlocked(true));
      });
      events.addEventListener('message', ({ data }) => {
        if (voice.current !== active) return;
        const event = JSON.parse(data);
        if (event.type === 'session.started') { clearTimeout(active.timer); setMode('listening'); }
        if (event.type === 'session.output_transcript.delta') setCaption(value => (value + event.delta).slice(-450));
        if (event.type === 'session.input_transcript.delta') setHeard(value => (value + event.delta).slice(-450));
        if (event.type === 'session.closed') closeVoice();
      });
      events.addEventListener('close', () => { if (voice.current === active) closeVoice(); });
      const mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      if (voice.current !== active) { mic.getTracks().forEach(track => track.stop()); return; }
      active.mic = mic;
      for (const track of mic.getAudioTracks()) peer.addTrack(track, mic);
      await peer.setLocalDescription(await peer.createOffer());
      await waitForIce(peer);
      if (voice.current !== active) return;
      const answer = await window.cairo.voiceStart(peer.localDescription!.sdp);
      if (voice.current !== active) return;
      active.timer = setTimeout(() => { closeVoice(); void window.cairo.voiceStop(); setError('Voice did not connect. Try again.'); }, 15_000);
      await peer.setRemoteDescription({ type: 'answer', sdp: answer });
    } catch (error) {
      if (voice.current === active) { closeVoice(); await window.cairo.voiceStop(); throw error; }
    }
  }

  function select(selection: Selection) { closeVoice(); run(() => window.cairo.selection(selection)); }
  const alert = state?.recent[0];
  const focus = state?.positions.find(item => item.fresh && !item.note);
  const conflict = state?.bookmapMode && state.bookmapMode !== state.selection.mode;
  const replayDateMismatch = state?.selection.mode === 'replay' && state.bookmapDate && state.bookmapDate !== state.selection.sessionDate;

  return <main>
    <header><div><h1>Cairo Live</h1><p>{state?.selection.mode === 'replay' ? `Replay · ${state.selection.sessionDate}` : 'Live session'}</p></div>
      <button className="primary" onClick={() => mode === 'off' ? run(startVoice) : run(async () => { closeVoice(); await window.cairo.voiceStop(); })}>{mode === 'off' ? 'Start voice' : mode === 'connecting' ? 'Cancel voice' : 'End voice'}</button></header>
    <div className="status" role="status"><span>{state?.connected ? 'Bookmap connected' : 'Waiting for Bookmap'}</span><span>{mode === 'listening' ? 'Mic listening' : mode === 'connecting' ? 'Connecting voice…' : 'Mic off'}</span><span>{state?.shadow ? 'Shadow mode' : 'Spoken alerts'}</span></div>
    {(error || state?.localError || conflict || replayDateMismatch) && <p className="error" role="alert">{error || state?.localError || (conflict ? `Bookmap is in ${state?.bookmapMode} mode. Select the matching session.` : `Bookmap is replaying ${state?.bookmapDate}. Choose that date.`)}</p>}
    <section className="focus"><h2>{focus ? 'Needs your input' : 'Latest alert'}</h2><p>{focus ? `${focus.symbol}. Which pattern did you use, and where is your intended stop?` : alert?.text ?? 'Waiting for an event'}</p>
      {alert && <div className="feedback">{['Useful', 'Noisy', 'Late'].map(value => <button key={value} onClick={() => run(() => window.cairo.feedback(alert.key, value))}>{value}</button>)}</div>}
    </section>
    <section><h2>Positions</h2>{state?.positions.length ? state.positions.map(position => <PositionCard key={position.id} position={position} run={run} />) : <p className="secondary">No open positions reported</p>}</section>
    <section><h2>Daily plan {state?.plan && <span>· Revision {state.plan.revision}</span>}</h2>
      {state?.planError && <p className="secondary">{state.planError}{state.plan ? ' · Using last valid revision' : ''}</p>}
      {state?.plan?.watchlist.map(item => <div className="watch-plan" key={item.symbol}><div className="watch"><strong>{item.symbol}</strong><span>{state.last[item.symbol] !== undefined ? `$${state.last[item.symbol].toFixed(2)}` : 'Waiting for price'}</span><span>{state.missing.includes(item.symbol) ? 'Chart needed' : item.setups.map(setup => `${setup.direction} · ${setup.tradebook}`).join(' / ')}</span></div>
        {item.setups.flatMap(setup => setup.conditions).map(rule => <p className="secondary" key={rule.id}>{rule.label}{'level' in rule ? ` · $${rule.level}` : ''}</p>)}
      </div>)}
      {state?.plan?.watchlist.length === 0 && <p>No trade planned</p>}
    </section>
    <details><summary>Session and settings</summary>
      <p className="secondary">{state?.backtest}</p><button onClick={() => run(() => window.cairo.backtest())}>Choose Backtest folder</button>
      <label className="toggle"><input type="checkbox" checked={state?.shadow ?? true} onChange={event => run(() => window.cairo.shadow(event.target.checked))} /> Shadow mode</label>
      <button onClick={() => select({ mode: 'live' })}>Use live session</button>
      <form className="replay" onSubmit={event => { event.preventDefault(); select({ mode: 'replay', sessionDate: date || state?.bookmapDate || '', replayRunId: runId }); }}>
        <label>Replay date<input type="date" required value={date || (state?.bookmapMode === 'replay' ? state.bookmapDate : '')} onChange={event => setDate(event.target.value)} /></label>
        <label>Replay run ID<input required pattern="[A-Za-z0-9][A-Za-z0-9._-]{0,79}" value={runId} onChange={event => setRunId(event.target.value)} /></label>
        <button>Use replay session</button>
      </form>
    </details>
    {(caption || heard) && <details><summary>Voice captions</summary>{heard && <p>You · {heard}</p>}{caption && <p>Cairo · {caption}</p>}</details>}
    <audio ref={speaker} autoPlay controls={audioBlocked} hidden={!audioBlocked} />
  </main>;
}

createRoot(document.getElementById('root')!).render(<Panel />);
