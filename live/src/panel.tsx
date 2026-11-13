import { useEffect, useRef, useState, type FormEvent } from 'react';
import { createRoot } from 'react-dom/client';
import type { Position, Snapshot } from './engine.ts';
import './panel.css';

type PanelState = Snapshot & { version: string; voiceStatus: string; localError: string; backtest: string; bookmapMode: string; bookmapDate: string; replayPlans: string[]; chat: Array<{ role: 'user' | 'assistant'; text: string }>; chatBusy: boolean };
declare global {
  interface Window {
    cairo: {
      snapshot(): Promise<PanelState>; onSnapshot(handler: (value: PanelState) => void): () => void;
      ask(text: string): Promise<string>;
      cancelQuestion(): Promise<void>;
      onMuteInput(handler: (muted: boolean) => void): () => void;
      voiceCaption(value: string): Promise<void>;
      replayPlan(id: string): Promise<void>; backtest(): Promise<void>; shadow(value: boolean): Promise<void>;
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
    {position.exitPlan && <div className="proposal"><h3>Exit plan</h3>
      {(!position.fresh || position.exitPlanNeedsReview) && <p className="secondary">{position.fresh ? 'Previous plan · awaiting reassessment' : 'Previous plan · feed stale'}</p>}
      {position.exitPlan.targets.length > 0 && <ol>{position.exitPlan.targets.map(target => <li key={target.price}>{'$' + target.price} {target.hint} ({target.percent}%, {target.shares} shares)</li>)}</ol>}
      {position.exitPlan.notes.map((note, index) => <p key={index}>{note}</p>)}
    </div>}
    {position.fresh && <form className="entry" onSubmit={identify}>
      <label>Pattern<input required maxLength={200} placeholder="Bookmap pattern" value={pattern} onChange={event => setPattern(event.target.value)} /></label>
      <label>Intended stop<input required type="number" step="any" min="0.0001" value={stop} onChange={event => setStop(event.target.value)} /></label>
      <button disabled={busy}>{busy ? 'Checking…' : 'Save and review'}</button>
    </form>}
    {position.note?.management && <p className="rule">{position.note.management.condition ? `Watching ${position.note.management.condition.label} at ${position.note.management.condition.level}` : position.note.management.summary}</p>}
    {position.pending && <div className="proposal"><p>{position.pending.summary}</p>{position.pending.condition && <p>Proposed alert at {position.pending.condition.level}</p>}<button disabled={!position.fresh} onClick={() => run(() => window.cairo.approve(position.id))}>Watch that</button></div>}
    {position.fresh && <button onClick={() => run(() => window.cairo.review(position.id))}>Review management</button>}
  </article>;
}

function Panel() {
  const [state, setState] = useState<PanelState>();
  const [error, setError] = useState('');
  const [mode, setMode] = useState<'off' | 'connecting' | 'listening'>('off');
  const [caption, setCaption] = useState('');
  const [heard, setHeard] = useState('');
  const [question, setQuestion] = useState('');
  const voice = useRef<AudioSession | null>(null);
  const speaker = useRef<HTMLAudioElement>(null);
  const micMuted = useRef(false);

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
    setMode('off');
  }

  useEffect(() => {
    const off = window.cairo.onSnapshot(setState);
    const input = window.cairo.onMuteInput(muted => {
      micMuted.current = muted;
      voice.current?.mic?.getAudioTracks().forEach(track => { track.enabled = !muted; });
    });
    void window.cairo.snapshot().then(setState).catch(error => setError(error.message));
    return () => { off(); input(); closeVoice(); };
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
        void speaker.current.play().catch(() => undefined);
      });
      events.addEventListener('message', ({ data }) => {
        if (voice.current !== active) return;
        const event = JSON.parse(data);
        if (event.type === 'session.started') { clearTimeout(active.timer); setMode('listening'); }
        if (event.type === 'session.output_transcript.delta' && typeof event.delta === 'string') {
          setCaption(value => (value + event.delta).slice(-450));
          void window.cairo.voiceCaption(event.delta).catch(() => undefined);
        }
        if (event.type === 'session.input_transcript.delta') setHeard(value => (value + event.delta).slice(-450));
        if (event.type === 'session.closed') closeVoice();
      });
      events.addEventListener('close', () => { if (voice.current === active) closeVoice(); });
      const mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      if (voice.current !== active) { mic.getTracks().forEach(track => track.stop()); return; }
      active.mic = mic;
      for (const track of mic.getAudioTracks()) { track.enabled = !micMuted.current; peer.addTrack(track, mic); }
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

  function ask(event: FormEvent) {
    event.preventDefault();
    const words = question.trim();
    if (!words || state?.chatBusy) return;
    setQuestion('');
    run(() => window.cairo.ask(words));
  }
  const alert = state?.recent[0];
  const focus = state?.positions.find(item => item.fresh && !item.note);
  const conflict = state?.bookmapMode && state.bookmapMode !== state.selection.mode;
  const replayDateMismatch = state?.bookmapMode === 'replay' && state.selection.mode === 'replay' && state.bookmapDate !== state.selection.sessionDate;

  return <main>
    <header><div><h1>Cairo Live</h1>{state?.version && <p>Build {state.version}</p>}<p>{state?.connected && state.bookmapMode === 'replay' && (!state.bookmapDate || conflict || replayDateMismatch) ? 'Waiting for replay session' : state?.selection.mode === 'replay' ? `Replay · ${state.selection.sessionDate}` : 'Live session'}</p></div>
      <button className="primary" onClick={() => mode === 'off' ? run(startVoice) : run(async () => { closeVoice(); await window.cairo.voiceStop(); })}>{mode === 'off' ? 'Start voice' : mode === 'connecting' ? 'Cancel voice' : 'End voice'}</button></header>
    <div className="status" role="status"><span>{state?.connected ? 'Bookmap connected' : 'Waiting for Bookmap'}</span><span>{mode === 'listening' ? 'Mic listening' : mode === 'connecting' ? 'Connecting voice…' : 'Mic off'}</span><span>{state?.shadow ? 'Shadow mode' : 'Spoken alerts'}</span></div>
    {(error || state?.localError) && <p className="error" role="alert">{error || state?.localError}</p>}
    <section className="focus"><h2>{focus ? 'Needs your input' : 'Latest alert'}</h2><p>{focus ? `${focus.symbol}. Which pattern did you use, and where is your intended stop?` : alert?.text ?? 'Waiting for an event'}</p>
      {alert && <div className="feedback">{['Useful', 'Noisy', 'Late'].map(value => <button key={value} onClick={() => run(() => window.cairo.feedback(alert.key, value))}>{value}</button>)}</div>}
    </section>
    <section className="positions"><h2>Positions</h2>{state?.positions.length ? state.positions.map(position => <PositionCard key={position.id} position={position} run={run} />) : <p className="secondary">No open positions reported</p>}</section>
    <section><h2>Ask Cairo</h2>
      {state?.chat.length ? <div className="chat" role="log" aria-label="Cairo conversation">
        {state.chat.map((message, index) => <p key={index}><strong>{message.role === 'user' ? 'You' : 'Cairo'}</strong> {message.text || 'Checking…'}</p>)}
      </div> : null}
      <form className="chat-form" onSubmit={ask}>
        <input aria-label="Question for Cairo" placeholder="Ask about a ticker, position, or pattern" value={question} maxLength={2000} onChange={event => setQuestion(event.target.value)} />
        {state?.chatBusy ? <button type="button" onClick={() => run(() => window.cairo.cancelQuestion())}>Cancel</button> : <button disabled={!question.trim()}>Ask</button>}
      </form>
    </section>
    <section><h2>Daily plan {state?.plan && <span>· Revision {state.plan.revision}</span>}</h2>
      {state?.connected && state.selection.mode === 'replay' && Object.entries(state.replayVwap).map(([symbol, value]) =>
        <p key={symbol} className="secondary">{symbol} replay VWAP ${value.price.toFixed(2)}{value.partial ? ' · partial recording coverage' : ''}</p>)}
      {state?.selection.mode === 'replay' && state.replayPlans.length > 1 && <label>Replay plan <select aria-label="Replay plan" value={state.selection.replayRunId}
        onChange={event => { const id = event.target.value; if (id) run(() => window.cairo.replayPlan(id)); }}>
        {!state.replayPlans.includes(state.selection.replayRunId) && <option value="practice" disabled>Practice · choose a saved plan</option>}
        {state.replayPlans.map(id => <option key={id}>{id}</option>)}
      </select></label>}
      {state?.planError && <p className="secondary">{state.planError}{state.plan ? ' · Using last valid revision' : ''}</p>}
      {state?.plan?.watchlist.map(item => <div className="watch-plan" key={item.symbol}><div className="watch"><strong>{item.symbol}</strong><span>{state.last[item.symbol] !== undefined ? `$${state.last[item.symbol].toFixed(2)}` : 'Waiting for price'}</span><span>{state.missing.includes(item.symbol) ? 'Chart needed' : item.setups.map(setup => `${setup.direction} · ${setup.tradebook}`).join(' / ')}</span></div>
        {item.setups.flatMap(setup => setup.conditions).map(rule => <p className="secondary" key={rule.id}>{rule.label}{'level' in rule ? ` · $${rule.level}` : ''}</p>)}
      </div>)}
      {state?.plan?.watchlist.length === 0 && <p>No trade planned</p>}
    </section>
    <details><summary>Session and settings</summary>
      <p className="secondary">{state?.backtest}</p><button onClick={() => run(() => window.cairo.backtest())}>Choose Backtest folder</button>
      <label className="toggle"><input type="checkbox" checked={state?.shadow ?? true} onChange={event => run(() => window.cairo.shadow(event.target.checked))} /> Shadow mode</label>
    </details>
    {(caption || heard) && <details><summary>Voice captions</summary>{heard && <p>You · {heard}</p>}{caption && <p>Cairo · {caption}</p>}</details>}
    <audio ref={speaker} autoPlay muted hidden />
  </main>;
}

createRoot(document.getElementById('root')!).render(<Panel />);
