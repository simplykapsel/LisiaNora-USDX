# Lisia Nora USDX — środowisko Windows

Baza: oficjalny tag **v2026.9.0**, commit `8b5324f321d54491badadf5f95b4678a0bcf4633`.
Na tej bazie działa integracja wyboru utworu: [opis połączenia z kolejką](QUEUE-BRIDGE.md).

## Zainstalowane narzędzia

- Lazarus 4.8 i Free Pascal 3.2.2 (x86_64): `C:\lazarus`.
- MSYS2: `C:\msys64`; autoconf, automake, make, pkgconf, Git, GCC i narzędzia MinGW64.
- WebStorm 2026.2: Pascal Flow 6.0.0 (wymagany restart IDE, jeżeli działało podczas instalacji).
- Python oraz Git/GitHub CLI były już zainstalowane.

## Praca w WebStormie

Otwórz katalog repozytorium. Wybierz konfigurację uruchamiania z listy:

| Konfiguracja | Działanie |
|---|---|
| USDX Build Debug | Kompiluje z symbolami DWARF 3, bez optymalizacji. |
| USDX Build Release | Kompiluje wydanie do paczki portable. |
| USDX Run | Otwiera lokalną grę; panel działa do zamknięcia gry. |
| USDX Verify Debugger | Uruchamia test breakpointu (po Build Debug). |
| USDX Package | Tworzy ZIP z aktualnego wyniku kompilacji. |
| USDX Open Lazarus | Otwiera przygotowany projekt debugowania. |

Konfiguracje `.run` korzystają z dołączonej do WebStorma obsługi Shell Script,
ale jako interpreter mają ustawioną pełną ścieżkę `C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe`. W Tools → External Tools
jest też lokalna grupa **LisiaNora USDX**. Nie trzeba zmieniać globalnego PATH.

## Polecenia niezależne od IDE

Uruchamiaj w PowerShellu w głównym katalogu repozytorium:

```powershell
.\tools\windows\prepare-runtime.ps1 -Download
.\tools\windows\init-dev.ps1 -SongsPath 'D:\UltraStar Deluxe\songs'
.\tools\windows\build.ps1 -Configuration Debug
.\tools\windows\smoke-debug.ps1
.\tools\windows\run-dev.ps1
```

Zamknij uruchomioną wersję testową przed kolejną kompilacją.
`build.ps1` przyjmuje opcjonalne `-MsysRoot` i `-FpcBin` dla innych instalacji.
Zależności pobiera oficjalny `dldlls.py` przypisany do tej wersji źródeł;
wypakowywane są również zgodne ustawienia `src/config-win.inc`.

## Debugowanie w Lazarusie

```powershell
.\tools\windows\lazarus.ps1 -Build
.\tools\windows\smoke-debug.ps1 -Executable ultrastardx-lazarus.exe
.\tools\windows\lazarus.ps1
```

Projekt: `src/ultrastardx-queue-win64.lpi`. Ma poprawioną architekturę Win64,
format DWARF 3, lokalny katalog jednostek i ścieżkę roboczą `game`.
Oryginalny projekt upstreamu nie jest nadpisany.

W Lazarusie otwórz `src/base/UMain.pas`, ustaw breakpoint na instrukcji opisanej poniżej
(`Delay := 1000 div MAX_FPS ...`) i naciśnij F9. Jest to punkt po pierwszym
rysowaniu klatki. `Done` powinno mieć wartość `False`.
Test automatyczny używa GDB dostarczonego z Lazarusem i zapisuje dowody do
`.local/smoke-gdb.log`. GUI Lazarusa ma domyślnie backend FpDebug; kliknięcia
F9 i zatrzymania w jego interfejsie nie zastępuje test GDB.

## Piosenki, konfiguracja i wyniki

- Biblioteka lokalna: `D:\UltraStar Deluxe\songs` (odczytywana w miejscu).
- Konfiguracja testowa: `game/config.ini`; istniejąca konfiguracja nie jest nadpisywana.
- Wyniki testowe: `game/Ultrastar-dev.db`.
- Log gry: `game/Error.log`.
- Logi i profil Lazarusa: `.local/`.

Konfiguracja, wyniki, piosenki, pliki wykonywalne i DLL nie trafiają do Git.
Nie używaj edytora piosenek na oryginalnej bibliotece, jeżeli chcesz jedynie
sprawdzać działanie gry; do testowania edycji użyj osobnej kopii utworu.

## Paczka portable

```powershell
.\tools\windows\build.ps1 -Configuration Release
.\tools\windows\package.ps1
```

Wynik: `artifacts/LisiaNora-USDX-2026.9.0-windows-x64.zip`.
Paczka zawiera wykonywalną grę, zasoby, DLL i pliki licencji. Nie zawiera
piosenek, prywatnych ustawień, wyników ani logów. Po rozpakowaniu skonfiguruj
w niej własną bibliotekę. Wersja kompilowana przez Lazarusa nie jest dołączana.

## Git i aktualizacje

- `origin`: publiczny fork `simplykapsel/LisiaNora-USDX`.
- `upstream`: `UltraStar-Deluxe/USDX`.
- `main`: nasze środowisko na bazie v2026.9.0; stare `master` pozostaje dostępne.
- Nową funkcję rozwijaj na osobnej gałęzi i przeglądaj przez PR.
- Nowe wydanie upstreamu wprowadzaj na osobnej gałęzi, wykonując ponownie
  kompilację, test uruchomienia/debuggera i testy audio/mikrofonów.

Windows-only GitHub Actions używa tych samych skryptów i publikuje ZIP jako
artefakt wykonania. Nie tworzy automatycznie publicznych wydań ani nie wysyła
piosenek. Usunięto odziedziczony harmonogram codziennych kompilacji.

## Weryfikacja 2026-09-22

- Kompilacja MSYS2: Debug i Release zakończone powodzeniem.
- Kompilacja projektu Lazarusa Win64: powodzenie.
- Dla obu wersji debug: breakpoint po pierwszej klatce, stos wywołań i odczyt zmiennych w GDB działają.
- Wersja Release wypakowana z ZIP również dotarła do tego samego breakpointu.
- Zawartość ZIP sprawdzona: brak piosenek, konfiguracji, wyników i logów;
  plik EXE zgodny z wynikiem kompilacji.
- Źródła upstreamu emitują 47 ostrzeżeń kompilatora; nie blokują kompilacji.
- `songs/ffmpeg_failed.txt` w lokalnej bibliotece jest raportowany przez grę
  jako niepoprawny plik piosenki. Pozostawiono go bez zmian.
- Nie wykonano odsłuchu ani pełnego testu śpiewania do mikrofonu.
