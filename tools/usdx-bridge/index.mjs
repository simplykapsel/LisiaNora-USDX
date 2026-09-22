import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { runBridge } from './bridge.mjs';
const configPath = process.argv[2] ?? fileURLToPath(new URL('./bridge.json', import.meta.url));
const abort = new AbortController();
process.once('SIGINT', () => abort.abort());
process.once('SIGTERM', () => abort.abort());
try { await runBridge(JSON.parse((await readFile(configPath, 'utf8')).replace(/^\uFEFF/, '')), { signal: abort.signal }); }
catch (error) { console.error('Nie można uruchomić połączenia USDX:', error.message); process.exitCode = 1; }
