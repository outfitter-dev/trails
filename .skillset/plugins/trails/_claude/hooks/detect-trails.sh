#!/usr/bin/env bash
# SessionStart hook: detect if this project uses Trails.
# Exits silently if not a Trails project. Injects context if it is.

set -euo pipefail

project_dir="${CLAUDE_PROJECT_DIR:-$PWD}"
pkg="$project_dir/package.json"
reason=""

mark_trails_project() {
  if [[ -z "$reason" ]]; then
    reason="$1"
  fi
}

package_object_has_key() {
  local object_name="$1"
  local key_name="$2"

  [[ -f "$pkg" ]] || return 1

  awk -v object_name="$object_name" -v key_name="$key_name" '
    function count_char(text, char, idx, total) {
      total = 0
      for (idx = 1; idx <= length(text); idx++) {
        if (substr(text, idx, 1) == char) {
          total++
        }
      }
      return total
    }

    in_object {
      if ($0 ~ "\"" key_name "\"[[:space:]]*:") {
        found = 1
      }
      depth += count_char($0, "{") - count_char($0, "}")
      if (depth <= 0) {
        exit found ? 0 : 1
      }
      next
    }

    $0 ~ "\"" object_name "\"[[:space:]]*:[[:space:]]*[{]" {
      in_object = 1
      if ($0 ~ "\"" key_name "\"[[:space:]]*:") {
        found = 1
      }
      depth = count_char($0, "{") - count_char($0, "}")
      if (depth <= 0) {
        exit found ? 0 : 1
      }
      next
    }

    END {
      exit found ? 0 : 1
    }
  ' "$pkg"
}

if [[ -f "$pkg" ]]; then
  if grep -Eq '"@ontrails/' "$pkg"; then
    mark_trails_project "@ontrails/* package dependency"
  fi

  if package_object_has_key "trails" "module"; then
    mark_trails_project "package.json trails.module"
  fi
fi

for config in trails.config.ts trails.config.js trails.config.mjs trails.config.cjs; do
  if [[ -f "$project_dir/$config" ]]; then
    mark_trails_project "$config"
    break
  fi
done

if [[ -d "$project_dir/.trails" ]]; then
  mark_trails_project ".trails/"
fi

for source in "$project_dir/src/app.ts" "$project_dir/src/app.tsx" "$project_dir/src/index.ts" "$project_dir/app.ts"; do
  if [[ -f "$source" ]] &&
    grep -Eq "@ontrails/core" "$source" &&
    grep -Eq "topo[[:space:]]*\\(" "$source"; then
    mark_trails_project "${source#"$project_dir/"} topo source"
    break
  fi
done

[[ -n "$reason" ]] || exit 0

msg="This looks like a Trails project ($reason). Use the repo-bundled/current Trails skill guidance before writing trail code; do not assume a global installed trails skill is current."

if [[ -x "$project_dir/node_modules/.bin/trails" ]]; then
  msg="$msg Non-mutating Warden probe: \`./node_modules/.bin/trails warden --lock cached --no-lock-mutation\`."
elif package_object_has_key "scripts" "trails"; then
  msg="$msg Non-mutating Warden probe: \`bun run trails -- warden --lock cached --no-lock-mutation\`."
elif command -v trails >/dev/null 2>&1; then
  msg="$msg Non-mutating Warden probe: \`trails warden --lock cached --no-lock-mutation\`."
else
  msg="$msg No project-local or PATH \`trails\` CLI was found; install or use the project-pinned \`@ontrails/trails\` before running Warden."
fi

msg="$msg This hook is read-only; run the Trails repo's \`bun run plugin:installed-skill:check\` before relying on installed/global skill copies."

echo "$msg"
