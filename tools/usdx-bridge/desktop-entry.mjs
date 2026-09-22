import { desktopMain } from './desktop.mjs';
desktopMain().then(code => { process.exitCode = code; }).catch(() => { process.exitCode = 1; });
