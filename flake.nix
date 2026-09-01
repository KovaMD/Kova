{
  description = "Kova — markdown presentation authoring tool";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    # Linux-only: webkitgtk_4_1/gtk3 don't build on darwin.
    flake-utils.lib.eachSystem [ "x86_64-linux" "aarch64-linux" ] (system:
      let
        pkgs = import nixpkgs { inherit system; };
        # Track the app version from tauri.conf.json so releases need no flake edit.
        version = (builtins.fromJSON (builtins.readFile ./src-tauri/tauri.conf.json)).version;

        # Dodges EGL_BAD_PARAMETER GL failures (issue #3); shared so package and
        # dev shell can't drift. Drop when webkitgtk's dmabuf path stops being flaky.
        dmabufVar = "WEBKIT_DISABLE_DMABUF_RENDERER";

        # Runtime/build libraries the Tauri (webkitgtk) shell links against.
        # gtk3/webkitgtk propagate cairo/pango/gdk-pixbuf/atk, so no need to list them.
        libs = with pkgs; [ glib gtk3 webkitgtk_4_1 libsoup_3 openssl ];

        # Frontend assets (dist/) built offline from package-lock.json.
        # `npm run build` (tsc && vite build) is buildNpmPackage's default script.
        # npmDepsHash pins the vendored deps — update it when package-lock.json
        # changes (CI fails and prints the correct hash to paste in). Tried
        # importNpmLock to drop the hash entirely, but it can't resolve this
        # lockfile (ENOTCACHED on a transitive dep).
        frontend = pkgs.buildNpmPackage {
          pname = "kova-frontend";
          inherit version;
          src = ./.;
          npmDepsHash = "sha256-eUOXZRMX9pUgUc46grccOTJMR76ToEFgs/WhTEqUnmY=";
          installPhase = ''
            runHook preInstall
            cp -r dist "$out"
            runHook postInstall
          '';
        };
      in {
        packages.default = pkgs.rustPlatform.buildRustPackage {
          pname = "kova";
          inherit version;
          src = ./src-tauri;
          cargoLock.lockFile = ./src-tauri/Cargo.lock;

          # `tauri build` enables this feature automatically. Since the Nix
          # package calls Cargo directly, enable it here so Tauri embeds
          # frontendDist instead of loading devUrl (localhost:1420).
          buildFeatures = [ "custom-protocol" ];

          # Tauri embeds frontendDist (../dist) at compile time — supply the
          # prebuilt assets instead of letting it shell out to npm.
          preBuild = ''
            cp -r ${frontend} ../dist
          '';

          nativeBuildInputs = with pkgs; [ pkg-config wrapGAppsHook3 ];
          buildInputs = libs;

          postInstall = ''
            install -Dm644 kova.desktop $out/share/applications/kova.desktop
            install -Dm644 icons/32x32.png       $out/share/icons/hicolor/32x32/apps/kova.png
            install -Dm644 icons/64x64.png       $out/share/icons/hicolor/64x64/apps/kova.png
            install -Dm644 icons/128x128.png     $out/share/icons/hicolor/128x128/apps/kova.png
            install -Dm644 icons/128x128@2x.png  $out/share/icons/hicolor/256x256/apps/kova.png
          '';

          preFixup = ''
            gappsWrapperArgs+=(--set ${dmabufVar} 1)
          '';

          meta = with pkgs.lib; {
            description = "Markdown presentation authoring tool";
            homepage = "https://github.com/KovaMD/Kova";
            license = licenses.gpl3Plus;
            platforms = platforms.linux;
            mainProgram = "kova";
          };
        };

        # Contributor shell: rust + node + tauri, no system SDKs to install.
        devShells.default = pkgs.mkShell {
          packages = with pkgs; [ nodejs cargo rustc rust-analyzer cargo-tauri pkg-config ];
          buildInputs = libs;
          shellHook = "export ${dmabufVar}=1";
        };
      });
}
