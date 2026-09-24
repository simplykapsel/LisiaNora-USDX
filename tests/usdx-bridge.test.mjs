import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { mkdtemp, writeFile, mkdir, rm, realpath, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { resolveSong, createSongResolver, validateConfig } from '../tools/usdx-bridge/bridge.mjs';
const token = 'a'.repeat(43);
const hash = createHash('sha256').update('chart').digest('hex');

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
