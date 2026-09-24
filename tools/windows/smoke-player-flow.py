# Drives the bundled GDB through MI; GDB itself needs no Python support.
import json, os, time, uuid, subprocess, queue, threading, re
from pathlib import Path
repo = Path(__file__).resolve().parents[2]
process = subprocess.Popen([r'C:\lazarus\mingw\x86_64-win64\bin\gdb.exe', '--interpreter=mi2', '--quiet', 'ultrastardx.exe'],
    cwd=repo/'game', stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
    text=True, encoding='utf-8', errors='replace', creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
lines=queue.Queue()
raw=open(repo/'.local/player-flow-gdb.log','w',encoding='utf-8')
def reader():
    for line in process.stdout:
        raw.write(line); raw.flush(); lines.put(line.rstrip())
reader_thread=threading.Thread(target=reader,daemon=True)
reader_thread.start()
serial=0
pending=[]
def line():
    try:return lines.get(timeout=15)
    except queue.Empty:raise RuntimeError('GDB stopped responding')
def mi(command):
    global serial
    serial+=1; token=str(serial)
    process.stdin.write(token+command+'\n');process.stdin.flush()
    while True:
        result=line()
        if result.startswith('*stopped'):pending.append(result)
        if result.startswith(token+'^'):
            if '^error' in result:raise RuntimeError(result)
            return result
def stopped():
    while not pending:
        result=line()
        if result.startswith('*stopped'):pending.append(result)
    result=pending.pop(0)
    if 'reason="breakpoint-hit"' not in result:raise RuntimeError(result)
def console(command):return mi('-interpreter-exec console '+json.dumps(command))
try:
    console('set pagination off');console('set confirm off')
    console('set args -ConfigFile ../.local/player-flow.ini -ScoreFile ../.local/player-flow.db -QueueBridge "'+os.environ['USDX_TEST_EXCHANGE'].replace('\\','/')+'"')
    source=(repo/'src/base/UMain.pas').read_text(encoding='utf-8').splitlines()
    number=next(i+1 for i,text in enumerate(source) if 'Delay := 1000 div MAX_FPS' in text)
    mi('-break-insert UMain.pas:'+str(number));mi('-exec-run');stopped();console('set language c')
    exchange = os.environ['USDX_TEST_EXCHANGE']
    song = os.environ['USDX_TEST_SONG']
    command_id = str(uuid.uuid4())
    configured_flow = os.environ.get("USDX_TEST_FLOW") == "configured"
    phase = 0
    deadline = time.time() + 45

    def pointer(name):
        result = mi('-data-evaluate-expression ' + json.dumps("*(void **)&'U_$UGRAPHIC_$$_" + name + "'"))
        return int(re.search(r'value="(0x[0-9a-f]+)', result).group(1), 16)

    def start_song():
        console("call ((unsigned char (*)(void *, unsigned int, unsigned int, unsigned char)) &'USCREENSONG$_$TSCREENSONG_$__$$_PARSEINPUT$LONGWORD$UCS4CHAR$BOOLEAN$$BOOLEAN')(*(void **)&'U_$UGRAPHIC_$$_SCREENSONG', 13, 0, 1)")

    def player_key(key):
        console("call ((unsigned char (*)(void *, unsigned int, unsigned int, unsigned char)) &'USCREENNAME$_$TSCREENNAME_$__$$_PARSEINPUT$LONGWORD$UCS4CHAR$BOOLEAN$$BOOLEAN')(*(void **)&'U_$UGRAPHIC_$$_SCREENNAME', " + str(key) + ", 0, 1)")

    def player_count():
        result = mi('-data-evaluate-expression ' + json.dumps("*(int *)&'U_$UNOTE_$$_PLAYERSPLAY'"))
        return int(re.search(r'value="(\d+)', result).group(1))

    def send(game, identifier, expiry):
        temporary = os.path.join(exchange, 'test-command.tmp')
        with open(temporary, 'w', encoding='utf-8') as stream:
            json.dump(dict(protocol=1, id=identifier, sessionId=game['sessionId'], file=song, expiresAt=expiry), stream)
        os.replace(temporary, os.path.join(exchange, 'command.json'))

    while time.time() < deadline:
        mi('-exec-continue'); stopped()
        try:
            with open(os.path.join(exchange, 'status.json'), encoding='utf-8') as stream: game=json.load(stream)
        except (IOError, ValueError): continue
        if phase == 0 and game.get('ready') and game.get('screen') == 'main':
            assert pointer('SCREENSING') == 0, 'Fresh game unexpectedly has a singing controller'
            if configured_flow:
                console("call ((unsigned char (*)(void *, unsigned int, unsigned int, unsigned char)) &'USCREENMAIN$_$TSCREENMAIN_$__$$_PARSEINPUT$LONGWORD$UCS4CHAR$BOOLEAN$$BOOLEAN')(*(void **)&'U_$UGRAPHIC_$$_SCREENMAIN', 13, 0, 1)")
                phase=20
            else:
                send(game, command_id, int(time.time()) - 1)
                phase=30
        elif phase == 30 and game.get('id') == command_id and game.get('result') == 'expired':
            assert game.get('screen') == 'main', 'Expired command opened player setup'
            command_id = str(uuid.uuid4())
            send(game, command_id, int(time.time()) + 3)
            phase=1
        elif phase == 20 and game.get('screen') == 'players':
            player_key(13)
            configured_controller = pointer('SCREENSING')
            assert configured_controller != 0
            phase=21
        elif phase == 21 and game.get('screen') == 'song' and game.get('ready'):
            send(game, command_id, int(time.time()) + 15)
            phase=22
        elif phase == 22 and game.get('id') == command_id and game.get('result') == 'selected':
            assert pointer('SCREENSING') == configured_controller, 'Selection replaced existing players'
            # A second remote choice in the same session must also keep the confirmed setup.
            command_id = str(uuid.uuid4())
            send(game, command_id, int(time.time()) + 15)
            phase=23
        elif phase == 23 and game.get('id') == command_id and game.get('result') == 'selected':
            assert pointer('SCREENSING') == configured_controller
            start_song()
            phase=24
        elif phase == 24 and game.get('screen') == 'players':
            raise AssertionError('Remote selection asked again for already confirmed players')
        elif phase == 24 and game.get('screen') == 'sing':
            assert pointer('SCREENSING') == configured_controller, 'Player resources changed'
            send(game, str(uuid.uuid4()), int(time.time()) + 15)
            phase=6
        elif phase == 1 and game.get('id') == command_id and game.get('result') == 'selected':
            assert os.path.normcase(game['selectedFile']) == os.path.normcase(song)
            assert game.get('awaitingPlayers'), 'Fresh selection bypassed player setup'
            assert not game.get('ready'), 'Player setup must reject another selection'
            assert pointer('SCREENSING') == 0, 'Selection must not confirm players'
            wait_until = time.time() + 4
            phase=2
        elif phase == 2 and game.get('screen') == 'players' and time.time() >= wait_until:
            assert pointer('SCREENSING') == 0, 'Player confirmation was bypassed'
            assert game.get('awaitingPlayers'), 'Accepted selection expired while configuring players'
            player_key(27) # Native cancel returns to main and forgets the local choice.
            phase=3
        elif phase == 3 and game.get('screen') == 'main' and game.get('ready'):
            assert not game.get('awaitingPlayers'), 'Cancelled choice was retained'
            assert pointer('SCREENSING') == 0
            command_id = str(uuid.uuid4())
            send(game, command_id, int(time.time()) + 3)
            wait_until = time.time() + 4
            phase=4
        elif phase == 4 and game.get('screen') == 'players' and time.time() >= wait_until:
            assert game.get('awaitingPlayers')
            previous_count = player_count()
            player_key(1073741904 if previous_count > 1 else 1073741903) # Left/right, away from the boundary.
            player_key(13) # Confirm through the real player/difficulty screen handler.
            assert pointer('SCREENSING') != 0, 'ScreenName did not create the singing controller'
            assert player_count() != previous_count, 'Chosen player count was not applied'
            confirmed_count = player_count()
            phase=5
        elif phase == 5 and game.get('screen') == 'song' and game.get('ready'):
            assert os.path.normcase(game['selectedFile']) == os.path.normcase(song)
            assert game.get('playersConfigured') and not game.get('awaitingPlayers')
            assert player_count() == confirmed_count, 'Song screen changed the chosen player count'
            start_song()
            phase=7
        elif phase == 7 and game.get('screen') == 'players':
            raise AssertionError('Starting selected song asked for players again')
        elif phase == 7 and game.get('screen') == 'sing':
            assert game.get('playersConfigured')
            assert not game.get('ready'), 'Singing must reject remote selection'
            send(game, str(uuid.uuid4()), int(time.time()) + 15)
            phase=6
        elif phase == 6 and game.get('result') == 'busy':
            assert game.get('screen') == 'sing', 'Rejected selection interrupted singing'
            print('PASS: configured players -> repeated remote selection -> singing without another setup; busy command rejected.' if configured_flow else 'PASS: expired request rejected -> players before song -> wait past delivery deadline -> cancel -> retry -> confirm -> selected song -> singing; busy command rejected.')
            break
    else:
        raise RuntimeError('Player flow timed out in phase ' + str(phase))
finally:
    try:mi('-gdb-exit')
    except Exception:process.kill()
    process.wait(timeout=5)
    reader_thread.join(timeout=2)
    raw.close()
