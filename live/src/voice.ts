import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import WebSocket from 'ws';
import { z } from 'zod';

const run = promisify(execFile);

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
  private readonly delegate: (words: string, passive: boolean) => Promise<void>;
  private readonly state: (state: string) => void;

  constructor(delegate: (words: string, passive: boolean) => Promise<void>, state: (state: string) => void) {
    this.delegate = delegate;
    this.state = state;
  }

  async start(key: string, sdp: string) {
    this.stop();
    const generation = this.generation;
    const result = await request(key, 'live/sessions', {
      session: { model: 'gpt-live-1', store: false, delegation: { type: 'client' },
        client: { data_channel: { allowed_client_events: ['session.close'] } },
        instructions: 'Transcribe the trader. Stay silent. Cairo speaks all replies and announcements locally.',
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
      if (this.ignored) return;
      if (event.type === 'session.input_transcript.delta' && typeof event.delta === 'string') {
        if (event.start_ms - this.end > 1300) this.transcript = '';
        this.end = event.end_ms;
        this.transcript = (this.transcript + event.delta).slice(-1600);
        this.scheduleReply(socket);
      }
      if (event.type === 'session.delegation.created' && event.delegation?.target === 'client') {
        this.delegationId = event.delegation.id;
        this.scheduleReply(socket);
      }
      if (event.type === 'session.closed') this.stop();
    });
    socket.on('open', () => { if (this.socket === socket) this.state('Voice connected'); });
    socket.on('close', () => { if (this.socket === socket) { this.socket = undefined; this.state('Voice disconnected'); } });
    socket.on('error', () => { if (this.socket === socket) this.state('Voice control connection failed'); });
    return answer;
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
    await this.delegate(words, id === null);
  }

  stop() {
    this.generation++;
    const socket = this.socket;
    this.socket = undefined;
    this.transcript = '';
    this.end = 0;
    this.delegationId = null;
    clearTimeout(this.quietTimer);
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'session.close' }));
    socket?.close();
    this.state('Voice disconnected');
  }
}

export async function speakLocal(text: string) {
  if (process.platform === 'darwin') await run('/usr/bin/say', [text], { timeout: 12_000 });
  else if (process.platform === 'win32') {
    const code = 'Add-Type -AssemblyName System.Speech; $voice = [System.Speech.Synthesis.SpeechSynthesizer]::new(); try { $voice.Speak($env:CAIRO_LIVE_UTTERANCE) } finally { $voice.Dispose() }';
    await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(code, 'utf16le').toString('base64')], { windowsHide: true, timeout: 12_000, env: { ...process.env, CAIRO_LIVE_UTTERANCE: text } });
  } else throw new Error('Local speech is unavailable on this platform');
}
