import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { mkdtemp, writeFile, mkdir, rm, realpath, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { resolveSong, validateConfig } from '../tools/usdx-bridge/bridge.mjs';
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
