import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { mkdtemp, writeFile, mkdir, rm, realpath, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { resolveSong, createSongResolver, createLibraryResolver, validateConfig, prepareGameCommand, canExecute, playerNames, queueState, gameStatus } from '../tools/usdx-bridge/bridge.mjs';
const token = 'a'.repeat(43);
const hash = createHash('sha256').update('chart').digest('hex');

test('queue searches all INI libraries and rejects ambiguous or escaping selections', async t => {
  const root = await temporary(t);
  const first = path.join(root, 'first'), second = path.join(root, 'second');
  await mkdir(first); await mkdir(second);
  const chart = path.join(second, 'Piosenka.txt'); await writeFile(chart, 'chart');
  const resolve = createLibraryResolver([first, second]);
  assert.equal(await resolve('Piosenka.txt', hash), await realpath(chart));
  assert.equal(await createLibraryResolver([second, second])('Piosenka.txt', hash), await realpath(chart));
  await assert.rejects(resolve('../second/Piosenka.txt', hash), /not_found/);
  await assert.rejects(resolve('Piosenka.txt', '0'.repeat(64)), /stale_file/);
  await writeFile(path.join(first, 'Piosenka.txt'), 'chart');
  await assert.rejects(resolve('Piosenka.txt', hash), /not_found/);
  await assert.rejects(createLibraryResolver([first, second])('missing.txt', hash), /not_found/);
});

test('a chart at its catalog path skips the moved-chart search in other libraries', async t => {
  const root = await temporary(t);
  const first = path.join(root, 'first'), second = path.join(root, 'second');
  await mkdir(path.join(first, 'elsewhere'), { recursive: true }); await mkdir(second);
  await writeFile(path.join(first, 'elsewhere', 'Kopia.txt'), 'chart');
  const chart = path.join(second, 'Piosenka.txt'); await writeFile(chart, 'chart');
  assert.equal(await createLibraryResolver([first, second])('Piosenka.txt', hash), await realpath(chart));
});

test('playback targets a confirmed selection and the current take, including after a slow file check', async t => {
  const root = await temporary(t);
  const file = path.join(root, 'song.txt');
  let game = { protocol: 1, controlProtocol: 2, sessionId: 'session', ready: true, canStart: true,
    selectionId: 'selection', selectedFile: file, updatedAt: Date.now() / 1000 };
  const status = () => writeFile(path.join(root, 'status.json'), JSON.stringify(game));
  await status();
  const command = { id: 'take-one', sessionId: 'session', action: 'start', selectionId: 'selection', expiresAt: Date.now() + 15000 };
  const prepared = await prepareGameCommand({ exchangePath: root }, command, async () => file);
  assert.equal(prepared.protocol, 2); assert.equal(prepared.file, file);
  assert.throws(() => canExecute(command, { ...game, canStart: false }), /busy/);
  assert.throws(() => canExecute(command, { ...game, controlProtocol: undefined }), /unsupported/);
  await assert.rejects(prepareGameCommand({ exchangePath: root }, command, async () => {
    game = { ...game, selectionId: 'changed-locally' }; await status(); return file;
  }), /busy/);
  game = { ...game, canStart: false, ready: false, canReset: true, performanceId: 'take-one' }; await status();
  const reset = { ...command, action: 'reset', performanceId: 'take-one' };
  assert.equal((await prepareGameCommand({ exchangePath: root }, reset, () => assert.fail('Stop must not depend on song files'))).action, 'reset');
  assert.throws(() => canExecute({ ...reset, performanceId: 'old-take' }, game), /busy/);
  assert.throws(() => canExecute(reset, { ...game, sessionId: 'new-session' }), /game_offline/);
  await assert.rejects(prepareGameCommand({ exchangePath: root }, { ...reset, expiresAt: 1 }), /expired/);
});

test('protocol 3 passes cleaned player names and the voice swap to the game, and only known result fields to the queue', async t => {
  const root = await temporary(t);
  const file = path.join(root, 'song.txt');
  const game = { protocol: 1, controlProtocol: 3, sessionId: 'session', ready: true, canStart: true,
    selectionId: 'selection', selectedFile: file, updatedAt: Date.now() / 1000 };
  await writeFile(path.join(root, 'status.json'), JSON.stringify(game));
  const players = [{ slot: 1, name: ' Żaneta 🦊 Łódź\u0007 ' }, { slot: 2, name: '🦊' }, { slot: 7, name: 'Extra' }, { slot: 3, name: 'x'.repeat(40) }];
  const command = { id: 'take', sessionId: 'session', action: 'start', selectionId: 'selection', expiresAt: Date.now() + 15000, players, swapVoices: true };
  const prepared = await prepareGameCommand({ exchangePath: root }, command, async () => file);
  assert.deepEqual(prepared.players, [{ slot: 1, name: 'Żaneta Łódź' }, { slot: 3, name: 'x'.repeat(24) }]);
  assert.equal(prepared.swapVoices, true);
  await writeFile(path.join(root, 'status.json'), JSON.stringify({ ...game, controlProtocol: 2 }));
  const old = await prepareGameCommand({ exchangePath: root }, command, async () => file);
  assert.equal(old.players, undefined, 'An older game gets exactly the protocol 2 command');
  const report = queueState({ ...game, playerCount: 2, duetSwapped: true, performanceResult: { performanceId: 'take', rapToFreestyle: false, extra: 1,
    players: [{ slot: 1, track: 2, level: 1, score: 7120, notes: 6000 }] } });
  assert.deepEqual(report.performanceResult, { performanceId: 'take', rapToFreestyle: false, players: [{ slot: 1, track: 2, score: 7120 }] });
  assert.equal(report.playerCount, 2); assert.equal(report.duetSwapped, true);
  assert.deepEqual(playerNames('nope'), []);
});

test('a status read between the game deleting and renaming status.json still finds the game', async t => {
  const root = await temporary(t);
  const status = { protocol: 1, sessionId: 'session', ready: true, updatedAt: Date.now() / 1000 };
  setTimeout(() => void writeFile(path.join(root, 'status.json'), JSON.stringify(status)), 30);
  assert.equal((await gameStatus(root))?.sessionId, 'session');
  await writeFile(path.join(root, 'status.json'), JSON.stringify({ ...status, updatedAt: Date.now() / 1000 - 60 }));
  assert.equal(await gameStatus(root), null, 'A stale game is still reported missing');
  await rm(path.join(root, 'status.json'));
  assert.equal(await gameStatus(root), null, 'A closed game is reported missing after the retries');
});

async function temporary(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'usdx-bridge-test-'));
  t.after(async () => { assert.equal(path.dirname(root), os.tmpdir()); assert.ok(path.basename(root).startsWith('usdx-bridge-test-')); await rm(root, { recursive: true, force: true }); });
  return root;
}
test('bridge resolves exact Unicode chart and rejects traversal, absolute paths and stale versions', async t => {
  const root = await temporary(t); await mkdir(path.join(root,'Żółć'));
  await writeFile(path.join(root,'Żółć','Piosenka.txt'),'chart');
  // realpath expands Windows 8.3 aliases such as RUNNER~1 used by CI.
  assert.equal(await resolveSong(root,'Żółć/Piosenka.txt',hash),await realpath(path.join(root,'Żółć','Piosenka.txt')));
  for(const bad of ['../secret.txt','/secret.txt','C:/secret.txt','Queen/../secret.txt','Queen\\secret.txt','Queen/test.txt:stream','Queen//test.txt']) {
    await assert.rejects(resolveSong(root,bad,hash), /not_found/);
  }
  await assert.rejects(resolveSong(root,'Żółć/Piosenka.txt','0'.repeat(64)),/stale_file/);
  assert.throws(()=>validateConfig({serverUrl:'http://remote.example',token,songsPath:root,exchangePath:root}),/HTTPS/);
});

