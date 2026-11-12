#!/usr/bin/env bash
set -euo pipefail
export PATH="/usr/bin:/ucrt64/bin:$PATH"
cd "$(dirname "$0")/../.."
: "${USDX_FPC_BIN:=C:/lazarus/fpc/3.2.2/bin/x86_64-win64}"
fpc_bin="$(cygpath -u "$USDX_FPC_BIN")"
export PATH="/usr/bin:/ucrt64/bin:$fpc_bin:$PATH"
export MAKE=/usr/bin/make
export FPCCFG="$(cygpath -m "$fpc_bin/fpc.cfg")"
export FPCDIR="$(cygpath -m "$fpc_bin/../..")"
export FPCMAKE="$fpc_bin/fpcmake.exe"
export BASE_REF="${BASE_REF:-v$(cat VERSION)}"
command -v fpc
[[ -f dists/windows/prefix/$(uname -m)/built_libs && -f game/SDL2.dll ]] || { echo 'Run tools/windows/prepare-runtime.ps1 first.' >&2; exit 1; }
./autogen.sh
if [[ "${1:-Debug}" == Debug ]]; then
  ./configure --with-opencv --with-libprojectM --enable-debug
  make debug PFLAGS_DEBUG='-Xs- -gw3 -gl -O- -dDEBUG_MODE'
else
  ./configure --with-opencv --with-libprojectM
  make release
fi
