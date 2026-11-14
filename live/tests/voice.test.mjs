import assert from 'node:assert/strict';
import test from 'node:test';
import WebSocket from 'ws';
import { Voice } from '../src/voice.ts';

function fixture(send) {
  const playback = [];
  const voice = new Voice(async () => {}, () => {}, id => playback.push(id));
  voice.socket = { readyState: WebSocket.OPEN, send };
  return { voice, playback };
}

test('detects missing audio and allows the next reply to finish', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { voice, playback } = fixture(() => {});
  const signal = new AbortController().signal;
  const first = voice.speak('First reply', null, signal);
  t.mock.timers.tick(5_000);
  assert.equal(await first, 'timeout');
  assert.equal(playback.at(-1), null);

  const second = voice.speak('Second reply', 'delegation', signal);
  const current = playback.at(-1);
  voice.reportPlayback(playback[0], 'player-failed');
  voice.reportPlayback(current, 'activity');
  t.mock.timers.tick(1_000);
  voice.reportPlayback(current, 'activity');
  t.mock.timers.tick(1_400);
  assert.equal(await second, 'played');
  assert.equal(playback.at(-1), null);
});

test('reports send and audio player failures and cancels obsolete speech', async () => {
  const { voice, playback } = fixture((message, callback) => {
    if (JSON.parse(message).content === 'Failed send') callback(new Error('Connection lost'));
  });
  const attempt = new AbortController();
  assert.equal(await voice.speak('Failed send', null, attempt.signal), 'send-failed');

  const rejected = voice.speak('Player failure', null, attempt.signal);
  voice.reportPlayback(playback.at(-1), 'player-failed');
  assert.equal(await rejected, 'player-failed');

  const canceled = voice.speak('Obsolete reply', null, attempt.signal);
  attempt.abort();
  assert.equal(await canceled, 'canceled');
  assert.equal(playback.at(-1), null);
});
