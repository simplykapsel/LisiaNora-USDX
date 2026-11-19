import { createHash, randomUUID } from 'node:crypto';
import { watch } from 'node:fs';
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
  return (relative, hash, search = true) => resolveSong(root, relative, hash, search ? { findMoved } : {});
}

export function createLibraryResolver(roots) {
  const resolvers = roots.map(createSongResolver);
  async function find(relative, hash, search) {
    const matches = new Set();
    let stale = false;
    for (const resolve of resolvers) {
      try { matches.add(await resolve(relative, hash, search)); }
      catch (error) {
        if (error.message === 'stale_file') stale = true;
        else if (error.message !== 'not_found') throw error;
      }
    }
    return { matches, stale };
  }
  return async (relative, hash) => {
    // A moved-chart search hashes every chart in a library and can outlast the command,
    // so run it only when no library has the catalog path.
    let { matches, stale } = await find(relative, hash, false);
    if (!matches.size) ({ matches, stale } = await find(relative, hash, true));
    if (matches.size === 1) return [...matches][0];
    throw new Error(matches.size === 0 && stale ? 'stale_file' : 'not_found');
  };
}
export async function atomicJson(file, value) {
  const temporary = file + '.' + randomUUID() + '.tmp';
  await writeFile(temporary, JSON.stringify(value), { encoding: 'utf8', mode: 0o600 });
  try {
    for (let attempt = 0; ; attempt++) {
      try { await rename(temporary, file); break; }
      catch (error) {
        // A concurrent Windows reader can briefly prevent atomic replacement.
        if (attempt >= 4 || !['EPERM', 'EBUSY', 'EACCES'].includes(error.code)) throw error;
        await new Promise(resolve => setTimeout(resolve, 25));
      }
    }
  } finally { await rm(temporary, { force: true }); }
}
export async function gameStatus(directory) {
  const file = path.join(directory, 'status.json');
  // The game replaces status.json by delete + rename; a read between the two must not look like a closed game,
  // or the queue expires the command the game is executing.
  for (let attempt = 0; ; attempt++) {
    try {
      if ((await stat(file)).size > 16384) return null;
      const game = JSON.parse(await readFile(file, 'utf8'));
      if (game.protocol !== 1 || typeof game.sessionId !== 'string' || typeof game.ready !== 'boolean'
        || !Number.isFinite(game.updatedAt) || Math.abs(Date.now() / 1000 - game.updatedAt) > 5) return null;
      return game;
    } catch {
      if (attempt >= 3) return null;
      await new Promise(resolve => setTimeout(resolve, 25));
    }
  }
}
export function validateConfig(config) {
  const url = new URL(config.serverUrl);
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('Use the application origin as serverUrl.');
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))) {
    throw new Error('Use HTTPS for a remote server; HTTP is allowed only on localhost.');
  }
  if (!/^[A-Za-z0-9_-]{43,128}$/.test(config.token ?? '')) throw new Error('Missing or invalid bridge token.');
  if (!path.isAbsolute(config.songsPath ?? '') || !path.isAbsolute(config.exchangePath ?? '')) throw new Error('Use absolute songsPath and exchangePath.');
  if (config.songsPaths !== undefined && (!Array.isArray(config.songsPaths) || !config.songsPaths.length
    || config.songsPaths.some(root => typeof root !== 'string' || !path.isAbsolute(root)))) throw new Error('Use absolute songsPaths.');
  return { ...config, serverUrl: url.origin };
}

export function canExecute(command, game) {
  const action = command.action ?? 'select';
  if (!game || game.sessionId !== command.sessionId) throw new Error('game_offline');
  if (action === 'select') { if (!game.ready) throw new Error('busy'); }
  else if (!(game.controlProtocol >= 2)) throw new Error('unsupported');
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
    ...(action === 'start' && current.controlProtocol >= 3 ? { players: playerNames(command.players), swapVoices: command.swapVoices === true } : {}),
    expiresAt: Math.floor(command.expiresAt / 1000) };
}

