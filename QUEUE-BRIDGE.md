# Połączenie z UltraStar Queue

W panelu administratora aplikacji jest osobny przycisk **Wybierz**.
Zaznacza konkretny plik piosenki w grze. Gracze i trudność wybrani przed wejściem
do biblioteki są zachowywani przy kolejnych wyborach z panelu. Jeśli wybór
z panelu ominął konfigurację z menu głównego, gra poprosi o nią przed śpiewaniem.
Escape z tego ekranu zachowuje wymóg zatwierdzenia.
Start występu i licznik kolejki są oddzielne.

## Uruchomienie

`tools/windows/run-dev.ps1` i projekt Lazarusa `src/ultrastardx-queue-win64.lpi`
uruchamiają grę z argumentem `-QueueBridge .queue-bridge`.
Katalog jest względny wobec `game` i wykluczony z Git oraz paczek portable.
Bez argumentu `-QueueBridge` gra nie uruchamia obsługi kolejki.

W repo `UltrastarQueue` uruchom aplikację oraz `npm run usdx:bridge`.
W WebStormie aplikacji jest konfiguracja **USDX Bridge**.
Ustawienia znajdują się w ignorowanym pliku `runtime/usdx-bridge.json`.
Pełna instrukcja jest w `UltrastarQueue/docs/USDX-INTEGRATION.md`.

Po rozpakowaniu paczki portable uruchom ją z:

```powershell
.\ultrastardx.exe -QueueBridge .queue-bridge
```

Ustaw w programie łączącym `exchangePath` na pełną ścieżkę tego katalogu,
a `songsPath` na katalog główny użyty podczas eksportu katalogu webowego.
Nie umieszczaj klucza dostępu do serwera w katalogu gry.

## Wewnętrzny format wymiany

Pliki JSON są zapisywane przez plik tymczasowy i zmianę nazwy.
Program łączący jest jedynym nadawcą w tym katalogu. Gra nie otwiera portu HTTP.
Obsługa plików i wybór piosenki działają na głównym wątku gry.

`command.json`:

```json
{
  "protocol": 1,
  "id": "UUID polecenia",
  "sessionId": "identyfikator bieżącego uruchomienia gry",
  "file": "D:/Songs/Artist - Song/Artist - Song.txt",
  "expiresAt": 1790000000
}
```

`expiresAt` jest czasem Unix w sekundach. Ścieżka jest UTF-8 i musi odpowiadać
piosence już załadowanej przez USDX. Program Windows sprawdza wcześniej zgodność
SHA-256 pliku z katalogiem webowym i ogranicza ścieżkę do biblioteki piosenek.
Gra nie ładuje nowych plików z polecenia.

`status.json` zawiera `protocol`, `sessionId`, `updatedAt` (Unix, sekundy), `ready`,
`id`, `result`, `screen`, `playersConfigured` oraz opcjonalnie `selectedFile` aktualnie zaznaczonej piosenki.
Status aktualizuje się co sekundę oraz po zakończeniu polecenia.
Wyniki gry: `selected`, `busy`, `not_found`, `expired`, `error`.
Program Windows może dodatkowo zgłosić `stale_file` lub `game_offline`.

Wybór jest dozwolony tylko w menu głównym lub na ekranie piosenek w normalnym
trybie, bez aktywnego dialogu. Przejście z menu głównego do piosenek jest
obsługiwane. Trwająca rozgrywka, edytor, party i pozostałe ekrany odrzucają wybór.
Bieżący filtr/kategoria/playlistę zastępuje widok wszystkich piosenek.

## Testy wykonane 2026-09-22

- Kompilacja Debug, Release i projektu Lazarusa Win64.
- Test całej ścieżki: administrator → API → program Windows → uruchomiona gra.
- Potwierdzone wybory: **Hiroshi Kitadani — We are!** oraz **We are! (TV)**.
- W Release potwierdzono także `selectedFile`, czyli faktyczną ścieżkę w zaznaczeniu gry.
- Testy aplikacji: uwierzytelnianie, CSRF, izolacja wydarzeń, brak połączenia,
  zajętość, powtórzenia poleceń, restart sesji, zmiana pliku, ścieżki poza biblioteką.
- Paczka portable nie zawiera katalogu wymiany, konfiguracji, piosenek ani wyników.

Testy nie obejmują pełnego śpiewania do mikrofonu ani każdego układu menu.
Domyślny układ Roulette został sprawdzony na rzeczywistej grze.

## Regresja wyboru graczy

```powershell
.\tools\windows\build.ps1 -Configuration Debug
.\tools\windows\smoke-player-flow.ps1 -Song 'D:\UltraStar Deluxe\songs\nowe\Hiroshi Kitadani - We are! (TV)\Hiroshi Kitadani - We are! (TV).txt'
```

Test uruchamia prawdziwą grę z osobną konfiguracją i wynikami w `.local`, a przez
GDB wywołuje standardowe akcje menu. Sprawdza: zaznaczenie → ekran graczy → Escape
→ ponowne uruchomienie → zatwierdzenie graczy/trudności → ekran śpiewania.
Następnie wysyła polecenie wyboru podczas śpiewania i sprawdza odrzucenie `busy`.
W ten sposób sprawdza też inicjalizację `ScreenSing`, której brak powodował
zgłoszony błąd `Object reference is Nil` w `UDisplay.Draw`.

Dodatkowy przebieg `tools/windows/smoke-player-flow.ps1 -Flow Configured`
sprawdza standardowy wybór graczy przed biblioteką i powtarzany wybór z panelu
bez ponownego pytania o graczy.
