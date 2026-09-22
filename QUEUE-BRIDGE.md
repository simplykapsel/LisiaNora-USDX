# Protokół UltraStar Queue

Uruchomienie gry: `ultrastardx.exe -QueueBridge <katalog>`. Bez tego argumentu integracja jest wyłączona. Produkcyjny launcher i profile NAS/VPS: [USDX-INTEGRATION.md](https://github.com/simplykapsel/ultrastar-queue/blob/main/docs/USDX-INTEGRATION.md).

## Wymiana plików

Jeden bridge na katalog. Zapis przez plik tymczasowy i zmianę nazwy. UTF-8, JSON, maksymalnie 16 KiB polecenia. Gra odczytuje polecenia na głównym wątku co 100 ms; status zapisuje co sekundę i po wyniku.

| Plik | Pola |
|---|---|
| `command.json` | `protocol=1`, `id`, `sessionId`, `file`, `expiresAt`. |
| `status.json` | `protocol=1`, `sessionId`, `updatedAt`, `ready`, `playersConfigured`, `screen`, `id`, `result`, opcjonalnie `selectedFile`. |

`file`: bezwzględna ścieżka do TXT już załadowanego przez grę. `expiresAt` i `updatedAt`: Unix w sekundach. `sessionId`: identyfikator bieżącego procesu gry. `id`: UUID polecenia.

Wyniki gry: `selected`, `busy`, `not_found`, `expired`, `error`. Bridge dodatkowo zwraca `stale_file` i `game_offline`. Stara sesja i polecenie po terminie są odrzucane; ponowne dostarczenie ostatniego ID nie powtarza wyboru.

## Zachowanie

- Wybór tylko w menu głównym lub bibliotece w trybie normalnym, bez dialogu/przejścia.
- Śpiewanie, edytor i party odrzucają polecenie.
- Wybór otwiera bibliotekę, resetuje filtr/kategorię/playlistę i zaznacza dokładny plik. Nie rozpoczyna śpiewania.
- Konfiguracja graczy jest zachowana w bibliotece. Wejście z menu głównego z pominięciem konfiguracji wymaga zatwierdzenia przed startem. Escape zachowuje ten wymóg.
- Bridge sprawdza granice katalogu i SHA-256 TXT przed zapisaniem polecenia. Gra nie ładuje dowolnych plików wskazanych przez JSON.

## Testy

Build i smoke testy: [DEVELOPMENT-WINDOWS.md](DEVELOPMENT-WINDOWS.md). Test API → bridge → gra: `tests/usdx-live.test.mjs` w repo aplikacji. Testy automatyczne nie weryfikują jakości mikrofonów ani odsłuchu.
