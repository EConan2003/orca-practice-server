#!/bin/sh
# Blocks commits that touch files outside this worktree's lane.
# Each lane worktree sets its patterns with: git config --worktree --add lane.allow '<regex>'
# (the orchestrator loads them from .orca/lanes/<lane>.allow).
# The main checkout has no lane.allow, so it is unrestricted.
set -f                                    # stop the shell from glob-expanding the regexes
allow=$(git config --get-all lane.allow)
[ -z "$allow" ] && exit 0
bad=$(git diff --cached --name-only | while IFS= read -r f; do
  ok=0
  for re in $allow; do printf '%s\n' "$f" | grep -Eq "$re" && { ok=1; break; }; done
  [ "$ok" -eq 0 ] && printf '%s\n' "$f"
done)
if [ -n "$bad" ]; then
  echo "lane-guard: these files belong to another lane:"; echo "$bad"
  echo "Unstage them and report to the orchestrator."; exit 1
fi
exit 0
