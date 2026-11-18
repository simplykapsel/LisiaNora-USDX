import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { runBridge } from '../tools/usdx-bridge/bridge.mjs';

const token = 't'.repeat(43);
const until = async (check, ms = 3000) => {
  for (const end = Date.now() + ms; Date.now() < end; await new Promise(resolve => setTimeout(resolve, 20))) if (await check()) return;
  throw new Error('timed out');
};

// Just enough of RFC 6455 for short text frames: the queue server's real socket is tested in its own repo.
function fakeQueue({ acceptSocket }) {
  const polls = [], reports = [];
  let socket = null;
  const send = text => {
    const payload = Buffer.from(text);
    socket.write(Buffer.concat([Buffer.from(payload.length < 126 ? [0x81, payload.length] : [0x81, 126, payload.length >> 8, payload.length & 255]), payload]));
  };
  const server = http.createServer((request, response) => {
    let body = '';
    request.on('data', chunk => { body += chunk; });
    request.on('end', () => { polls.push(JSON.parse(body)); response.setHeader('content-type', 'application/json'); response.end(JSON.stringify({ command: acceptSocket ? null : server.nextCommand ?? null })); });
  });
  server.on('upgrade', (request, stream) => {
    if (!acceptSocket || request.headers.authorization !== `Bearer ${token}`) return stream.end('HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\n\r\n');
    const accept = createHash('sha1').update(request.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
    stream.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    socket = stream;
    let buffered = Buffer.alloc(0);
    stream.on('data', chunk => {
      buffered = Buffer.concat([buffered, chunk]);
      for (;;) {
        if (buffered.length < 2) return;
        let length = buffered[1] & 0x7f, offset = 2;
        if (length === 126) { length = buffered.readUInt16BE(2); offset = 4; }
        if (buffered.length < offset + 4 + length) return;
        const mask = buffered.subarray(offset, offset + 4);
        const text = Buffer.from(buffered.subarray(offset + 4, offset + 4 + length).map((byte, index) => byte ^ mask[index % 4])).toString();
        const opcode = buffered[0] & 0x0f;
        buffered = buffered.subarray(offset + 4 + length);
        if (opcode === 8) { stream.end(); return; }
        const message = JSON.parse(text);
        if (message.type !== 'heartbeat') reports.push(message);
        if (reports.length === 1) { send('{"type":"ready"}'); if (server.nextCommand) send(JSON.stringify({ command: server.nextCommand })); }
      }
    });
    stream.on('error', () => {});
  });
  return { server, polls, reports };
}

async function scenario(t, acceptSocket) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'usdx-socket-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const songs = path.join(root, 'songs'), exchange = path.join(root, 'exchange');
  await mkdir(path.join(songs, 'Artist'), { recursive: true });
  await mkdir(exchange, { recursive: true });
  await writeFile(path.join(songs, 'Artist', 'song.txt'), 'chart');
  const status = extra => writeFile(path.join(exchange, 'status.json'), JSON.stringify({ protocol: 1, sessionId: 'game', ready: true, updatedAt: Date.now() / 1000, ...extra }));
  await status();
  const queue = fakeQueue({ acceptSocket });
  queue.server.nextCommand = { id: randomUUID(), action: 'select', sessionId: 'game', sourceRelativePath: 'Artist/song.txt',
    sourceHash: createHash('sha256').update('chart').digest('hex'), expiresAt: Date.now() + 15_000 };
  await new Promise(resolve => queue.server.listen(0, '127.0.0.1', resolve));
  const abort = new AbortController();
  const bridge = runBridge({ serverUrl: `http://127.0.0.1:${queue.server.address().port}`, token, songsPath: songs, exchangePath: exchange },
    { signal: abort.signal, onConnection: () => {} });
  t.after(async () => { abort.abort(); await bridge; queue.server.closeAllConnections(); queue.server.close(); });
  await until(() => existsSync(path.join(exchange, 'command.json')));
  const { id } = JSON.parse(await readFile(path.join(exchange, 'command.json'), 'utf8'));
  assert.equal(id, queue.server.nextCommand.id);
  await status({ id, result: 'selected' });
  return { queue, id };
}

test('bridge takes commands over the socket and reports the result there', async t => {
  const { queue, id } = await scenario(t, true);
  await until(() => queue.reports.some(report => report.ack?.id === id && report.ack.result === 'selected'));
  assert.ok(queue.polls.length <= 1, 'at most one poll while the socket was connecting');
});

test('bridge falls back to polling when the socket is refused', async t => {
  const { queue, id } = await scenario(t, false);
  await until(() => queue.polls.some(poll => poll.ack?.id === id && poll.ack.result === 'selected'));
  assert.equal(queue.reports.length, 0);
});
