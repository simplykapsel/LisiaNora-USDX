import { createHash, randomUUID } from 'node:crypto';
import { readFile, realpath, stat, mkdir, writeFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';

export async function resolveSong(root, relative, hash) {
  if (typeof relative !== 'string' || !relative || relative.length > 2048 || relative.includes('\\')
    || relative.includes(':') || relative.includes('\0') || path.posix.isAbsolute(relative)
    || relative.split('/').some(part => !part || part === '..' || part === '.') || !/\.txt$/i.test(relative)
    || typeof hash !== 'string' || !/^[a-f0-9]{64}$/i.test(hash)) throw new Error('not_found');
  const base = await realpath(root);
  let file;
  try { file = await realpath(path.join(base, ...relative.split('/'))); } catch { throw new Error('not_found'); }
  const contained = path.relative(base, file);
  if (!contained || contained.startsWith(`..${path.sep}`) || contained === '..' || path.isAbsolute(contained)) throw new Error('not_found');
  const info = await stat(file);
  if (!info.isFile() || info.size > 16 * 1024 * 1024) throw new Error('not_found');
  if (createHash('sha256').update(await readFile(file)).digest('hex') !== hash.toLowerCase()) throw new Error('stale_file');
  return file;
}
export async function atomicJson(file, value) {
  const temporary = file + '.' + randomUUID() + '.tmp';
  await writeFile(temporary, JSON.stringify(value), { encoding: 'utf8', mode: 0o600 });
  try { await rename(temporary, file); } finally { await rm(temporary, { force: true }); }
}
export async function gameStatus(directory) {
  try {
    const file = path.join(directory, 'status.json');
    if ((await stat(file)).size > 16384) return null;
    const game = JSON.parse(await readFile(file, 'utf8'));
    if (game.protocol !== 1 || typeof game.sessionId !== 'string' || typeof game.ready !== 'boolean'
      || !Number.isFinite(game.updatedAt) || Math.abs(Date.now() / 1000 - game.updatedAt) > 5) return null;
    return game;
  } catch { return null; }
}
export function validateConfig(config) {
  const url = new URL(config.serverUrl);
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('Use the application origin as serverUrl.');
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))) {
    throw new Error('Use HTTPS for a remote server; HTTP is allowed only on localhost.');
  }
  if (!/^[A-Za-z0-9_-]{43,128}$/.test(config.token ?? '')) throw new Error('Missing or invalid bridge token.');
  if (!path.isAbsolute(config.songsPath ?? '') || !path.isAbsolute(config.exchangePath ?? '')) throw new Error('Use absolute songsPath and exchangePath.');
  return { ...config, serverUrl: url.origin };
}

export async function runBridge(input, { signal, onConnection = console.info } = {}) {
  const config = validateConfig(input);
  await realpath(config.songsPath);
  await mkdir(config.exchangePath, { recursive: true });
  const agentId = randomUUID();
  let ack = null, pending = null, connection = '';
  const report = text => { if (connection !== text) { connection = text; onConnection(text); } };
  while (!signal?.aborted) {
    try {
      const game = await gameStatus(config.exchangePath);
      if (pending) {
        if (!game || game.sessionId !== pending.sessionId) { ack = { id: pending.id, result: 'game_offline' }; pending = null; }
        else if (game.id === pending.id && ['selected', 'busy', 'not_found', 'expired', 'error'].includes(game.result)) {
          ack = { id: pending.id, result: game.result }; pending = null;
        } else if (pending.expiresAt <= Date.now()) { ack = { id: pending.id, result: 'expired' }; pending = null; }
      }
      const response = await fetch(config.serverUrl + '/api/bridge/usdx/poll', {
        method: 'POST', redirect: 'error', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(4000)]) : AbortSignal.timeout(4000),
        headers: { authorization: `Bearer ${config.token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ agentId, game: game ? { sessionId: game.sessionId, ready: game.ready } : null, ack }),
      });
      if (!response.ok) throw new Error(`Server returned HTTP ${response.status}`);
      const { command } = await response.json();
      report(game ? 'Połączono z kolejką i USDX.' : 'Połączono z kolejką. Uruchom USDX z obsługą kolejki.');
      if (command && command.id !== pending?.id && command.id !== ack?.id) {
        if (!game || command.sessionId !== game.sessionId) ack = { id: command.id, result: 'game_offline' };
        else if (!Number.isFinite(command.expiresAt) || command.expiresAt <= Date.now() || command.expiresAt > Date.now() + 20_000) ack = { id: command.id, result: 'expired' };
        else if (!game.ready) ack = { id: command.id, result: 'busy' };
        else {
          try {
            const file = await resolveSong(config.songsPath, command.sourceRelativePath, command.sourceHash);
            // Recheck after disk I/O so an old selection never crosses a game restart or a deadline.
            const current = await gameStatus(config.exchangePath);
            if (!current || current.sessionId !== command.sessionId) throw new Error('game_offline');
            if (!current.ready) throw new Error('busy');
            if (command.expiresAt <= Date.now()) throw new Error('expired');
            await atomicJson(path.join(config.exchangePath, 'command.json'), { protocol: 1, id: command.id,
              sessionId: command.sessionId, file, expiresAt: Math.floor(command.expiresAt / 1000) });
            pending = command;
          } catch (error) {
            const result = ['not_found', 'stale_file', 'game_offline', 'busy', 'expired'].includes(error.message) ? error.message : 'error';
            ack = { id: command.id, result };
          }
        }
      }
    } catch (error) {
      if (signal?.aborted) break;
      // Do not log request headers, token, response bodies, or song paths.
      report('Brak połączenia z kolejką. Sprawdź adres i klucz. Ponawiam połączenie.');
    }
    await new Promise(resolve => { const timer = setTimeout(done, 500); function done() { clearTimeout(timer); signal?.removeEventListener('abort', done); resolve(); } signal?.addEventListener('abort', done, { once: true }); });
  }
}
