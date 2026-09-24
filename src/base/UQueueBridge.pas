{ Local queue bridge for Lisia Nora. GPL-2.0-or-later, as USDX. }
unit UQueueBridge;
interface
{$MODE Delphi}
procedure PollQueueBridge;
procedure ShowQueueSongAfterPlayers;
procedure CancelQueueSongAfterPlayers;
procedure QueuePlaybackStarted;
procedure QueuePlaybackFinished(Completed: boolean);
implementation
uses Classes, SysUtils, DateUtils, fpjson, jsonparser,
  UCommandLine, UPath, UDisplay, UGraphic, USong, USongs, UPlaylist, ULog, UIni, UNote;

var
  LastPoll: QWord = 0;
  LastStatus: QWord = 0;
  SessionID, LastID, LastResult, PendingID: string;
  PendingFile: UTF8String;
  PendingExpiry: Int64;
  PlayerSetupFile: UTF8String;
  SelectionID, PerformanceID, PerformanceState, PendingAction: string;
  SelectionFile: UTF8String;
  RecentIDs, RecentResults: array[0..63] of string;
  RecentIndex: integer = 0;

function SelectedFile: IPath;
begin
  Result := PATH_NONE;
  if (ScreenSong.Interaction >= 0) and (ScreenSong.Interaction < Length(CatSongs.Song)) and
    not CatSongs.Song[ScreenSong.Interaction].Main then
    Result := CatSongs.Song[ScreenSong.Interaction].Path.Append(CatSongs.Song[ScreenSong.Interaction].FileName).GetAbsolutePath;
end;

function NoPopup: boolean;
begin
  Result := not ScreenPopupError.Visible and not ScreenPopupInfo.Visible and
    not ScreenPopupCheck.Visible and not ScreenPopupInsertUser.Visible and
    not ScreenPopupHelp.Visible and not ScreenSongMenu.Visible and not ScreenSongJumpto.Visible;
end;

function Ready: boolean;
begin
  Result := NoPopup and (PlayerSetupFile = '') and (Display.NextScreen = nil) and
    ((Display.CurrentScreen = @ScreenMain) or
     ((Display.CurrentScreen = @ScreenSong) and (ScreenSong.Mode = smNormal)));
end;

function CanStart: boolean;
begin
  Result := Ready and (Display.CurrentScreen = @ScreenSong) and
    Assigned(ScreenSing) and not ScreenSong.QueueSelectionNeedsPlayers and
    (SelectionID <> '') and SelectedFile.Equals(Path(SelectionFile).GetAbsolutePath, {$IFDEF MSWINDOWS}true{$ELSE}false{$ENDIF});
end;

function CanReset: boolean;
begin
  Result := NoPopup and (Display.NextScreen = nil) and (Display.CurrentScreen = @ScreenSing) and
    (ScreenSong.Mode = smNormal) and (PerformanceID <> '') and
    (PerformanceState = 'singing') and not ScreenSing.FadeOut;
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
    Data.Add('controlProtocol', 2);
    Data.Add('sessionId', SessionID);
    Data.Add('updatedAt', DateTimeToUnix(Now, false));
    Data.Add('ready', Ready);
    Data.Add('playersConfigured', Assigned(ScreenSing));
    Data.Add('awaitingPlayers', PlayerSetupFile <> '');
    Data.Add('selectionId', SelectionID);
    Data.Add('performanceId', PerformanceID);
    Data.Add('performanceState', PerformanceState);
    Data.Add('canStart', CanStart);
    Data.Add('canReset', CanReset);
    if Display.CurrentScreen = @ScreenMain then Data.Add('screen', 'main')
    else if Display.CurrentScreen = @ScreenSong then Data.Add('screen', 'song')
    else if Display.CurrentScreen = @ScreenName then Data.Add('screen', 'players')
    else if Display.CurrentScreen = @ScreenSing then Data.Add('screen', 'sing')
    else Data.Add('screen', 'other');
    Data.Add('id', LastID);
    Data.Add('result', LastResult);
    if PlayerSetupFile <> '' then Data.Add('selectedFile', PlayerSetupFile)
    else if (Display.CurrentScreen = @ScreenSong) and
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
  RecentIDs[RecentIndex] := ID;
  RecentResults[RecentIndex] := Outcome;
  RecentIndex := (RecentIndex + 1) mod Length(RecentIDs);
  PendingID := '';
  PendingAction := '';
  LastStatus := 0;
  Log.LogStatus('Queue command: ' + Outcome, 'QueueBridge');
end;

function ReplayResult(const ID: string): boolean;
var I: integer;
begin
  Result := false;
  for I := 0 to High(RecentIDs) do
    if RecentIDs[I] = ID then
    begin
      LastID := ID;
      LastResult := RecentResults[I];
      LastStatus := 0;
      Result := true;
      Exit;
    end;
end;

function FindSong(const FileName: UTF8String): integer;
var I: integer; FilePath: IPath;
begin
  Result := -1;
  FilePath := Path(FileName).GetAbsolutePath;
  for I := 0 to High(CatSongs.Song) do
    if not CatSongs.Song[I].Main and
      CatSongs.Song[I].Path.Append(CatSongs.Song[I].FileName).GetAbsolutePath.Equals(FilePath, {$IFDEF MSWINDOWS}true{$ELSE}false{$ENDIF}) then
    begin Result := I; Exit; end;
end;

