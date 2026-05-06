import { has, run } from './shared.js';

export interface ToolStatus {
  readonly name: string;
  readonly present: boolean;
  readonly version?: string | undefined;
}

const firstLine = (value: string): string | undefined => {
  const [line] = value.trim().split('\n');
  return line && line.length > 0 ? line : undefined;
};

export const collectToolStatus = (
  tools: readonly string[],
  cwd: string
): readonly ToolStatus[] =>
  tools.map((tool) => {
    if (!has(tool)) {
      return { name: tool, present: false };
    }
    const version = run([tool, '--version'], cwd);
    return {
      name: tool,
      present: true,
      ...(version.exitCode === 0 ? { version: firstLine(version.stdout) } : {}),
    };
  });

export const printToolStatuses = (
  title: string,
  statuses: readonly ToolStatus[],
  optional = false
): void => {
  console.error(title);
  for (const status of statuses) {
    if (status.present) {
      console.error(
        `  ${status.name}: ok${status.version ? ` ${status.version}` : ''}`
      );
    } else {
      console.error(
        `  ${status.name}: missing${optional ? ' (ok; capability disabled)' : ''}`
      );
    }
  }
};
