# Windows: build i development

## Wymagania

Windows x64; Lazarus 4.8 / FPC 3.2.2 (`C:\lazarus`); MSYS2 (`C:\msys64`): autoconf, automake, make, pkgconf, Git, GCC i narzędzia MinGW64; Python 3.

## Przygotowanie

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

## Paczki

Sama gra z DLL i zasobami:

```powershell
.\tools\windows\package.ps1
```

Wynik: `artifacts/LisiaNora-USDX-<wersja>-windows-x64.zip`. Bez piosenek, ustawień, wyników i logów.

Gra z launcherem i połączeniem NAS/VPS: po buildzie Release uruchom `npm run usdx:package` w repo `UltrastarQueue`. Szczegóły: [instrukcja stanowiska Windows](https://github.com/simplykapsel/ultrastar-queue/blob/main/docs/USDX-INTEGRATION.md).

## WebStorm / Lazarus

Konfiguracje `.run`: Build Debug, Build Release, Run, Package, Open Lazarus, Verify Debugger. Interpreter: `C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe`; opcje `-NoProfile -File`.

Projekt Lazarusa: `src/ultrastardx-queue-win64.lpi`. Build: `tools/windows/lazarus.ps1 -Build`. Wynik: `game/ultrastardx-lazarus.exe`. Debugger: FpDebug w GUI; automatyczne smoke testy używają GDB z Lazarusa.

## Weryfikacja

```powershell
.\tools\windows\smoke-debug.ps1
.\tools\windows\smoke-player-flow.ps1 -Flow Fresh
.\tools\windows\smoke-player-flow.ps1 -Flow Configured
```

Testy graczy używają osobnej konfiguracji, wyników i wymiany w `.local`. `Fresh` sprawdza inicjalizację i anulowanie konfiguracji. `Configured` sprawdza zachowanie zatwierdzonych graczy przy kolejnych wyborach. Oba sprawdzają blokadę wyboru podczas śpiewania.

## Pliki robocze

| Plik/katalog | Zawartość |
|---|---|
| `game/config.ini` | Konfiguracja development. |
| `game/Ultrastar-dev.db` | Wyniki development. |
| `game/Error.log` | Diagnostyka gry. |
| `game/.queue-bridge` | Wymiana z bridge. |
| `.local` | Logi testów i profil Lazarusa. |

Powyższe pliki, EXE, DLL i piosenki są wykluczone z Git. Workflow Windows publikuje paczkę samej gry jako artefakt; nie wdraża jej na stanowisku.