test('bridge resolves a library alias and still rejects links outside the library', async t => {
  const root = await temporary(t);
  const library = path.join(root, 'library');
  const alias = path.join(root, 'library-alias');
  const outside = path.join(root, 'outside');
  await mkdir(library); await mkdir(outside);
  const chart = path.join(library, 'Piosenka.txt');
  await writeFile(chart, 'chart');
  await writeFile(path.join(outside, 'Secret.txt'), 'chart');
  const linkType = process.platform === 'win32' ? 'junction' : 'dir';
  await symlink(library, alias, linkType);
  await symlink(outside, path.join(library, 'escape'), linkType);

  const resolved = await resolveSong(alias, 'Piosenka.txt', hash);
  assert.equal(resolved, await realpath(chart));
  assert.notEqual(resolved, path.join(alias, 'Piosenka.txt'));
  await assert.rejects(resolveSong(alias, 'escape/Secret.txt', hash), /not_found/);
});

test('bridge recovers a moved and renamed chart by content, not title', async t => {
  const root = await temporary(t);
  await mkdir(path.join(root, 'Nowy folder'));
  const moved = path.join(root, 'Nowy folder', 'Nowa nazwa.txt');
  await writeFile(moved, 'chart');
  await writeFile(path.join(root, 'Piosenka.txt'), 'different version');
  const resolve = createSongResolver(root);
  assert.equal(await resolve('old/Piosenka.txt', hash), await realpath(moved));
  // An existing but changed chart must still require a catalog update.
  await assert.rejects(resolve('Piosenka.txt', hash), /stale_file/);
  // Cached candidates must be hashed again, not blindly accepted.
  await writeFile(moved, 'edited after indexing');
  await assert.rejects(resolve('old/Piosenka.txt', hash), /stale_file/);
});

test('moved chart recovery rejects ambiguous matches and malformed source paths', async t => {
  const root = await temporary(t);
  await writeFile(path.join(root, 'one.txt'), 'chart');
  await writeFile(path.join(root, 'two.txt'), 'chart');
  const resolve = createSongResolver(root);
  await assert.rejects(resolve('old/Piosenka.txt', hash), /not_found/);
  assert.equal(await resolve('one.txt', hash), await realpath(path.join(root, 'one.txt')));
  for (const relative of ['../missing.txt', '/missing.txt', 'C:/missing.txt', 'old\\missing.txt']) {
    await assert.rejects(resolve(relative, hash), /not_found/);
  }
});

test('moved chart recovery does not search outside the library or follow directory loops', async t => {
  const root = await temporary(t);
  const library = path.join(root, 'library');
  const outside = path.join(root, 'outside');
  await mkdir(library); await mkdir(outside);
  await writeFile(path.join(outside, 'Piosenka.txt'), 'chart');
  const linkType = process.platform === 'win32' ? 'junction' : 'dir';
  await symlink(outside, path.join(library, 'escape'), linkType);
  await symlink(library, path.join(library, 'loop'), linkType);
  const resolve = createSongResolver(library);
  await assert.rejects(resolve('old/Piosenka.txt', hash), /not_found/);
  await writeFile(path.join(library, 'Piosenka.txt'), 'chart');
  // An explicit escaping path cannot fall back to a matching chart inside.
  await assert.rejects(createSongResolver(library)('escape/Piosenka.txt', hash), /not_found/);
});
