---
title: Every Nix output fails when a nixpkgs bump moves pnpm past package.json's packageManager pin
date: 2026-11-13
category: build-errors
problem_type: build_error
severity: high
symptoms:
  - "mkPnpmWorkspacePackages: package.json pins pnpm@11.25.0 but the build uses pnpm 11.27.0; pin the version Nix provides"
  - The Nix cache push job reports "nothing built, so nothing was pushed"
tags:
  - nix
  - pnpm
  - packageManager
  - nixpkgs
  - dependabot
---

# Every Nix output fails when a nixpkgs bump moves pnpm past package.json's packageManager pin

## Problem

The nixpkgs bump to f4a03c0 (#91) moved the pnpm that Nix provides from 11.25.0 to 11.27.0. `mkPnpmWorkspacePackages` refuses to build when `package.json`'s `packageManager` names a different pnpm, so `arethetypeswrong-cli`, `pnpm-store` and `workspace-tarballs` all failed, and the cache push had nothing to push.

## Fix

Set `packageManager` to `pnpm@11.27.0`, the version Nix provides. The flake outputs evaluate again.

## Prevention

A nixpkgs bump that changes pnpm's version needs the `packageManager` pin moved in the same PR. Look for this refusal in the nixpkgs PR's Nix job before merging it.
