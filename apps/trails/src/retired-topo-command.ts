const retiredTopoCommandReplacements = {
  check: 'trails validate',
  compile: 'trails compile',
  verify: 'trails validate',
} as const;

export type RetiredTopoCommand = keyof typeof retiredTopoCommandReplacements;

export interface RetiredTopoCommandDiagnostic {
  readonly attempted: `trails topo ${RetiredTopoCommand}`;
  readonly message: string;
  readonly replacement: (typeof retiredTopoCommandReplacements)[RetiredTopoCommand];
}

const isRetiredTopoCommand = (
  command: string | undefined
): command is RetiredTopoCommand =>
  command !== undefined && command in retiredTopoCommandReplacements;

export const getRetiredTopoCommandDiagnostic = (
  argv: readonly string[]
): RetiredTopoCommandDiagnostic | null => {
  const [command, subcommand] = argv.slice(2);
  if (command !== 'topo' || !isRetiredTopoCommand(subcommand)) {
    return null;
  }

  const replacement = retiredTopoCommandReplacements[subcommand];
  const attempted = `trails topo ${subcommand}` as const;

  return {
    attempted,
    message: `"${attempted}" was retired. Use "${replacement}" instead.\nTopography artifact commands now live at the top level: "trails compile", "trails validate", and "trails diff". "trails topo" is for topo-store history, pin, and unpin.`,
    replacement,
  };
};
