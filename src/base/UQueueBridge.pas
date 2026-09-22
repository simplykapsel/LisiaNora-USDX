{ Local queue bridge for Lisia Nora. GPL-2.0-or-later, as USDX. }
unit UQueueBridge;
interface
{$MODE Delphi}
procedure PollQueueBridge;
implementation
uses Classes, SysUtils, DateUtils, fpjson, jsonparser,
  UCommandLine, UPath, UDisplay, UGraphic, USong, USongs, UPlaylist, ULog;

var
  LastPoll: QWord = 0;
  LastStatus: QWord = 0;
  SessionID, LastID, LastResult, PendingID: string;
  PendingFile: UTF8String;
  PendingExpiry: Int64;

function Ready: boolean;
begin
  Result := (Display.NextScreen = nil) and
    ((Display.CurrentScreen = @ScreenMain) or
     ((Display.CurrentScreen = @ScreenSong) and (ScreenSong.Mode = smNormal))) and
    not ScreenPopupError.Visible and not ScreenPopupInfo.Visible and
    not ScreenPopupCheck.Visible and not ScreenPopupInsertUser.Visible and
    not ScreenSongMenu.Visible and not ScreenSongJumpto.Visible;
end;

function ReadCommand: TJSONObject;
var Stream: TBinaryFileStream; Data: TJSONData;
begin
  Result := nil;
  if not Params.QueueBridge.Append('command.json').Exists then Exit;
  Stream := TBinaryFileStream.Create(Params.QueueBridge.Append('command.json'), fmOpenRead or fmShareDenyNone);
  try
    if Stream.Size > 16384 then Exit;
    Data := GetJSON(Stream);
    if Data is TJSONObject then Result := TJSONObject(Data) else Data.Free;
  finally Stream.Free; end;
end;

procedure WriteStatus;
var Data: TJSONObject; Stream: TBinaryFileStream; Payload: UTF8String; Temp, Target: IPath;
begin
  Data := TJSONObject.Create;
  try
    Data.Add('protocol', 1);
    Data.Add('sessionId', SessionID);
    Data.Add('updatedAt', DateTimeToUnix(Now, false));
    Data.Add('ready', Ready);
    Data.Add('id', LastID);
    Data.Add('result', LastResult);
    if (Display.CurrentScreen = @ScreenSong) and
      (ScreenSong.Interaction >= 0) and (ScreenSong.Interaction < Length(CatSongs.Song)) and
      not CatSongs.Song[ScreenSong.Interaction].Main then
      Data.Add('selectedFile', CatSongs.Song[ScreenSong.Interaction].Path.Append(
        CatSongs.Song[ScreenSong.Interaction].FileName).GetAbsolutePath.ToUTF8);
    Payload := Data.AsJSON;
    Temp := Params.QueueBridge.Append('status.tmp');
    Target := Params.QueueBridge.Append('status.json');
    Stream := TBinaryFileStream.Create(Temp, fmCreate);
    try
      if Length(Payload) > 0 then Stream.WriteBuffer(Payload[1], Length(Payload));
    finally Stream.Free; end;
    if Target.Exists then Target.DeleteFile;
    Temp.Rename(Target);
  finally Data.Free; end;
end;

procedure Finish(const ID, Outcome: string);
begin
  LastID := ID;
  LastResult := Outcome;
  PendingID := '';
  LastStatus := 0;
  Log.LogStatus('Queue selection: ' + Outcome, 'QueueBridge');
end;

procedure SelectPending;
var I, TargetIndex: integer; FilePath: IPath;
begin
  if DateTimeToUnix(Now, false) >= PendingExpiry then
  begin Finish(PendingID, 'expired'); Exit; end;
  if Display.NextScreen <> nil then Exit;
  if not Ready then begin Finish(PendingID, 'busy'); Exit; end;
  if Display.CurrentScreen <> @ScreenSong then
  begin
    ScreenSong.Mode := smNormal;
    Display.FadeTo(@ScreenSong);
    Exit;
  end;
  TargetIndex := -1;
  FilePath := Path(PendingFile).GetAbsolutePath;
  for I := 0 to High(CatSongs.Song) do
    if not CatSongs.Song[I].Main and
      CatSongs.Song[I].Path.Append(CatSongs.Song[I].FileName).GetAbsolutePath.Equals(FilePath, {$IFDEF MSWINDOWS}true{$ELSE}false{$ENDIF}) then
    begin TargetIndex := I; Break; end;
  if TargetIndex < 0 then begin Finish(PendingID, 'not_found'); Exit; end;
  ScreenSong.OnSongDeSelect;
  PlaylistMan.UnsetPlayList;
  for I := 0 to High(CatSongs.Song) do
    CatSongs.Song[I].Visible := not CatSongs.Song[I].Main;
  CatSongs.CatNumShow := -2;
  CatSongs.ResetVisibleIndexCache;
  ScreenSong.ShowCatTLCustom('Lisia Nora');
  ScreenSong.SkipTo(CatSongs.VisibleIndex(TargetIndex), TargetIndex, CatSongs.VisibleSongs);
  CatSongs.Selected := TargetIndex;
  ScreenSong.SongCurrent := ScreenSong.SongTarget;
  ScreenSong.SetScroll;
  ScreenSong.SetScrollRefresh;
  ScreenSong.ChangeMusic;
  Finish(PendingID, 'selected');
end;

procedure PollQueueBridge;
var Data: TJSONObject; ID: string; Guid: TGuid;
begin
  if (Params = nil) or Params.QueueBridge.IsUnset then Exit;
  if GetTickCount64 - LastPoll < 100 then Exit;
  LastPoll := GetTickCount64;
  try
    if SessionID = '' then
    begin
      CreateGUID(Guid);
      SessionID := GUIDToString(Guid);
      Params.QueueBridge.CreateDirectory;
    end;
    if PendingID <> '' then SelectPending
    else
    begin
      try Data := ReadCommand; except Data := nil; end;
      if Data <> nil then
      try
        ID := Data.Get('id', '');
        if (ID <> '') and (Length(ID) <= 64) and (ID <> LastID) then
        begin
          if (Data.Get('protocol', 0) <> 1) or (Data.Get('sessionId', '') <> SessionID) then Finish(ID, 'expired')
          else if not Ready then Finish(ID, 'busy')
          else
          begin
            PendingID := ID;
            PendingFile := UTF8String(Data.Get('file', ''));
            PendingExpiry := Data.Get('expiresAt', Int64(0));
            SelectPending;
          end;
        end;
      finally Data.Free; end;
    end;
    if (LastStatus = 0) or (GetTickCount64 - LastStatus >= 1000) then
    begin WriteStatus; LastStatus := GetTickCount64; end;
  except
    on E: Exception do
    begin
      if PendingID <> '' then Finish(PendingID, 'error');
      // Malformed or temporarily locked exchange files must never crash the game.
    end;
  end;
end;
end.
