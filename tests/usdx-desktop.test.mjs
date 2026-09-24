import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, realpath, rename } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { parseArguments, loadDesktopConfig, runDesktop } from '../tools/usdx-bridge/desktop.mjs';

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'usdx-desktop-'));
  t.after(() => { assert.equal(path.dirname(root), os.tmpdir()); assert.ok(path.basename(root).startsWith('usdx-desktop-')); return rm(root, { recursive: true, force: true }); });
  const songs = path.join(root, 'piosenki'); await mkdir(songs);
  await writeFile(path.join(root, 'ultrastardx.exe'), 'fixture');
  const file = path.join(root, 'bridge.json');
  let polls = 0;
  const server = createServer((request, response) => { polls++; response.setHeader('content-type', 'application/json'); response.end('{"command":null}'); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  await writeFile(file, '\uFEFF' + JSON.stringify({ serverUrl: `http://127.0.0.1:${server.address().port}`, token: 'a'.repeat(43), songsPath: songs }));
  return { root, file, polls: () => polls, settings: await loadDesktopConfig(file, root) };
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
  assert.equal(parseArguments(['--config', f.file, '--check']).check, true);
  assert.throws(() => parseArguments(['--unknown']), /argumenty/);
  await writeFile(f.file, '{"token":"do-not-print-this-secret');
  await assert.rejects(loadDesktopConfig(f.file, f.root), error => !error.message.includes('do-not-print') && error.message.includes('bridge.json'));
});

test('desktop keeps player settings, polls while game runs and stops after game exit', async t => {
  const f = await fixture(t);
  const saved = '[Game]\nPlayers=2\nDifficulty=Hard\n[Directories]\nSongDir1=X:/previous-installation/songs\n'; await writeFile(f.settings.gameConfig, saved);
  let child;
  const exit = await runDesktop(f.settings, { onConnection: () => {}, launch: (exe, args, options) => {
    assert.equal(exe, path.join(f.root, 'ultrastardx.exe'));
    assert.deepEqual(args, ['-ConfigFile', f.settings.gameConfig, '-ScoreFile', f.settings.scores, '-QueueBridge', f.settings.config.exchangePath, '-SongPath', f.settings.config.songsPath]);
    assert.equal(options.cwd, f.root);
    return child = spawn(process.execPath, ['-e', 'setTimeout(()=>{},800)'], { stdio: 'ignore', windowsHide: true });
  } });
  assert.equal(exit, 0); assert.equal(child.exitCode, 0); assert.ok(f.polls() > 0);
  assert.equal(await readFile(f.settings.gameConfig, 'utf8'), saved);
  const count = f.polls(); await new Promise(resolve => setTimeout(resolve, 600)); assert.equal(f.polls(), count);
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