procedure HighlightSong(TargetIndex: integer);
var I: integer;
begin
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
end;

procedure CancelQueueSongAfterPlayers;
begin
  PlayerSetupFile := '';
  SelectionID := '';
  SelectionFile := '';
  LastStatus := 0;
end;

procedure ShowQueueSongAfterPlayers;
var TargetIndex: integer;
begin
  if PlayerSetupFile = '' then Exit;
  if not Assigned(ScreenSing) or ScreenSong.QueueSelectionNeedsPlayers then Exit;
  TargetIndex := FindSong(PlayerSetupFile);
  PlayerSetupFile := '';
  LastStatus := 0;
  if TargetIndex >= 0 then HighlightSong(TargetIndex);
end;

procedure SelectPending;
var TargetIndex: integer;
begin
  if DateTimeToUnix(Now, false) >= PendingExpiry then
  begin Finish(PendingID, 'expired'); Exit; end;
  if Display.NextScreen <> nil then Exit;
  if not Ready then begin Finish(PendingID, 'busy'); Exit; end;
  TargetIndex := FindSong(PendingFile);
  if TargetIndex < 0 then begin Finish(PendingID, 'not_found'); Exit; end;
  SelectionID := PendingID;
  SelectionFile := PendingFile;
  if not Assigned(ScreenSing) or ScreenSong.QueueSelectionNeedsPlayers then
  begin
    // Commit the local choice before the delivery deadline, then let the user
    // complete normal player setup without a remote-command countdown.
    PlayerSetupFile := PendingFile;
    CatSongs.Selected := TargetIndex;
    ScreenSong.Mode := smNormal;
    ScreenSong.QueueSelectionNeedsPlayers := true;
    ScreenSong.StopMusicPreview;
    PlayersPlay := IPlayersVals[Ini.Players];
    ScreenName.Goto_SingScreen := false;
    Finish(PendingID, 'selected');
    Display.FadeTo(@ScreenName);
    Exit;
  end;
  if Display.CurrentScreen <> @ScreenSong then
  begin
    ScreenSong.Mode := smNormal;
    Display.FadeTo(@ScreenSong);
    Exit;
  end;
  HighlightSong(TargetIndex);
  Finish(PendingID, 'selected');
end;

procedure QueuePlaybackStarted;
begin
  if PerformanceState = 'starting' then PerformanceState := 'singing';
  LastStatus := 0;
end;

procedure QueuePlaybackFinished(Completed: boolean);
begin
  if PerformanceState = 'singing' then
  begin
    if Completed then PerformanceState := 'finished' else PerformanceState := 'stopped';
    LastStatus := 0;
  end;
end;

procedure PollPlaybackCommand;
begin
  if Display.NextScreen <> nil then Exit;
  if PendingAction = 'start' then
  begin
    if (PerformanceState = 'singing') and (Display.CurrentScreen = @ScreenSing) then Finish(PendingID, 'started')
    else begin PerformanceState := 'error'; Finish(PendingID, 'error'); end;
  end
  else if PendingAction = 'reset' then
  begin
    if Display.CurrentScreen = @ScreenSong then Finish(PendingID, 'reset') else Finish(PendingID, 'error');
  end;
end;

procedure ReadPlaybackCommand(Data: TJSONObject; const ID, Action: string);
begin
  if DateTimeToUnix(Now, false) >= Data.Get('expiresAt', Int64(0)) then
  begin Finish(ID, 'expired'); Exit; end;
  if Action = 'start' then
  begin
    if not CanStart or (Data.Get('selectionId', '') <> SelectionID) or
      not SelectedFile.Equals(Path(UTF8String(Data.Get('file', ''))).GetAbsolutePath, {$IFDEF MSWINDOWS}true{$ELSE}false{$ENDIF}) then
    begin Finish(ID, 'busy'); Exit; end;
    PerformanceID := ID;
    PerformanceState := 'starting';
    PendingID := ID;
    PendingAction := Action;
    ScreenSong.StartSong;
  end
  else if Action = 'reset' then
  begin
    if not CanReset or (Data.Get('performanceId', '') <> PerformanceID) then
    begin Finish(ID, 'busy'); Exit; end;
    PendingID := ID;
    PendingAction := Action;
    ScreenSing.SungToEnd := false;
    ScreenSing.FadeOut := true; // Skip the score-screen transition for this aborted take.
    ScreenSing.Finish;
    Display.FadeTo(@ScreenSong);
  end
  else Finish(ID, 'error');
end;

procedure PollQueueBridge;
var Data: TJSONObject; ID, Action: string; Guid: TGuid;
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
    if PendingID <> '' then
    begin
      if PendingAction = '' then SelectPending else PollPlaybackCommand;
    end
    else
    begin
      try Data := ReadCommand; except Data := nil; end;
      if Data <> nil then
      try
        ID := Data.Get('id', '');
        if (ID <> '') and (Length(ID) <= 64) and (ID <> LastID) then
        begin
          Action := Data.Get('action', 'select');
          if ReplayResult(ID) then begin end
          else if (Data.Get('sessionId', '') <> SessionID) then Finish(ID, 'expired')
          else if (Data.Get('protocol', 0) = 2) and (Action <> 'select') then ReadPlaybackCommand(Data, ID, Action)
          else if (Data.Get('protocol', 0) <> 1) or (Action <> 'select') then Finish(ID, 'error')
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
