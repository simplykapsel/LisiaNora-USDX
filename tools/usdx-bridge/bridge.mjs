import { createHash, randomUUID } from 'node:crypto';
import { readFile, realpath, stat, mkdir, writeFile, rename, rm, readdir } from 'node:fs/promises';
import path from 'node:path';

function isContained(base, file) {
  const relative = path.relative(base, file);
  return relative && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

export async function resolveSong(root, relative, hash, { findMoved } = {}) {
  if (typeof relative !== 'string' || !relative || relative.length > 2048 || relative.includes('\\')
    || relative.includes(':') || relative.includes('\0') || path.posix.isAbsolute(relative)
    || relative.split('/').some(part => !part || part === '..' || part === '.') || !/\.txt$/i.test(relative)
    || typeof hash !== 'string' || !/^[a-f0-9]{64}$/i.test(hash)) throw new Error('not_found');
  const base = await realpath(root);
  let file;
  try { file = await realpath(path.join(base, ...relative.split('/'))); }
  catch (error) {
    if (findMoved && ['ENOENT', 'ENOTDIR'].includes(error.code)) return findMoved(base, hash.toLowerCase());
    throw new Error('not_found');
  }
  if (!isContained(base, file)) throw new Error('not_found');
  const info = await stat(file);
  if (!info.isFile() || info.size > 16 * 1024 * 1024) throw new Error('not_found');
  if (createHash('sha256').update(await readFile(file)).digest('hex') !== hash.toLowerCase()) throw new Error('stale_file');
  return file;
}

// Catalog paths can outlive a local folder move. Only recover a unique, byte-identical
// chart inside this library; never guess by title or bypass checks on an existing path.
export function createSongResolver(root) {
  let index = null, indexedAt = 0, indexedBase = '';
  async function findMoved(base, hash) {
    if (!index || indexedBase !== base || Date.now() - indexedAt > 30_000) {
      const next = new Map();
      async function scan(directory) {
        for (const entry of await readdir(directory, { withFileTypes: true })) {
          // Do not traverse junctions or symbolic links during recovery.
          if (entry.isSymbolicLink()) continue;
          const candidate = path.join(directory, entry.name);
          const file = await realpath(candidate).catch(() => null);
          if (!file || !isContained(base, file)) continue;
          if (entry.isDirectory()) await scan(file);
          else if (entry.isFile() && /\.txt$/i.test(entry.name)) {
            try {
              const info = await stat(file);
              if (!info.isFile() || info.size > 16 * 1024 * 1024) continue;
              const digest = createHash('sha256').update(await readFile(file)).digest('hex');
              const matches = next.get(digest) ?? [];
              matches.push(file); next.set(digest, matches);
            } catch (error) { if (!['ENOENT', 'ENOTDIR'].includes(error.code)) throw error; }
          }
        }
      }
      await scan(base);
      index = next; indexedBase = base; indexedAt = Date.now();
    }
    const matches = index.get(hash) ?? [];
    if (matches.length !== 1) throw new Error('not_found');
    // Revalidate cached matches, including their current canonical path and hash.
    try { return await resolveSong(base, path.relative(base, matches[0]).split(path.sep).join('/'), hash); }
    catch (error) { index = null; throw error; }
  }
  return (relative, hash) => resolveSong(root, relative, hash, { findMoved });
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

export function canExecute(command, game) {
  const action = command.action ?? 'select';
  if (!game || game.sessionId !== command.sessionId) throw new Error('game_offline');
  if (action === 'select') { if (!game.ready) throw new Error('busy'); }
  else if (game.controlProtocol !== 2) throw new Error('unsupported');
  else if (action === 'start') {
    if (!game.canStart || !command.selectionId || command.selectionId !== game.selectionId) throw new Error('busy');
  } else if (action === 'reset') {
    if (!game.canReset || !command.performanceId || command.performanceId !== game.performanceId) throw new Error('busy');
  } else throw new Error('unsupported');
}

export async function prepareGameCommand(config, command, resolve) {
  canExecute(command, await gameStatus(config.exchangePath));
  const action = command.action ?? 'select';
  const file = action === 'reset' ? undefined : await resolve(command.sourceRelativePath, command.sourceHash);
  const current = await gameStatus(config.exchangePath);
  canExecute(command, current);
  if (action === 'start' && path.relative(file, current.selectedFile ?? '') !== '') throw new Error('busy');
  if (command.expiresAt <= Date.now()) throw new Error('expired');
  return { protocol: action === 'select' ? 1 : 2, action, id: command.id, sessionId: command.sessionId,
    file, selectionId: command.selectionId, performanceId: command.performanceId,
    expiresAt: Math.floor(command.expiresAt / 1000) };
}

export async function runBridge(input, { signal, onConnection = console.info } = {}) {
  const config = validateConfig(input);
  await realpath(config.songsPath);
  await mkdir(config.exchangePath, { recursive: true });
  const resolve = createSongResolver(config.songsPath);
  const agentId = randomUUID();
  let ack = null, pending = null, connection = '';
  const report = text => { if (connection !== text) { connection = text; onConnection(text); } };
  while (!signal?.aborted) {
    try {
      const game = await gameStatus(config.exchangePath);
      if (pending) {
        if (!game || game.sessionId !== pending.sessionId) { ack = { id: pending.id, result: 'game_offline' }; pending = null; }
        else if (game.id === pending.id && ['selected', 'started', 'reset', 'busy', 'not_found', 'expired', 'error'].includes(game.result)) {
          ack = { id: pending.id, result: game.result }; pending = null;
        } else if (pending.expiresAt <= Date.now()) { ack = { id: pending.id, result: 'expired' }; pending = null; }
      }
      const response = await fetch(config.serverUrl + '/api/bridge/usdx/poll', {
        method: 'POST', redirect: 'error', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(4000)]) : AbortSignal.timeout(4000),
        headers: { authorization: `Bearer ${config.token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ agentId, game: game ? { sessionId: game.sessionId, ready: game.ready,
          controlProtocol: game.controlProtocol, canStart: game.canStart, canReset: game.canReset,
          awaitingPlayers: game.awaitingPlayers, selectionId: game.selectionId,
          performanceId: game.performanceId, performanceState: game.performanceState } : null, ack }),
      });
      if (!response.ok) throw new Error(`Server returned HTTP ${response.status}`);
      const { command } = await response.json();
      report(game ? 'Połączono z kolejką i USDX.' : 'Połączono z kolejką. Uruchom USDX z obsługą kolejki.');
      if (command && command.id !== pending?.id && command.id !== ack?.id) {
        if (!game || command.sessionId !== game.sessionId) ack = { id: command.id, result: 'game_offline' };
        else if (!Number.isFinite(command.expiresAt) || command.expiresAt <= Date.now() || command.expiresAt > Date.now() + 20_000) ack = { id: command.id, result: 'expired' };
        else {
          try {
            const payload = await prepareGameCommand(config, command, resolve);
            await atomicJson(path.join(config.exchangePath, 'command.json'), payload);
            pending = command;
          } catch (error) {
            const result = ['not_found', 'stale_file', 'game_offline', 'busy', 'expired', 'unsupported'].includes(error.message) ? error.message : 'error';
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
