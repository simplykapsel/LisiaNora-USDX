from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
root=Path(__file__).resolve().parents[2]
if not (root/'game/ultrastardx.exe').is_file(): raise SystemExit('Build USDX first.')
(root/'artifacts').mkdir(exist_ok=True)
version=(root/'VERSION').read_text().strip()
destination=root/'artifacts'/f'LisiaNora-USDX-{version}-windows-x64.zip'
exclude_dirs={'songs','playlists','screenshots','.queue-bridge'}
with ZipFile(destination,'w',ZIP_DEFLATED,compresslevel=5) as archive:
    for file in sorted((root/'game').rglob('*')):
        if not file.is_file(): continue
        rel=file.relative_to(root/'game')
        if any(part in exclude_dirs for part in rel.parts): continue
        if file.name.lower() in {'ultrastardx-lazarus.exe', 'lisianora.exe', 'usdx-bridge.exe', 'game.ini'}: continue
        if file.name.lower().startswith('bridge') and file.suffix.lower()=='.json': continue
        if file.name.lower()=='config.ini' or any(suffix in file.name.lower() for suffix in ('.db-', '.sqlite-', '.sqlite3')) or file.suffix.lower() in {'.db','.sqlite','.log','.debug'}: continue
        archive.write(file,rel.as_posix())
    for name in ['COPYING','COPYRIGHT.txt','LICENSE','README.md','QUEUE-BRIDGE.md']:
        if (root/name).is_file(): archive.write(root/name,name)
print(f'Portable package (without songs, local settings and scores): {destination}')
