# USDX: uruchomienie i połączenie z Queue

Paczka Windows zawiera grę, DLL, zasoby, `LisiaNora.exe` i `usdx-bridge.exe`. Na stanowisku nie trzeba instalować Node.js ani Lazarusa.

## Konfiguracja

Skopiuj `bridge.example.json` do `bridge.json` obok plików EXE. Ustaw:

| Pole | Wartość |
|---|---|
| `serverUrl` | Origin serwera Queue, np. `https://us.kapsel.me`; bez `/admin`. |
| `token` | Ta sama wartość co `USDX_BRIDGE_TOKEN` w Compose serwera. |
| `songsPath` | Bezwzględna ścieżka biblioteki zgodna z eksportowanym katalogiem. |
| `exchangePath` | Opcjonalny katalog wymiany. Domyślnie `.queue-bridge` obok profilu. |

Alternatywnie uruchom `configure-windows.ps1` z `-ServerUrl` i `-SongsPath`; skrypt poprosi o token. `-ImportConfig` importuje istniejący JSON. `-GameConfig` kopiuje ustawienia USDX do `game.ini`, jeśli plik jeszcze nie istnieje.

## Uruchomienie

Uruchom **LisiaNora.exe**. Launcher otwiera grę i utrzymuje połączenie przez bridge; zamknięcie gry kończy oba procesy. Sam `ultrastardx.exe` nie łączy się z serwerem.

`LisiaNora.exe --check` sprawdza profil, pliki gry, bibliotekę i dostępność serwera. Log: `bridge.log`. `--config <ścieżka>` wybiera inny profil NAS/VPS. Nie uruchamiaj dwóch bridge dla tego samego katalogu wymiany.

## Ustawienia i aktualizacja

Obok `bridge.json` znajdują się `game.ini`, `scores.db`, `bridge.log` i `.queue-bridge`. Token nie jest wpisywany do EXE ani `game.ini`. Zmiana serwera lub tokenu wymaga ponownego uruchomienia, bez kompilacji.

Przy aktualizacji zamknij grę i zachowaj `bridge.json`, `game.ini` oraz `scores.db`. Ze starego launchera skopiuj te pliki z `%LOCALAPPDATA%\LisiaNora-USDX`. Nie dołączaj swojego profilu z tokenem do udostępnianego ZIP-a.

## Development

Kod klienta i konfiguracja lokalna: `tools/usdx-bridge`. `npm run usdx:bridge` czyta znajdujący się tam `bridge.json`; wymaga jawnego `exchangePath` wskazującego na `game/.queue-bridge`. Grę uruchom z `-QueueBridge .queue-bridge` w katalogu `game`. Inny profil: `npm run usdx:bridge -- <ścieżka>`.

Build i WebStorm: [DEVELOPMENT-WINDOWS.md](DEVELOPMENT-WINDOWS.md). Protokół: [QUEUE-BRIDGE.md](QUEUE-BRIDGE.md).
