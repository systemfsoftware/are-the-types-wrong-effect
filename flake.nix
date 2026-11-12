{
  description = "are-the-types-wrong toolchain — the formatter and runtimes the check chain shells out to";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    comment-checker = {
      url = "github:systemfsoftware/comment-checker";
      inputs.nixpkgs.follows = "nixpkgs";
    };
    pnpm-release-management = {
      url = "github:systemfsoftware/pnpm-release-management";
      inputs.nixpkgs.follows = "nixpkgs";
      inputs.comment-checker.follows = "comment-checker";
      inputs.importPnpmLock.follows = "importPnpmLock";
    };
    # Hashless pnpm store: each lockfile integrity is the fetch hash.
    # fetchPnpmDeps needs a second store-wide hash that Dependabot cannot update.
    importPnpmLock = {
      url = "github:Scrumplex/importPnpmLock.nix";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };

  outputs = { self, nixpkgs, comment-checker, importPnpmLock, pnpm-release-management }:
    let
      systems = [ "x86_64-linux" "aarch64-linux" ];
      forEachSystem = fn: nixpkgs.lib.genAttrs systems (system: fn nixpkgs.legacyPackages.${system});
    in
    {
      packages = forEachSystem (pkgs:
        let
          pkgs' = pkgs.extend importPnpmLock.overlays.default;
          dprint = pkgs.callPackage ./nix/dprint.nix { };
          cc = comment-checker.packages.${pkgs.system}.comment-checker;
          comment-checker-bwrap = pkgs.callPackage ./nix/comment-checker-bwrap.nix { comment-checker = cc; };
          attw = pkgs'.callPackage ./nix/attw.nix { };
          # `workspace-tarballs` and one `<package>` output per public member.
          # The builder requires `packageManager` to pin exactly this pnpm.
          workspace = pnpm-release-management.lib.mkPnpmWorkspacePackages {
            inherit pkgs;
            src = self;
            pname = "are-the-types-wrong";
            pnpm = pkgs.pnpm_11;
          };
        in workspace // { inherit dprint attw comment-checker-bwrap; comment-checker = cc; default = dprint; });

      # pnpm is not a nixpkgs package here: `packageManager` pins pnpm@11.25.0
      # and corepack resolves exactly that version. The shim gives the release
      # plan a `pnpm` on PATH (`nix develop` runs this hook). The
      # `workspace-tarballs` build runs the pnpm_11 nixpkgs provides, which
      # `packageManager` must name exactly (evaluation fails otherwise).
      devShells = forEachSystem (pkgs: {
        default = pkgs.mkShell {
          packages = [
            self.packages.${pkgs.stdenv.hostPlatform.system}.dprint
            self.packages.${pkgs.stdenv.hostPlatform.system}.comment-checker-bwrap
            pkgs.nodejs_24
            pkgs.deno
            pkgs.process-compose
          ];
          shellHook = ''
            mkdir -p "$HOME/.cache/corepack-shims"
            corepack enable pnpm --install-directory "$HOME/.cache/corepack-shims"
            export PATH="$HOME/.cache/corepack-shims:$PATH"
          '';
        };
      });
    };
}
