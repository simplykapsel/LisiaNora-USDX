import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
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
  const saved = '[Game]\nPlayers=2\nDifficulty=Hard\n'; await writeFile(f.settings.gameConfig, saved);
  let child;
  const exit = await runDesktop(f.settings, { onConnection: () => {}, launch: (exe, args, options) => {
    assert.equal(exe, path.join(f.root, 'ultrastardx.exe'));
    assert.deepEqual(args, ['-ConfigFile', f.settings.gameConfig, '-ScoreFile', f.settings.scores, '-QueueBridge', f.settings.config.exchangePath]);
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
  assert.match(await readFile(f.settings.gameConfig, 'utf8'), /SongDir1=/);
});
