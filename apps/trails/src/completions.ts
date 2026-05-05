/**
 * Shell completion infrastructure for the `trails` CLI.
 *
 * The completion model is a two-part system:
 *
 *  1. A small, static **shell script** registered with the user's shell. The
 *     script's only job is to invoke the binary's internal completion subcommand
 *     (`trails completions __complete`) with the partial argv at tab-press time
 *     and feed the resulting lines back to the shell.
 *  2. A dynamic **`__complete` trail** that parses the partial argv and emits
 *     a sorted list of suggestions (e.g. trail IDs).
 *
 * This split keeps the shell-side script tiny and standardish (no rich shell
 * DSL), while the heavy lifting stays in TypeScript where it can reuse the
 * workspace trail index for accurate, live suggestions.
 */

import { Result, ValidationError } from '@ontrails/core';
import { buildWorkspaceTrailIndex } from '@ontrails/topographer';

/** Shells supported by the completion generator. */
export type CompletionShell = 'bash' | 'zsh' | 'fish';

type ScriptRenderer = (binName: string) => string;

const renderBashScript: ScriptRenderer = (binName) =>
  `# ${binName} bash completion
_${binName}_complete() {
  local cur words
  cur="\${COMP_WORDS[COMP_CWORD]}"
  words=("\${COMP_WORDS[@]:1:COMP_CWORD}")
  COMPREPLY=()
  while IFS= read -r suggestion; do
    COMPREPLY+=("$suggestion")
  done < <(${binName} completions __complete "\${words[@]}" 2>/dev/null)
  return 0
}
complete -F _${binName}_complete ${binName}
`;

const renderZshScript: ScriptRenderer = (binName) =>
  `#compdef ${binName}
# ${binName} zsh completion
_${binName}_complete() {
  local -a suggestions trail_words
  local output
  trail_words=("\${(@)words[2,CURRENT]}")
  output="$(${binName} completions __complete "\${trail_words[@]}" 2>/dev/null)"
  if [[ -n "$output" ]]; then
    suggestions=("\${(@f)output}")
    if (( \${#suggestions} )); then
      compadd -- "\${suggestions[@]}"
    fi
  fi
}
compdef _${binName}_complete ${binName}
`;

const renderFishScript: ScriptRenderer = (binName) =>
  `# ${binName} fish completion
function __${binName}_complete
  set -l tokens (commandline -opc) (commandline -ct)
  set -e tokens[1]
  ${binName} completions __complete $tokens 2>/dev/null
end
complete -c ${binName} -f -a '(__${binName}_complete)'
`;

const SCRIPT_RENDERERS: Readonly<Record<CompletionShell, ScriptRenderer>> = {
  bash: renderBashScript,
  fish: renderFishScript,
  zsh: renderZshScript,
};

/** Pattern that `binName` must match — alphanumerics, underscore, hyphen. */
const BIN_NAME_PATTERN = /^[a-zA-Z0-9_-]+$/;

/**
 * Render a static shell completion script that delegates dynamic completion
 * to `<binName> completions __complete <args...>`.
 *
 * @param shell - target shell flavor.
 * @param binName - binary name to register the completion against (typically
 *   `'trails'`). Used both as the registered command and as the prefix for the
 *   shell function name. Must match `/^[a-zA-Z0-9_-]+$/` — the value is
 *   interpolated verbatim into shell source, so any non-trivial input would
 *   be a shell-injection vector. We validate at the boundary per
 *   "validate at the boundary, trust internally" (docs/tenets.md).
 */
export const renderCompletionScript = (
  shell: CompletionShell,
  binName: string
): Result<string, ValidationError> => {
  if (!BIN_NAME_PATTERN.test(binName)) {
    return Result.err(
      new ValidationError(
        `renderCompletionScript: binName must match /^[a-zA-Z0-9_-]+$/ (got: ${JSON.stringify(binName)})`
      )
    );
  }
  return Result.ok(SCRIPT_RENDERERS[shell](binName));
};

/**
 * Read trail IDs from the live workspace topo and return those matching
 * `prefix`, sorted lexicographically. Includes IDs that collide across multiple
 * apps — the shell only needs the unique set of identifiers, not their owners.
 *
 * @param workspaceRoot - workspace root directory used to resolve apps.
 * @param prefix - prefix to filter by; an empty prefix returns every ID.
 */
export const renderTrailIdCompletions = async (
  workspaceRoot: string,
  prefix: string
): Promise<readonly string[]> => {
  let result: Awaited<ReturnType<typeof buildWorkspaceTrailIndex>>;
  try {
    result = await buildWorkspaceTrailIndex({ cwd: workspaceRoot });
  } catch {
    return [];
  }
  const ids = new Set<string>(Object.keys(result.index));
  for (const collision of result.collisions) {
    ids.add(collision.trailId);
  }
  const matching: string[] = [];
  for (const id of ids) {
    if (id.startsWith(prefix)) {
      matching.push(id);
    }
  }
  matching.sort((a, b) => {
    if (a < b) {
      return -1;
    }
    if (a > b) {
      return 1;
    }
    return 0;
  });
  return matching;
};
