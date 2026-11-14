import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import WebSocket from 'ws';
import { z } from 'zod';

const run = promisify(execFile);
type PlaybackResult = 'played' | 'timeout' | 'send-failed' | 'server-rejected' | 'player-failed' | 'canceled';

export async function speakLocal(text: string, signal: AbortSignal) {
  const options = { signal, timeout: 12_000 };
  if (process.platform === 'darwin') {
    await run('/usr/bin/say', [' ' + text], options);
  } else if (process.platform === 'win32') {
    const script = 'Add-Type -AssemblyName System.Speech; $voice = [System.Speech.Synthesis.SpeechSynthesizer]::new(); try { $voice.Speak($env:CAIRO_LIVE_UTTERANCE) } finally { $voice.Dispose() }';
    await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
      { ...options, windowsHide: true, env: { ...process.env, CAIRO_LIVE_UTTERANCE: text } });
  } else {
    throw new Error('Local speech is unavailable on this platform');
  }
}

export async function openAIKey(file: string) {
  const configured = process.env.OPENAI_API_KEY?.trim();
  if (configured) return configured;
  const text = await readFile(file, 'utf8').catch(() => '');
  const key = /\bconst\s+openai\s*=\s*\{[^}]*?\bapiKey\s*:\s*(["'])([^"'\r\n]+)\1/.exec(text)?.[2]?.trim();
  if (!key) throw new Error('Set OPENAI_API_KEY or choose the workspace OpenAI secrets file');
  return key;
}

async function request(key: string, route: string, body: object) {
  const response = await fetch(`https://api.openai.com/v1/${route}`, {
    method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`OpenAI ${route} returned HTTP ${response.status}`);
  return await response.json();
}

export class Voice {
  private socket?: WebSocket;
  private generation = 0;
  private transcript = '';
  private end = 0;
  private quietTimer?: ReturnType<typeof setTimeout>;
  private delegationId: string | null = null;
  private ignored = false;
  private playback?: { id: string; activity: () => void; finish: (result: PlaybackResult) => void };
  private readonly delegate: (words: string, passive: boolean, reply: (text: string) => void) => Promise<void>;
  private readonly state: (state: string) => void;
  private readonly setPlayback: (id: string | null) => void;

  constructor(delegate: (words: string, passive: boolean, reply: (text: string) => void) => Promise<void>, state: (state: string) => void,
    setPlayback: (id: string | null) => void) {
    this.delegate = delegate;
    this.state = state;
    this.setPlayback = setPlayback;
  }

  async start(key: string, sdp: string) {
    this.stop();
    const generation = this.generation;
    const result = await request(key, 'live/sessions', {
      session: { model: 'gpt-live-1', store: false, delegation: { type: 'client' },
        client: { data_channel: { allowed_client_events: ['session.close'] } },
        instructions: 'Cairo Live trading voice. Speak only when you receive a commentary update. Read its content once without adding or inventing details. Skip acknowledgments, introductions, and follow-ups.',
      }, transport: { type: 'webrtc', sdp },
    });
    if (generation !== this.generation) throw new Error('Voice setup was canceled');
    const id = z.string().regex(/^live_[A-Za-z0-9_-]+$/).parse(result.session?.id);
    const answer = z.string().startsWith('v=0').parse(result.transport?.sdp);
    const socket = new WebSocket(`wss://api.openai.com/v1/live/sessions/${id}/attach`, { headers: { Authorization: `Bearer ${key}` }, handshakeTimeout: 8000, maxPayload: 2_000_000 });
    this.socket = socket;
    socket.on('message', buffer => {
      if (this.socket !== socket) return;
      const event = JSON.parse(buffer.toString());
      if (event.type === 'session.closed') { this.stop(); return; }
      if (event.type === 'session.output_audio.delta') this.playback?.activity();
      const playback = this.playback;
      if (playback && event.type === 'error' && event.error?.event_id === playback.id) playback.finish('server-rejected');
      if (this.ignored) return;
      if (event.type === 'session.input_transcript.delta' && typeof event.delta === 'string') {
        if (event.start_ms - this.end > 1300) this.transcript = '';
        this.end = event.end_ms;
        this.transcript = (this.transcript + event.delta).slice(-1600);
        this.scheduleReply(socket);
      }
      if (event.type === 'session.delegation.created' && event.delegation?.target === 'client') {
        this.delegationId = event.delegation.id;
        socket.send(JSON.stringify({ type: 'session.thinking.append', event_id: randomUUID(), delegation_id: event.delegation.id, content: '' }));
        this.scheduleReply(socket);
      }
    });
    socket.on('open', () => { if (this.socket === socket) this.state('Voice connected'); });
    socket.on('close', () => { if (this.socket === socket) this.stop(); });
    socket.on('error', () => { if (this.socket === socket) this.stop('Voice control connection failed'); });
    return answer;
  }

  get connected() { return this.socket?.readyState === WebSocket.OPEN; }

  reportPlayback(id: string, status: 'activity' | 'player-failed') {
    const playback = this.playback;
    if (playback?.id !== id) return;
    if (status === 'activity') playback.activity();
    else playback.finish(status);
  }

  speak(text: string, delegationId: string | null, signal: AbortSignal): Promise<PlaybackResult> {
    const socket = this.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN || this.playback || signal.aborted) return Promise.resolve('canceled');
    return new Promise(resolve => {
      const id = randomUUID();
      let idle: ReturnType<typeof setTimeout>;
      const startup = setTimeout(() => finish('timeout'), 5_000);
      const limit = setTimeout(() => finish(idle ? 'played' : 'timeout'), 30_000);
      const cancel = () => finish('canceled');
      const finish = (result: PlaybackResult) => {
        if (this.playback?.id !== id) return;
        clearTimeout(startup);
        clearTimeout(limit);
        clearTimeout(idle);
        signal.removeEventListener('abort', cancel);
        this.playback = undefined;
        this.setPlayback(null);
        resolve(result);
      };
      this.playback = { id, finish, activity: () => {
        clearTimeout(startup);
        clearTimeout(idle);
        idle = setTimeout(() => finish('played'), 1_400);
      } };
      signal.addEventListener('abort', cancel, { once: true });
      this.setPlayback(id);
      try {
        socket.send(JSON.stringify({ type: 'session.commentary.append', event_id: id, delegation_id: delegationId, content: text }), error => {
          if (error) finish('send-failed');
        });
      } catch {
        finish('send-failed');
      }
    });
  }

  ignoreInput(ignored: boolean) {
    this.ignored = ignored;
    if (ignored) {
      clearTimeout(this.quietTimer);
      this.transcript = '';
      this.delegationId = null;
    }
  }

  private scheduleReply(socket: WebSocket) {
    clearTimeout(this.quietTimer);
    this.quietTimer = setTimeout(() => { void this.reply(socket); }, 1350);
  }

  private async reply(socket: WebSocket) {
    if (this.socket !== socket) return;
    const words = this.transcript.trim();
    const id = this.delegationId;
    this.delegationId = null;
    this.transcript = '';
    if (!/[a-z0-9]/i.test(words.replace(/\[[^\]]*\]/g, ''))) return;
    let sent = false;
    await this.delegate(words, id === null, text => {
      if (sent || this.socket !== socket) return;
      sent = true;
      this.onReply?.(text, id);
    });
  }

  onReply?: (text: string, delegationId: string | null) => void;

  stop(status = 'Voice disconnected') {
    this.generation++;
    const socket = this.socket;
    this.socket = undefined;
    this.playback?.finish('canceled');
    this.transcript = '';
    this.end = 0;
    this.delegationId = null;
    clearTimeout(this.quietTimer);
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'session.close' }));
    socket?.close();
    this.state(status);
  }
}
