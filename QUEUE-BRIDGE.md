# Protokół UltraStar Queue

Uruchomienie gry: `ultrastardx.exe -QueueBridge <katalog>`. Bez tego argumentu integracja jest wyłączona. Produkcyjny launcher i profile NAS/VPS: [WINDOWS.md](WINDOWS.md).

## Wymiana plików

Jeden bridge na katalog. Zapis przez plik tymczasowy i zmianę nazwy. UTF-8, JSON, maksymalnie 16 KiB polecenia. Gra odczytuje polecenia na głównym wątku co 100 ms; status zapisuje co sekundę i po wyniku.

| Plik | Pola |
|---|---|
| `command.json` | `protocol=1`, `id`, `sessionId`, `file`, `expiresAt`. |
| `status.json` | `protocol=1`, `sessionId`, `updatedAt`, `ready`, `playersConfigured`, `awaitingPlayers`, `screen`, `id`, `result`, opcjonalnie `selectedFile`. |

`file`: bezwzględna ścieżka do TXT już załadowanego przez grę. `expiresAt` i `updatedAt`: Unix w sekundach. `sessionId`: identyfikator bieżącego procesu gry. `id`: UUID polecenia.

Wyniki gry: `selected`, `busy`, `not_found`, `expired`, `error`. Bridge dodatkowo zwraca `stale_file` i `game_offline`. Stara sesja i polecenie po terminie są odrzucane; ponowne dostarczenie ostatniego ID nie powtarza wyboru.

## Zachowanie

- Wybór tylko w menu głównym lub bibliotece w trybie normalnym, bez dialogu/przejścia.
- Śpiewanie, edytor i party odrzucają polecenie.
- Pierwszy wybór w świeżej sesji zapamiętuje dokładny plik i otwiera standardową konfigurację liczby graczy, imion oraz trudności. Zatwierdzenie pokazuje bibliotekę z zaznaczoną piosenką; Escape wraca do menu głównego i usuwa zapamiętany wybór. Śpiewanie wymaga osobnego uruchomienia.
- `selected` potwierdza przyjęcie wyboru przez grę. Przy `awaitingPlayers=true` plik jest już wybrany lokalnie, ale biblioteka zostanie pokazana po zatwierdzeniu graczy. Limit `expiresAt` dotyczy przyjęcia polecenia, nie czasu konfiguracji. W tym czasie `ready=false`; kolejny wybór jest odrzucany. Anulowanie konfiguracji nie zmienia wcześniejszego potwierdzenia dostarczenia na serwerze.
- Jeśli gracze zostali już zatwierdzeni, kolejne wybory (także z menu głównego) zachowują ich ustawienia i od razu zaznaczają piosenkę w bibliotece. Wybór resetuje filtr/kategorię/playlistę.
- Bridge sprawdza granice katalogu i SHA-256 TXT przed zapisaniem polecenia. Jeśli ścieżka z katalogu nie istnieje, szuka w `songsPath` jednego pliku TXT o identycznej zawartości (także po zmianie folderu lub nazwy). Pomija dowiązania i odrzuca niejednoznaczne dopasowania. Istniejący plik o zmienionej zawartości nadal wymaga aktualizacji katalogu. Gra nie ładuje dowolnych plików wskazanych przez JSON.

## Testy

Build i smoke testy: [DEVELOPMENT-WINDOWS.md](DEVELOPMENT-WINDOWS.md). Testy API wyboru piosenki: `tests/usdx-bridge.test.mjs` w repo Queue. Testy samego bridge: `npm test` w tym repo. Testy automatyczne nie weryfikują jakości mikrofonów ani odsłuchu.
