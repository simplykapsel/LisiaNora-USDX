# Protokół UltraStar Queue

Uruchomienie gry: `ultrastardx.exe -QueueBridge <katalog>`. Bez tego argumentu integracja jest wyłączona. Produkcyjny launcher i profile NAS/VPS: [WINDOWS.md](WINDOWS.md).

Launcher dodaje `-SongPath <biblioteka bridge>`. Przy obu argumentach gra ładuje wyłącznie wskazaną bibliotekę, bez dodatkowych domyślnych folderów i wpisów `SongDir` z konfiguracji. Domyślnie jest to `songs` obok EXE; `songsPath` w profilu pozwala wybrać katalog zewnętrzny. Samo `-SongPath` bez integracji zachowuje standardowe zachowanie USDX (dodaje katalog).

## Wymiana plików

Bridge łączy się z serwerem kolejki przez WebSocket pod `/api/bridge/usdx/socket`, używając adresu i klucza z obecnego profilu. Po połączeniu przesyła stan gry, następnie wysyła zmiany i potwierdzenia poleceń. Zmiana samego czasu zapisu `status.json` odbywa się lokalnie. Co 5 sekund bridge wysyła krótki komunikat sprawdzający połączenie; bez odpowiedzi przez 15 s uznaje połączenie za zerwane, a serwer uznaje stanowisko za rozłączone po 20 s ciszy. Po zerwaniu połączenia ponawia je i wysyła aktualny stan wraz z ostatnim potwierdzeniem. Przy aktualizacji stanowiska najpierw zaktualizuj serwer Queue.

Jeden bridge na katalog. Zapis przez plik tymczasowy i zmianę nazwy. UTF-8, JSON, maksymalnie 16 KiB polecenia. Gra odczytuje polecenia na głównym wątku co 100 ms; status zapisuje co sekundę i po wyniku.

| Plik | Pola |
|---|---|
| `command.json` | `protocol=1`, `id`, `sessionId`, `file`, `expiresAt`. |
| `status.json` | `protocol=1`, `sessionId`, `updatedAt`, `ready`, `playersConfigured`, `awaitingPlayers`, `screen`, `id`, `result`, opcjonalnie `selectedFile`. |

`file`: bezwzględna ścieżka do TXT już załadowanego przez grę. `expiresAt` i `updatedAt`: Unix w sekundach. `sessionId`: identyfikator bieżącego procesu gry. `id`: UUID polecenia.

Wyniki gry: `selected`, `started`, `reset`, `busy`, `not_found`, `expired`, `error`. Bridge dodatkowo zwraca `stale_file`, `game_offline` i `unsupported`. Stara sesja i polecenie po terminie są odrzucane. Gra pamięta 64 ostatnie ID i wyniki, aby ponowne dostarczenie polecenia nie uruchomiło kolejnego wykonania.

## Start i Cofnij Start

Status nadal ma `protocol=1`, aby zachować zgodność wyboru piosenek. Nowa gra ogłasza `controlProtocol=2`, `selectionId`, `performanceId`, `performanceState`, `canStart` i `canReset`.

- Start: `command.json` z `protocol=2`, `action=start`, `id`, `sessionId`, `selectionId`, `file`, `expiresAt`. Wymaga zatwierdzonych graczy, zwykłego ekranu piosenek bez dialogu i dokładnie tej piosenki, którą wcześniej wybrano. Bridge ponownie sprawdza SHA-256, ścieżkę i bieżący stan gry. `performanceId` to ID polecenia Start. `started` następuje po wejściu na ekran śpiewania i uruchomieniu odtwarzania.
- Cofnij Start: `protocol=2`, `action=reset`, `id`, `sessionId`, `performanceId`, `expiresAt`. Działa tylko na wskazanym wykonaniu. Zatrzymuje odtwarzanie i nagrywanie, pomija zapis wyniku i ekran wyników, wraca do tej samej piosenki. Gracze pozostają zatwierdzeni. Ponowny Start rozpoczyna utwór od początku. Cofnięcie nie wymaga ponownego odczytu pliku piosenki.
- `performanceState`: `starting`, `singing`, `stopped`, `finished`, `error` lub pusty przed pierwszym Start. Stan końcowy pozostaje dostępny po krótkiej utracie połączenia. Normalne zakończenie daje `finished`; przerwanie przez gracza daje `stopped` i zachowuje zwykły ekran końcowy USDX.
- Aplikacja kolejki zmienia status dopiero na podstawie potwierdzenia rzeczywistego wykonania. Cofnięcie przywraca wcześniejszy status i zeruje czas Start. Koniec utworu oznacza pozycję jako zakończoną; szacunkowy timer nie kończy sam aktywnego wykonania USDX. Identyfikator wykonania jest zapisany w bazie Queue, więc restart API nie odbiera możliwości Cofnij Start. Po restarcie API nowy Start wymaga ponownego „Wybierz”. Restart gry przywraca przerwaną pozycję do oczekiwania.

