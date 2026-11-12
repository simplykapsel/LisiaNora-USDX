import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, realpath, rename, symlink } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { createHash, randomUUID } from 'node:crypto';
import { WebSocketServer } from 'ws';
import { atomicJson, runBridge } from '../tools/usdx-bridge/bridge.mjs';
import { parseArguments, loadDesktopConfig, runDesktop } from '../tools/usdx-bridge/desktop.mjs';

async function fixture(t, { withLibraryAlias = false } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'usdx-desktop-'));
  t.after(() => { assert.equal(path.dirname(root), os.tmpdir()); assert.ok(path.basename(root).startsWith('usdx-desktop-')); return rm(root, { recursive: true, force: true }); });
  const songs = path.join(root, 'piosenki'); await mkdir(songs);
  const songsPath = withLibraryAlias ? path.join(root, 'library-alias') : songs;
  if (withLibraryAlias) await symlink(songs, songsPath, process.platform === 'win32' ? 'junction' : 'dir');
  await writeFile(path.join(root, 'ultrastardx.exe'), 'fixture');
  const file = path.join(root, 'bridge.json');
  const reports = [];
  const server = createServer();
  const sockets = new WebSocketServer({ server, path: '/api/bridge/usdx/socket' });
  sockets.on('connection', (socket, request) => {
    assert.equal(request.headers.authorization, 'Bearer ' + 'a'.repeat(43));
    let accepted = false;
    socket.on('message', data => {
      const message = JSON.parse(data);
      if (message.type === 'heartbeat') return socket.send('{"type":"alive"}');
      reports.push(message);
      if (!accepted) { accepted = true; socket.send('{"type":"ready"}'); }
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => {
    for (const socket of sockets.clients) socket.terminate();
    sockets.close();
    server.close(resolve);
  }));
  await writeFile(file, '\uFEFF' + JSON.stringify({ serverUrl: `http://127.0.0.1:${server.address().port}`, token: 'a'.repeat(43), songsPath }));
  return { root, file, reports, sockets, settings: await loadDesktopConfig(file, root) };
}

test('desktop defaults to the executable directory, independent of working directory, and allows an explicit profile', () => {
  const directory = path.join(os.tmpdir(), 'USDX portable');
  assert.notEqual(path.resolve(directory), process.cwd());
  assert.equal(parseArguments([], directory).configPath, path.join(directory, 'bridge.json'));
  const custom = path.join(os.tmpdir(), 'profiles', 'vps.json');
  assert.equal(parseArguments(['--config', custom], directory).configPath, custom);
});

test('desktop config uses profile-local data, reads PowerShell BOM and rejects malformed secrets without echoing them', async t => {
  const f = await fixture(t);
  assert.equal(f.settings.config.exchangePath, path.join(f.root, '.queue-bridge'));
  assert.equal(f.settings.scores, path.join(f.root, 'scores.db'));
  assert.equal(f.settings.gameConfig, path.join(f.root, 'config.ini'));
  assert.equal(parseArguments(['--config', f.file, '--check']).check, true);
  assert.throws(() => parseArguments(['--unknown']), /argumenty/);
  await writeFile(f.file, '{"token":"do-not-print-this-secret');
  await assert.rejects(loadDesktopConfig(f.file, f.root), error => !error.message.includes('do-not-print') && error.message.includes('bridge.json'));
});

test('desktop keeps player settings and sends one initial report while the game is idle', async t => {
  const f = await fixture(t, { withLibraryAlias: true });
  assert.equal(f.settings.config.songsPath, await realpath(path.join(f.root, 'piosenki')));
  const saved = '[Game]\nPlayers=2\nDifficulty=Hard\n[Directories]\nSongDir1=X:/previous-installation/songs\n'; await writeFile(f.settings.gameConfig, saved);
  let child;
  const exit = await runDesktop(f.settings, { onConnection: () => {}, launch: (exe, args, options) => {
    assert.equal(exe, path.join(f.root, 'ultrastardx.exe'));
    assert.deepEqual(args, ['-ConfigFile', f.settings.gameConfig, '-ScoreFile', f.settings.scores, '-QueueBridge', f.settings.config.exchangePath, '-SongPath', f.settings.config.songsPath]);
    assert.equal(options.cwd, f.root);
    return child = spawn(process.execPath, ['-e', 'setTimeout(()=>{},800)'], { stdio: 'ignore', windowsHide: true });
  } });
  assert.equal(exit, 0); assert.equal(child.exitCode, 0); assert.equal(f.reports.length, 1);
  assert.equal(await readFile(f.settings.gameConfig, 'utf8'), saved);
  await new Promise(resolve => setTimeout(resolve, 600)); assert.equal(f.sockets.clients.size, 0);
});

test('cancelling desktop supervision terminates only its child game', async t => {
  const f = await fixture(t); const abort = new AbortController(); let child;
  const running = runDesktop(f.settings, { signal: abort.signal, onConnection: () => {}, launch: () => {
    child = spawn(process.execPath, ['-e', 'setTimeout(()=>{},30000)'], { stdio: 'ignore', windowsHide: true });
    child.once('spawn', () => abort.abort()); return child;
  } });
  assert.equal(await running, 1); assert.ok(child.killed);
  assert.match(await readFile(f.settings.gameConfig, 'utf8'), /Language=Polish/);
  assert.doesNotMatch(await readFile(f.settings.gameConfig, 'utf8'), /SongDir/);
});

test('local game timestamps stay off the wire and reconnect resends the last acknowledgment', { timeout: 15_000 }, async t => {
  const { settings: { config }, reports, sockets } = await fixture(t);
  const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
  async function until(check) {
    const deadline = Date.now() + 4_000;
    while (!await check()) {
      if (Date.now() > deadline) assert.fail('Timed out waiting for the bridge');
      await wait(20);
    }
  }
  await mkdir(config.exchangePath, { recursive: true });
  const file = path.join(config.exchangePath, 'command.json');
  const game = { protocol: 1, sessionId: 'game', ready: true, controlProtocol: 2 };
  const save = () => atomicJson(path.join(config.exchangePath, 'status.json'), { ...game, updatedAt: Date.now() / 1000 });
  await save();
  await writeFile(path.join(config.songsPath, 'song.txt'), 'chart');
  const abort = new AbortController();
  const running = runBridge(config, { signal: abort.signal, onConnection() {} });
  try {
    await until(() => reports.length);
    await save(); await wait(700); await save(); await wait(700);
    assert.equal(reports.length, 1);
    const command = { action: 'select', id: randomUUID(), sessionId: game.sessionId,
      sourceRelativePath: 'song.txt', sourceHash: createHash('sha256').update('chart').digest('hex'), expiresAt: Date.now() + 12_000 };
    const [first] = sockets.clients;
    first.send(JSON.stringify({ command }));
    await until(async () => JSON.parse(await readFile(file, 'utf8').catch(() => 'null'))?.id === command.id);
    game.id = command.id; game.result = 'selected'; game.selectionId = command.id;
    await save();
    await until(() => reports.at(-1)?.ack?.id === command.id);
    const accepted = reports.at(-1);
    first.terminate();
    await until(() => reports.at(-1) !== accepted);
    assert.deepEqual(reports.at(-1), accepted);
    await rm(file);
    const [second] = sockets.clients;
    second.send(JSON.stringify({ command }));
    await wait(700);
    await assert.rejects(readFile(file), { code: 'ENOENT' });
  } finally { abort.abort(); await running; }
});

test('omitting songsPath creates a portable library next to the executable, even with an external profile', async t => {
  const f = await fixture(t);
  const input = JSON.parse((await readFile(f.file, 'utf8')).replace(/^\uFEFF/, ''));
  delete input.songsPath;
  const profileDirectory = path.join(f.root, 'profiles'); await mkdir(profileDirectory);
  const profile = path.join(profileDirectory, 'bridge.json');
  await writeFile(profile, JSON.stringify(input));
  const installation = path.join(f.root, 'installation'); await mkdir(installation);
  await writeFile(path.join(installation, 'ultrastardx.exe'), 'fixture');
  const settings = await loadDesktopConfig(profile, installation);
  assert.equal(settings.config.songsPath, await realpath(path.join(installation, 'songs')));
  assert.equal(settings.config.exchangePath, path.join(profileDirectory, '.queue-bridge'));
  await writeFile(path.join(settings.config.songsPath, 'Song.txt'), 'chart');
  const relocated = path.join(f.root, 'moved installation'); await rename(installation, relocated);
  const moved = await loadDesktopConfig(profile, relocated);
  assert.equal(moved.config.songsPath, await realpath(path.join(relocated, 'songs')));
  assert.equal(await readFile(path.join(moved.config.songsPath, 'Song.txt'), 'utf8'), 'chart');
  assert.equal(await readFile(profile, 'utf8'), JSON.stringify(input));
});

test('explicit external libraries remain supported and invalid paths do not fall back silently', async t => {
  const f = await fixture(t);
  assert.equal(f.settings.config.songsPath, await realpath(path.join(f.root, 'piosenki')));
  const input = JSON.parse((await readFile(f.file, 'utf8')).replace(/^\uFEFF/, ''));
  input.songsPath = path.join(f.root, 'missing'); await writeFile(f.file, JSON.stringify(input));
  await assert.rejects(loadDesktopConfig(f.file, f.root), { code: 'ENOENT' });
  input.songsPath = path.join(f.root, 'ultrastardx.exe'); await writeFile(f.file, JSON.stringify(input));
  await assert.rejects(loadDesktopConfig(f.file, f.root), /katalogiem/);
});

test('config.ini directories override an obsolete JSON library and reach both game and bridge', async t => {
  const f = await fixture(t);
  const external = path.join(f.root, 'Dysk przenośny'); await mkdir(external);
  const relative = path.join(f.root, 'Druga biblioteka'); await mkdir(relative);
  const saved = '\uFEFF[Game]\nPlayers=2\n[directories]\nSongDir1=' + external
    + '\nSongDir2=Druga biblioteka\nSongDir3=' + path.join(f.root, 'disconnected') + '\nSongDir4= \n';
  await writeFile(path.join(f.root, 'config.ini'), saved);
  const input = JSON.parse((await readFile(f.file, 'utf8')).replace(/^\uFEFF/, ''));
  input.songsPath = path.join(f.root, 'obsolete'); await writeFile(f.file, JSON.stringify(input));
  const settings = await loadDesktopConfig(f.file, f.root);
  assert.deepEqual(settings.config.songsPaths, await Promise.all([
    path.join(f.root, 'songs'), external, relative,
  ].map(directory => realpath(directory))));
  const abort = new AbortController();
  await runDesktop(settings, { signal: abort.signal, onConnection: () => {}, launch: (exe, args) => {
    assert.equal(args[args.indexOf('-ConfigFile') + 1], path.join(f.root, 'config.ini'));
    assert.equal(args.includes('-SongPath'), false);
    const child = spawn(process.execPath, ['-e', 'setTimeout(()=>{},30000)'], { stdio: 'ignore', windowsHide: true });
    child.once('spawn', () => abort.abort()); return child;
  } });
  assert.equal(await readFile(settings.gameConfig, 'utf8'), saved);
});

test('desktop ignores game.ini and creates only config.ini', async t => {
  const f = await fixture(t);
  const legacy = path.join(f.root, 'game.ini');
  const saved = '[Game]\nPlayers=4\n[Record]\nDeviceName=USB microphone\n[Directories]\nSongDir1=' + path.join(f.root, 'piosenki') + '\n';
  await writeFile(legacy, saved);
  const settings = await loadDesktopConfig(f.file, f.root);
  await assert.rejects(readFile(settings.gameConfig, 'utf8'), { code: 'ENOENT' });
  const abort = new AbortController();
  await runDesktop(settings, { signal: abort.signal, onConnection: () => {}, launch: () => {
    const child = spawn(process.execPath, ['-e', 'setTimeout(()=>{},30000)'], { stdio: 'ignore', windowsHide: true });
    child.once('spawn', () => abort.abort()); return child;
  } });
  assert.equal(await readFile(settings.gameConfig, 'utf8'), '[Game]\nLanguage=Polish\n');
  assert.equal(await readFile(legacy, 'utf8'), saved);
});
