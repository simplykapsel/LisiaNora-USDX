import { readFile, writeFile, mkdir, realpath, stat, appendFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { runBridge, validateConfig } from './bridge.mjs';

export function parseArguments(args, executableDirectory = path.dirname(process.execPath)) {
  let configPath = path.join(executableDirectory, 'bridge.json');
  let check = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--config' && args[i + 1]) configPath = args[++i];
    else if (args[i] === '--check') check = true;
    else throw new Error('Niepoprawne argumenty. Obsługiwane: --config, --check.');
  }
  return { configPath: path.resolve(configPath), check };
}

async function readOptional(file) {
  try { return await readFile(file, 'utf8'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; return null; }
}

function songDirectories(ini, executableDirectory) {
  let section = '';
  const directories = new Map();
  for (const raw of ini.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || /^[;#]/.test(line)) continue;
    const header = /^\[([^\]]+)\]$/.exec(line);
    if (header) { section = header[1].toLowerCase(); continue; }
    const entry = /^([^=]+)=(.*)$/.exec(line);
    if (section === 'directories' && entry && /^songdir/i.test(entry[1].trim())) {
      const value = entry[2].trim();
      directories.set(entry[1].trim().toLowerCase(), value ? path.resolve(executableDirectory, value) : null);
    }
  }
  return [...directories.values()].filter(Boolean);
}

export async function loadDesktopConfig(configPath, executableDirectory) {
  let input;
  try { input = JSON.parse((await readFile(configPath, 'utf8')).replace(/^\uFEFF/, '')); }
  catch { throw new Error('Brak poprawnego pliku bridge.json. Skonfiguruj połączenie przed uruchomieniem.'); }
  const dataDirectory = path.dirname(configPath);
  const gameConfig = path.join(dataDirectory, 'config.ini');
  const ini = await readOptional(gameConfig);
  const directories = songDirectories(ini ?? '', executableDirectory);
  // Keep old bridge profiles usable, but explicit INI directories take precedence.
  const legacySongPath = directories.length ? undefined : input.songsPath;
  const defaultSongs = path.join(executableDirectory, 'songs');
  const config = validateConfig({ ...input,
    songsPath: legacySongPath ?? defaultSongs,
    exchangePath: input.exchangePath ?? path.join(dataDirectory, '.queue-bridge') });
  const game = path.join(executableDirectory, 'ultrastardx.exe');
  if (!(await stat(game)).isFile()) throw new Error('Brak ultrastardx.exe w katalogu aplikacji.');
  await mkdir(defaultSongs, { recursive: true });
  config.songsPath = await realpath(config.songsPath);
  if (!(await stat(config.songsPath)).isDirectory()) throw new Error('Biblioteka piosenek musi być katalogiem.');
  const roots = [config.songsPath, await realpath(defaultSongs)];
  for (const directory of directories) {
    try { if ((await stat(directory)).isDirectory()) roots.push(await realpath(directory)); }
    catch (error) { if (!['ENOENT', 'ENOTDIR'].includes(error.code)) throw error; }
  }
  config.songsPaths = [...new Set(roots)];
  return { config, game, dataDirectory, gameConfig, legacySongPath, scores: path.join(dataDirectory, 'scores.db') };
}

export async function runDesktop(settings, { signal, onConnection, launch = spawn } = {}) {
  const { config, game, dataDirectory, gameConfig, scores } = settings;
  await mkdir(dataDirectory, { recursive: true });
  // Never replace microphone, player or display settings after the first launch.
  try { await writeFile(gameConfig, '[Game]\nLanguage=Polish\n', { flag: 'wx' }); }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
  const abort = new AbortController();
  const args = ['-ConfigFile', gameConfig, '-ScoreFile', scores, '-QueueBridge', config.exchangePath];
  if (settings.legacySongPath) args.push('-SongPath', settings.legacySongPath);
  const child = launch(game, args, {
    cwd: path.dirname(game), stdio: 'ignore', windowsHide: false,
  });
  const exited = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', code => resolve(code ?? 1));
  });
  const stop = () => { abort.abort(); child.kill(); };
  signal?.addEventListener('abort', stop, { once: true });
  if (signal?.aborted) stop();
  const bridge = runBridge(config, { signal: abort.signal, onConnection });
  // Also close the game if a fatal local bridge error prevents supervision.
  bridge.catch(() => child.kill());
  try { return await exited; }
  finally { abort.abort(); signal?.removeEventListener('abort', stop); await bridge; }
}

export async function desktopMain(args = process.argv.slice(2), executableDirectory = path.dirname(process.execPath)) {
  const { configPath, check } = parseArguments(args, executableDirectory);
  const directory = path.dirname(configPath);
  await mkdir(directory, { recursive: true });
  const logFile = path.join(directory, 'bridge.log');
  if ((await stat(logFile).catch(() => null))?.size > 1024 * 1024) await rename(logFile, logFile + '.previous').catch(() => {});
  const log = message => appendFile(logFile, new Date().toISOString() + ' ' + message + '\n').catch(() => {});
  try {
    const settings = await loadDesktopConfig(configPath, executableDirectory);
    if (check) {
      const health = await fetch(settings.config.serverUrl + '/api/health', { redirect: 'error', signal: AbortSignal.timeout(10000) });
      if (!health.ok || (await health.json()).ok !== true) throw new Error('Serwer nie odpowiada poprawnie.');
      await log('Konfiguracja, pliki gry i połączenie HTTPS: OK.');
      console.info('OK: konfiguracja, pliki gry i serwer.');
      return 0;
    }
    const abort = new AbortController();
    const stop = () => abort.abort();
    process.once('SIGINT', stop); process.once('SIGTERM', stop);
    await log('Uruchomienie gry i połączenia.');
    try { return await runDesktop(settings, { signal: abort.signal, onConnection: message => { void log(message); } }); }
    finally { process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop); await log('Zakończono grę i połączenie.'); }
  } catch (error) {
    // JSON and network errors can include configuration contents; do not log them.
    const detail = error.code === 'ENOENT' ? 'Brak wymaganego pliku lub katalogu.' : 'Sprawdź bridge.json, bibliotekę piosenek i dostępność serwera.';
    await log('Błąd uruchomienia. ' + detail);
    console.error(detail);
    return 1;
  }
}