// The game font has no emoji and control characters must not reach the screen.
export function playerNames(players) {
  if (!Array.isArray(players)) return [];
  return players.flatMap(player => {
    const name = [...String(player?.name ?? '').normalize('NFC').replace(/[\p{Cc}\p{Cf}\p{Extended_Pictographic}\u{FE0E}\u{FE0F}]/gu, '').replace(/\s+/gu, ' ').trim()].slice(0, 24).join('').trim();
    return Number.isInteger(player?.slot) && player.slot >= 1 && player.slot <= 6 && name ? [{ slot: player.slot, name }] : [];
  });
}

// The queue validates reports strictly, so only known result fields leave the stage computer.
function performanceResult(result) {
  if (!result || typeof result.performanceId !== 'string' || !Array.isArray(result.players)) return undefined;
  return { performanceId: result.performanceId, rapToFreestyle: result.rapToFreestyle === true,
    players: result.players.slice(0, 6).map(({ slot, track, score }) => ({ slot, track, score })) };
}

export function queueState(game) {
  if (!game) return null;
  const { sessionId, ready, controlProtocol, canStart, canReset, awaitingPlayers, selectionId, performanceId, performanceState, playerCount, duetSwapped } = game;
  return { sessionId, ready, controlProtocol, canStart, canReset, awaitingPlayers, selectionId, performanceId, performanceState,
    playerCount, duetSwapped, performanceResult: performanceResult(game.performanceResult) };
}

function gameResult(pending, game) {
  if (!game || game.sessionId !== pending.sessionId) return 'game_offline';
  if (game.id === pending.id && ['selected', 'started', 'reset', 'busy', 'not_found', 'expired', 'error'].includes(game.result)) return game.result;
  return pending.expiresAt <= Date.now() ? 'expired' : null;
}

