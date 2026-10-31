# nix-shell で開発環境に入る。
# Node、pnpm、Python はここで固定し、ストア、キャッシュ、仮想環境は
# すべてプロジェクト内の .local/ と .venv/ に置く。
let
  # nixos-26.05
  nixpkgs = fetchTarball {
    url = "https://github.com/NixOS/nixpkgs/archive/1f607aa79b6356ed45d3cd3c8079c196e79efa2c.tar.gz";
    sha256 = "1s7mrwxqalq59bqklyi3015kr2sy1kvf8a8s6d9ahchv7d3fn39j";
  };
  pkgs = import nixpkgs { };

  # nixpkgs の nodejs_24 は 24.21.0 のため、公式配布の最新版を使う。
  nodeVersion = "24.22.2";
  nodeDist = {
    x86_64-linux = {
      arch = "x64";
      sha256 = "48cc0e21e048790e54c0cf5749c2725005313d652651c40b7a21feb9697aaf75";
    };
    aarch64-linux = {
      arch = "arm64";
      sha256 = "eb187837a2230d4047161ac0be008584e16b46f726e9c9490ee35dc6b17d9ba8";
    };
  }.${pkgs.stdenv.hostPlatform.system};

  node = pkgs.stdenv.mkDerivation {
    pname = "nodejs";
    version = nodeVersion;
    src = pkgs.fetchurl {
      url = "https://nodejs.org/dist/v${nodeVersion}/node-v${nodeVersion}-linux-${nodeDist.arch}.tar.xz";
      inherit (nodeDist) sha256;
    };
    nativeBuildInputs = [ pkgs.autoPatchelfHook ];
    buildInputs = [ pkgs.stdenv.cc.cc.lib ];
    dontConfigure = true;
    dontBuild = true;
    installPhase = ''
      mkdir -p $out
      cp -r bin include lib share $out/
    '';
  };

  pnpm = pkgs.pnpm.override { nodejs-slim = node; };
in
pkgs.mkShell {
  packages = [
    node
    pnpm
    pkgs.python3
  ];

  shellHook = ''
    export DISMOCK_ROOT="$PWD"
    export DISMOCK_LOCAL="$DISMOCK_ROOT/.local"

    # ホームディレクトリに書き込まないよう、各ツールの保存先を変更する。
    export PNPM_HOME="$DISMOCK_LOCAL/pnpm"
    export npm_config_store_dir="$DISMOCK_LOCAL/pnpm/store"
    export npm_config_cache="$DISMOCK_LOCAL/npm-cache"
    export XDG_CACHE_HOME="$DISMOCK_LOCAL/cache"
    export XDG_CONFIG_HOME="$DISMOCK_LOCAL/config"
    export XDG_DATA_HOME="$DISMOCK_LOCAL/data"
    export XDG_STATE_HOME="$DISMOCK_LOCAL/state"
    export PIP_CACHE_DIR="$DISMOCK_LOCAL/pip-cache"
    export PYTHONUSERBASE="$DISMOCK_LOCAL/python"
    export TMPDIR="$DISMOCK_LOCAL/tmp"
    mkdir -p "$PNPM_HOME" "$TMPDIR"

    if [ ! -x "$DISMOCK_ROOT/.venv/bin/python" ]; then
      python3 -m venv "$DISMOCK_ROOT/.venv"
    fi
    export VIRTUAL_ENV="$DISMOCK_ROOT/.venv"

    export PATH="$DISMOCK_ROOT/node_modules/.bin:$VIRTUAL_ENV/bin:$PNPM_HOME:$PATH"
  '';
}
