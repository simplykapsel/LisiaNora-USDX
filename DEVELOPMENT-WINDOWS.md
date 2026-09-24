# Windows: build i development

## Wymagania

Windows x64; Lazarus 4.8 / FPC 3.2.2 (`C:\lazarus`); MSYS2 (`C:\msys64`): autoconf, automake, make, pkgconf, Git, GCC i narzędzia MinGW64; Python 3; Node.js 24+ do budowania klienta Windows.

## Przygotowanie

Bazą Lisiej Nory jest branch `release` repozytorium UltraStar-Deluxe/USDX (obecnie `2026.9.0`). Nasze dodatki rozwijamy na `main`; aktualizacje USDX pobieramy z `upstream/release`.

Konfiguracja po dodaniu remote `upstream` wskazującego na `https://github.com/UltraStar-Deluxe/USDX.git`:

```powershell
git remote set-branches upstream release
git fetch upstream
git remote set-head upstream release
```

Aby włączyć aktualizację USDX do naszych zmian, na czystym branchu `main` wykonaj `git fetch upstream`, a następnie `git merge upstream/release` i zweryfikuj build oraz testy. Zwykłe `git pull` nadal synchronizuje nasz `main` z `origin/main`.

```powershell
.\tools\windows\prepare-runtime.ps1 -Download
.\tools\windows\init-dev.ps1 -SongsPath 'D:\UltraStar Deluxe\songs'
```

`prepare-runtime` pobiera DLL zgodne z bazą USDX. `init-dev` tworzy konfigurację tylko wtedy, gdy nie istnieje. Biblioteka pozostaje w podanym katalogu.

## Kompilacja

```powershell
.\tools\windows\build.ps1 -Configuration Release
```

Wynik: `game/ultrastardx.exe`. Zamknij tę kopię gry przed buildem. Parametry toolchainu: `-MsysRoot`, `-FpcBin`. Debug: `-Configuration Debug`.

## Paczka Windows

W tym repo uruchom:

```powershell
.\tools\windows\package.ps1
```

Skrypt buduje USDX Release, instaluje zależności z lockfile i pakuje grę, bridge oraz launcher. Wynik: `artifacts/LisiaNora-USDX-<wersja>-windows-x64-<czas>/` i ZIP obok. Uruchamiaj `LisiaNora.exe`. Konfiguracja: [WINDOWS.md](WINDOWS.md).

`-SkipBuild` pakuje już skompilowaną grę. `-GameOnly` tworzy paczkę samej gry. Paczki nie zawierają lokalnego tokenu, ustawień, wyników ani piosenek. Repo Queue nie jest potrzebne do builda. Ikona launchera: `icons/lisia-nora.ico`, osadzana w EXE podczas pakowania.

## WebStorm / Lazarus

Konfiguracje `.run`: Build Debug, Build Release, Run, Package, Open Lazarus, Verify Debugger. Interpreter: `C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe`; opcje `-NoProfile -File`.

Projekt Lazarusa: `src/ultrastardx-queue-win64.lpi`. Build: `tools/windows/lazarus.ps1 -Build`. Wynik: `game/ultrastardx-lazarus.exe`. Debugger: FpDebug w GUI; automatyczne smoke testy używają GDB z Lazarusa.

## Weryfikacja

```powershell
.\tools\windows\smoke-debug.ps1
.\tools\windows\smoke-player-flow.ps1 -Flow Fresh
.\tools\windows\smoke-player-flow.ps1 -Flow Configured
.\tools\windows\smoke-player-flow.ps1 -Flow Playback -Song '<pełna ścieżka TXT>'
```

`npm ci` i `npm test` uruchamiają testy klienta bridge.

Testy graczy używają osobnej konfiguracji, wyników i wymiany w `.local`. `Fresh` sprawdza ekran graczy przed pokazaniem piosenki, oczekiwanie dłuższe niż termin dostarczenia polecenia, anulowanie i ponowny wybór. `Configured` sprawdza zachowanie zatwierdzonych graczy przy kolejnych wyborach. Oba sprawdzają blokadę wyboru podczas śpiewania. Parametr `-Python` pozwala podać ścieżkę interpretera.

`-LibraryPath` testuje bibliotekę przekazaną przez launcher. Z `-ExcludedSong` wskazującym piosenkę ze starej biblioteki profilowej test `Fresh` sprawdza też, że gra jej nie ładuje.

`Playback` sprawdza zdalny Start i Cofnij Start, zachowanie piosenki/graczy, brak nowych wyników po przerwaniu oraz odrzucenie powtórzonego Start i cofnięcia starego wykonania. `Completion` oczekuje na naturalny koniec utworu i ekran wyników; używaj krótkiej testowej piosenki (poniżej 30 s), z nutami przed końcem audio. Testy wymagają Debug; profil testowy bez przypisanych mikrofonów zatwierdza ich standardowe ostrzeżenie.

## Pliki robocze

| Plik/katalog | Zawartość |
|---|---|
| `game/config.ini` | Konfiguracja development. |
| `game/Ultrastar-dev.db` | Wyniki development. |
| `game/Error.log` | Diagnostyka gry. |
| `game/.queue-bridge` | Wymiana z bridge. |
| `.local` | Logi testów i profil Lazarusa. |

Powyższe pliki, EXE, DLL i piosenki są wykluczone z Git. Workflow Windows publikuje paczkę gry z bridge i launcherem jako artefakt; nie wdraża jej na stanowisku.
