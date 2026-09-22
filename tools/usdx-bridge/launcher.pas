program LisiaNora;
{$mode objfpc}{$H+}{$APPTYPE GUI}
{$R launcher.res}
uses Windows, SysUtils, Process;
var App: TProcess; Root: string; Guard: THandle; I, Code: Integer;
begin
  Guard := CreateMutexW(nil, False, 'Local\LisiaNoraUSDXQueue');
  if (Guard = 0) or (GetLastError = ERROR_ALREADY_EXISTS) then
  begin
    MessageBoxW(0, 'Lisia Nora USDX is already running.', 'Lisia Nora USDX', MB_OK or MB_ICONINFORMATION);
    if Guard <> 0 then CloseHandle(Guard);
    Halt(2);
  end;
  Root := ExtractFilePath(ParamStr(0));
  App := TProcess.Create(nil);
  Code := 1;
  try
    try
      App.Executable := Root + 'usdx-bridge.exe';
      App.CurrentDirectory := Root;
      App.Options := [poWaitOnExit, poNoConsole];
      for I := 1 to ParamCount do App.Parameters.Add(ParamStr(I));
      App.Execute;
      Code := App.ExitStatus;
    except
      Code := 1;
    end;
    if Code <> 0 then
      MessageBoxW(0, 'Could not start or finish USDX. Check bridge.log and bridge.json beside usdx-bridge.exe (or in the --config directory).', 'Lisia Nora USDX', MB_OK or MB_ICONERROR);
  finally
    App.Free;
    CloseHandle(Guard);
  end;
  Halt(Code);
end.
