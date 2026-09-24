import { build } from 'esbuild';
import { inject } from 'postject';
import { readFile, writeFile, mkdir, copyFile, cp, readdir, stat } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { pipeline } from 'node:stream/promises';
import { ZipFile } from 'yazl';

if (process.platform !== 'win32' || process.arch !== 'x64' || Number(process.versions.node.split('.')[0]) < 24) throw new Error('Build requires Windows x64 and Node.js 24+.');
const root = fileURLToPath(new URL('../../', import.meta.url));
process.chdir(root);
const args = process.argv.slice(2);
const option = (name, fallback) => { const i = args.indexOf(name); return i < 0 ? fallback : args[i + 1]; };
const gameRepo = root;
const version = (await readFile(path.join(root, 'VERSION'), 'utf8')).trim();
const fpc = option('--fpc', 'C:/lazarus/fpc/3.2.2/bin/x86_64-win64/fpc.exe');
const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-');
const output = path.resolve(option('--output', 'artifacts/LisiaNora-USDX-' + version + '-windows-x64-' + stamp));
await mkdir(path.dirname(output), { recursive: true });
await mkdir(output); // Refuse to overwrite an existing installation or its user data.
const temporary = path.resolve('.local/usdx-build-' + stamp); await mkdir(temporary, { recursive: true });
const run = (exe, arguments_, options = {}) => { const result = spawnSync(exe, arguments_, { stdio: 'inherit', windowsHide: true, ...options }); if (result.error) throw result.error; if (result.status !== 0) throw new Error('Build command failed: ' + exe); };
await build({ entryPoints: ['tools/usdx-bridge/desktop-entry.mjs'], bundle: true, platform: 'node', target: 'node24', format: 'cjs', outfile: path.join(temporary, 'bridge.cjs') });
const sea = path.join(temporary, 'sea.json');
await writeFile(sea, JSON.stringify({ main: path.join(temporary, 'bridge.cjs'), output: path.join(temporary, 'bridge.blob'), disableExperimentalSEAWarning: true, useCodeCache: false, useSnapshot: false, execArgvExtension: 'none' }));
run(process.execPath, ['--experimental-sea-config', sea]);
const bridge = path.join(output, 'usdx-bridge.exe'); await copyFile(process.execPath, bridge);
await inject(bridge, 'NODE_SEA_BLOB', await readFile(path.join(temporary, 'bridge.blob')), { sentinelFuse: 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2' });
// Compile the branded Windows icon into the launcher; no external icon is needed at runtime.
await copyFile('icons/lisia-nora.ico', path.join(temporary, 'lisia-nora.ico'));
for (const name of ['launcher.pas', 'launcher.rc']) await copyFile(path.join('tools/usdx-bridge', name), path.join(temporary, name));
const toolchain = path.dirname(path.resolve(fpc));
run(path.join(toolchain, 'windres.exe'), ['-i', 'launcher.rc', '-O', 'res', '-o', 'launcher.res'], {
  cwd: temporary, env: { ...process.env, PATH: toolchain + path.delimiter + (process.env.PATH ?? '') },
});
run(fpc, ['-Mobjfpc', '-O2', '-Xs', '-WG', '-FU' + temporary, '-o' + path.join(output, 'LisiaNora.exe'), path.join(temporary, 'launcher.pas')]);
const game = path.join(gameRepo, 'game');
if (!(await stat(path.join(game, 'ultrastardx.exe'))).isFile()) throw new Error('Build USDX Release first.');
const excluded = new Set(['songs', 'playlists', 'screenshots', '.queue-bridge']);
await cp(game, output, { recursive: true, filter: source => {
  const relative = path.relative(game, source); if (!relative) return true;
  const parts = relative.split(path.sep), name = path.basename(source).toLowerCase();
  return !parts.some(part => excluded.has(part.toLowerCase())) && name !== 'config.ini' && name !== 'game.ini' && !/^bridge.*\.json$/i.test(name) && !['ultrastardx-lazarus.exe', 'lisianora.exe', 'usdx-bridge.exe'].includes(name)
    && !/\.(db|sqlite|sqlite3)(-|$)|\.(log|debug)$/i.test(name);
} });
await mkdir(path.join(output, 'songs'));
await writeFile(path.join(output, 'songs', 'README.md'), '# Piosenki\n\nUmieść tutaj foldery piosenek UltraStar (TXT, audio i pozostałe pliki).\nGra i bridge domyślnie korzystają z tego katalogu.\nOpcjonalne songsPath w bridge.json wybiera bibliotekę w innym miejscu.\n');
for (const name of ['COPYING', 'COPYRIGHT.txt', 'LICENSE', 'DEVELOPMENT-WINDOWS.md', 'QUEUE-BRIDGE.md']) { try { await copyFile(path.join(gameRepo, name), path.join(output, name)); } catch (error) { if (error.code !== 'ENOENT') throw error; } }
const license = await fetch('https://raw.githubusercontent.com/nodejs/node/' + process.version + '/LICENSE');
if (!license.ok) throw new Error('Cannot obtain license for bundled Node.js version.');
await writeFile(path.join(output, 'LICENSE-NODE.txt'), await license.text());
await copyFile('WINDOWS.md', path.join(output, 'WINDOWS.md'));
await copyFile('tools/usdx-bridge/bridge.example.json', path.join(output, 'bridge.example.json'));
await copyFile('tools/usdx-bridge/configure-windows.ps1', path.join(output, 'configure-windows.ps1'));
const revision = cwd => { const r = spawnSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf8', windowsHide: true }); if(r.status !== 0) throw new Error('Cannot read source revision'); return r.stdout.trim(); };
await writeFile(path.join(output, 'BUILD.json'), JSON.stringify({ builtAt: new Date().toISOString(), node: process.version,
  gameRevision: revision(gameRepo), workingTreeModified: spawnSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8', windowsHide: true }).stdout.trim().length > 0, gameSource: 'https://github.com/simplykapsel/LisiaNora-USDX' }, null, 2));
const zip = new ZipFile();
async function add(directory, prefix = '') { for (const item of await readdir(directory, { withFileTypes: true })) {
  if (item.name === '.build') continue;
  const source = path.join(directory, item.name), destination = prefix + item.name;
  if (item.isDirectory()) await add(source, destination + '/'); else zip.addFile(source, destination);
} }
await add(output);
const archive = output + '.zip'; const saved = pipeline(zip.outputStream, createWriteStream(archive)); zip.end(); await saved;
await writeFile('.local/windows-build-path.txt', output);
console.info('Windows launcher: ' + path.join(output, 'LisiaNora.exe'));
console.info('Portable archive: ' + archive);
