#!/usr/bin/env bash
# Mirrors skills from .agents/skills/<name> (source of truth) into
# .claude/skills/<name> and .junie/skills/<name>, since symlinks don't
# survive a commit here (core.symlinks=false on this repo/host).
set -euo pipefail

SRC_ROOT=".agents/skills"
TARGETS=(".claude/skills" ".junie/skills")

for skill_dir in "$SRC_ROOT"/*/; do
  name="$(basename "$skill_dir")"
  for target_root in "${TARGETS[@]}"; do
    dest="$target_root/$name"
    rm -rf "$dest"
    mkdir -p "$target_root"
    cp -r "$skill_dir" "$dest"
    echo "synced $name -> $dest"
  done
done
