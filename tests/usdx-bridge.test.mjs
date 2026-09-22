import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises';
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
  const root = await temporary(t); await mkdir(path.join(root,'Ĺ»ĂłĹ‚Ä‡'));
  await writeFile(path.join(root,'Ĺ»ĂłĹ‚Ä‡','Piosenka.txt'),'chart');
  assert.equal(await resolveSong(root,'Ĺ»ĂłĹ‚Ä‡/Piosenka.txt',hash),path.join(root,'Ĺ»ĂłĹ‚Ä‡','Piosenka.txt'));
  for(const bad of ['../secret.txt','/secret.txt','C:/secret.txt','Queen/../secret.txt','Queen\\secret.txt','Queen/test.txt:stream','Queen//test.txt']) {
    await assert.rejects(resolveSong(root,bad,hash), /not_found/);
  }
  await assert.rejects(resolveSong(root,'Ĺ»ĂłĹ‚Ä‡/Piosenka.txt','0'.repeat(64)),/stale_file/);
  assert.throws(()=>validateConfig({serverUrl:'http://remote.example',token,songsPath:root,exchangePath:root}),/HTTPS/);
});