export async function runBridge(input, { signal, onConnection = console.info } = {}) {
  const config = validateConfig(input);
  const roots = config.songsPaths ?? [config.songsPath];
  for (const root of roots) await realpath(root);
  await mkdir(config.exchangePath, { recursive: true });
  const resolve = createLibraryResolver(roots);
  const agentId = randomUUID();
  let ack = null, pending = null, connection = '';
  const report = text => { if (connection !== text) { connection = text; onConnection(text); } };
  const wait = milliseconds => new Promise(resolve => {
    const timer = setTimeout(done, milliseconds);
    function done() { clearTimeout(timer); signal?.removeEventListener('abort', done); resolve(); }
    signal?.addEventListener('abort', done, { once: true });
    if (signal?.aborted) done();
  });
  const settle = game => {
    const result = pending && gameResult(pending, game);
    if (result) { ack = { id: pending.id, result }; pending = null; }
  };
  async function accept(received, game, cancelled) {
    if (!received || received.id === pending?.id || received.id === ack?.id) return;
    // Use the remaining lifetime when the server sends it, so a drifting local clock cannot expire commands.
    const incoming = Number.isFinite(received.expiresIn) ? { ...received, expiresAt: Date.now() + received.expiresIn } : received;
    if (!game || incoming.sessionId !== game.sessionId) ack = { id: incoming.id, result: 'game_offline' };
    else if (!Number.isFinite(incoming.expiresAt) || incoming.expiresAt <= Date.now() || incoming.expiresAt > Date.now() + 20_000) ack = { id: incoming.id, result: 'expired' };
    else {
      try {
        const payload = await prepareGameCommand(config, incoming, resolve);
        if (cancelled()) return;
        await atomicJson(path.join(config.exchangePath, 'command.json'), payload);
        pending = incoming;
      } catch (error) {
        const result = ['not_found', 'stale_file', 'game_offline', 'busy', 'expired', 'unsupported'].includes(error.message) ? error.message : 'error';
        ack = { id: incoming.id, result };
      }
    }
  }
  // HTTP polling keeps the queue working when the socket is refused (for example behind a proxy).
  async function poll() {
    const game = await gameStatus(config.exchangePath);
    settle(game);
    const response = await fetch(new URL('/api/bridge/usdx/poll', config.serverUrl), {
      method: 'POST', redirect: 'error', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(4000)]) : AbortSignal.timeout(4000),
      headers: { authorization: 'Bearer ' + config.token, 'content-type': 'application/json' },
      body: JSON.stringify({ agentId, game: queueState(game), ack }),
    });
    if (!response.ok) throw new Error(`Server returned HTTP ${response.status}`);
    const { command } = await response.json();
    report(game ? 'Połączono z kolejką i USDX.' : 'Połączono z kolejką. Uruchom USDX z obsługą kolejki.');
    await accept(command, game, () => signal?.aborted);
  }
  const url = new URL('/api/bridge/usdx/socket', config.serverUrl);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  let retry = 500;
  while (!signal?.aborted) {
    const socket = new WebSocket(url, { headers: { authorization: 'Bearer ' + config.token } });
    let command = null, previous = '', ready = false, closed = false;
    let wake, heartbeatAt = Date.now(), lastReply = heartbeatAt;
    const interrupt = () => wake?.();
    const stop = () => { closed = true; socket.close(); interrupt(); };
    signal?.addEventListener('abort', stop, { once: true });
    socket.addEventListener('open', interrupt);
    socket.addEventListener('close', () => { closed = true; interrupt(); });
    socket.addEventListener('error', stop);
    // The game rewrites status.json on every change; react at once instead of on the next tick.
    let watcher = null;
    try { watcher = watch(config.exchangePath, interrupt); watcher.on('error', () => {}); } catch { /* The 500 ms tick still runs. */ }
    socket.addEventListener('message', event => {
      try {
        const packet = JSON.parse(event.data);
        if (packet.type === 'ready') { ready = true; retry = 500; }
        else if (packet.type !== 'alive') {
          if (!ready || !packet.command?.id) return stop();
          command = packet.command;
        }
        lastReply = Date.now();
        interrupt();
      } catch { stop(); }
    });
    try {
      while (!closed && !signal?.aborted) {
        // A heartbeat every 5 s and 15 s without any reply spot a dead link (e.g. a dropped mobile connection) quickly.
        if (Date.now() - lastReply > (ready ? 15_000 : 5_000)) break;
        if (socket.readyState === WebSocket.OPEN) {
          const game = await gameStatus(config.exchangePath);
          if (closed || signal?.aborted) break;
          settle(game);
          const state = JSON.stringify({ agentId, game: queueState(game), ack });
          if (state !== previous) { socket.send(state); previous = state; }
          if (ready) {
            report(game ? 'Połączono z kolejką i USDX.' : 'Połączono z kolejką. Uruchom USDX z obsługą kolejki.');
            if (Date.now() - heartbeatAt >= 5_000) {
              socket.send('{"type":"heartbeat"}');
              heartbeatAt = Date.now();
            }
          }
          const incoming = command;
          command = null;
          await accept(incoming, game, () => closed || signal?.aborted);
        }
        if (!command && !closed && !signal?.aborted) await new Promise(resolve => {
          const timer = setTimeout(done, 500);
          function done() { clearTimeout(timer); wake = undefined; resolve(); }
          wake = done;
        });
      }
    } finally {
      signal?.removeEventListener('abort', stop);
      watcher?.close();
      stop();
    }
    if (signal?.aborted) break;
    const nextSocket = Date.now() + retry;
    if (ready) {
      report('Brak połączenia z kolejką. Sprawdź adres i klucz. Ponawiam połączenie.');
      await wait(retry);
    } else while (!signal?.aborted && Date.now() < nextSocket) {
      try { await poll(); }
      catch {
        if (signal?.aborted) break;
        // Do not log request headers, token, response bodies, or song paths.
        report('Brak połączenia z kolejką. Sprawdź adres i klucz. Ponawiam połączenie.');
      }
      // A slow poll can outlast the retry window; a negative delay only makes Node warn.
      await wait(Math.max(0, Math.min(500, nextSocket - Date.now())));
    }
    retry = Math.min(15_000, retry * 2);
  }
}