## Imiona i wyniki (controlProtocol 3)

Gra ogłasza `controlProtocol=3`, `playerCount` (liczba graczy po zatwierdzeniu ekranu graczy) i `duetSwapped` (stan zamiany głosów Spacją).

- Start może zawierać `players`: lista `{slot, name}` dla graczy 1–6 oraz `swapVoices`. Bridge usuwa znaki sterujące i emoji, a imię skraca do 24 znaków. Gra ustawia imiona tylko na ten występ, dla slotów do `playerCount`; reszta graczy zachowuje imiona z gry, a `config.ini` się nie zmienia. `swapVoices` działa tylko przy duecie i wygrywa ze Spacją.
- Po naturalnym końcu utworu status zawiera `performanceResult`: `performanceId`, `rapToFreestyle` i `players` z `slot`, `track` (1 = P1, 2 = P2, także po zamianie) i `score` (0–10 000, te same liczby co na ekranie wyników). Wynik zostaje w statusie do następnego Start; przerwanie (Cofnij Start, Escape) nie daje wyniku.
- Serwer wysyła imiona tylko grze z protokołem 3 i zapisuje każdy wynik raz na `performanceId` i slot.

Wymagane są aktualne wersje gry, bridge i aplikacji Queue. Profile i token pozostają takie same. Stara gra nadal obsługuje wybór; panel wyświetla potrzebę aktualizacji przed zdalnym Start. Bez skonfigurowanego `USDX_BRIDGE_TOKEN` aplikacja zachowuje ręczną obsługę statusu kolejki.

## Zachowanie

- Wybór tylko w menu głównym lub bibliotece w trybie normalnym, bez dialogu/przejścia.
- Śpiewanie, edytor i party odrzucają polecenie wyboru.
- Pierwszy wybór w świeżej sesji zapamiętuje dokładny plik i otwiera standardową konfigurację liczby graczy, imion oraz trudności. Zatwierdzenie pokazuje bibliotekę z zaznaczoną piosenką; Escape wraca do menu głównego i usuwa zapamiętany wybór. Śpiewanie wymaga osobnego uruchomienia.
- `selected` potwierdza przyjęcie wyboru przez grę. Przy `awaitingPlayers=true` plik jest już wybrany lokalnie, ale biblioteka zostanie pokazana po zatwierdzeniu graczy. Limit `expiresAt` dotyczy przyjęcia polecenia, nie czasu konfiguracji. W tym czasie `ready=false`; kolejny wybór jest odrzucany. Anulowanie konfiguracji nie zmienia wcześniejszego potwierdzenia dostarczenia na serwerze.
- Jeśli gracze zostali już zatwierdzeni, kolejne wybory (także z menu głównego) zachowują ich ustawienia i od razu zaznaczają piosenkę w bibliotece. Wybór resetuje filtr/kategorię/playlistę.
- Bridge sprawdza granice katalogu i SHA-256 TXT przed zapisaniem polecenia. Jeśli ścieżka z katalogu nie istnieje, szuka w `songsPath` jednego pliku TXT o identycznej zawartości (także po zmianie folderu lub nazwy). Pomija dowiązania i odrzuca niejednoznaczne dopasowania. Istniejący plik o zmienionej zawartości nadal wymaga aktualizacji katalogu. Gra nie ładuje dowolnych plików wskazanych przez JSON.

## Testy

Build i smoke testy: [DEVELOPMENT-WINDOWS.md](DEVELOPMENT-WINDOWS.md). Testy API wyboru piosenki: `tests/usdx-bridge.test.mjs` w repo Queue. Testy samego bridge: `npm test` w tym repo. Testy automatyczne nie weryfikują jakości mikrofonów ani odsłuchu.
