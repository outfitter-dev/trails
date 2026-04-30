import { TrailsError, errorClasses } from '@ontrails/core';

import {
  extractStringLiteral,
  findConfigProperty,
  findTrailDefinitions,
  identifierName,
  offsetToLine,
  parse,
  walk,
} from './ast.js';
import type { AstNode } from './ast.js';
import { isTestFile } from './scan.js';
import type { WardenDiagnostic, WardenRule } from './types.js';

interface ErrorTypeShape {
  readonly name: string;
  readonly prototype: TrailsError;
}

interface DetourOnType {
  readonly line: number;
  readonly onType: string;
}

const knownErrorConstructors = new Map<string, ErrorTypeShape>([
  [TrailsError.name, TrailsError],
  ...errorClasses.map(({ ctor, name }) => [name, ctor] as const),
]);

const knownErrorParents = new Map<string, string | null>(
  [...knownErrorConstructors.entries()].map(([name, ctor]) => {
    const parent = Object.getPrototypeOf(ctor.prototype)?.constructor;
    const parentName =
      typeof parent?.name === 'string' &&
      knownErrorConstructors.has(parent.name)
        ? parent.name
        : null;
    return [name, parentName];
  })
);

const resolveKnownErrorName = (
  name: string,
  aliases: ReadonlyMap<string, string>
): string => aliases.get(name) ?? name;

const coreImportSource = (node: AstNode): string | null =>
  extractStringLiteral((node as unknown as { source?: AstNode }).source);

const collectImportSpecifierAliases = (
  specifiers: readonly AstNode[] | undefined,
  aliases: Map<string, string>
): void => {
  for (const specifier of specifiers ?? []) {
    if (specifier.type !== 'ImportSpecifier') {
      continue;
    }

    const localName = identifierName(
      (specifier as unknown as { local?: AstNode }).local
    );
    const importedName =
      identifierName(
        (specifier as unknown as { imported?: AstNode }).imported
      ) ?? localName;

    if (localName && importedName && knownErrorConstructors.has(importedName)) {
      aliases.set(localName, importedName);
    }
  }
};

const collectKnownErrorAliases = (
  ast: AstNode
): ReadonlyMap<string, string> => {
  const aliases = new Map<string, string>();

  walk(ast, (node) => {
    if (node.type !== 'ImportDeclaration') {
      return;
    }

    if (coreImportSource(node) !== '@ontrails/core') {
      return;
    }

    const { specifiers } = node as unknown as {
      specifiers?: readonly AstNode[];
    };
    collectImportSpecifierAliases(specifiers, aliases);
  });

  return aliases;
};

const recordLocalErrorParent = (
  parents: Map<string, string>,
  aliases: ReadonlyMap<string, string>,
  className: string | null,
  parentName: string | null
): void => {
  if (!className || !parentName) {
    return;
  }

  parents.set(className, resolveKnownErrorName(parentName, aliases));
};

const collectClassExpressionParent = (
  node: AstNode,
  parents: Map<string, string>,
  aliases: ReadonlyMap<string, string>
): void => {
  if (node.type !== 'VariableDeclarator') {
    return;
  }

  const { init } = node as unknown as { init?: AstNode };
  if (!init || init.type !== 'ClassExpression') {
    return;
  }

  const className = identifierName((node as unknown as { id?: AstNode }).id);
  const parentName = identifierName(
    (init as unknown as { superClass?: AstNode }).superClass
  );
  recordLocalErrorParent(parents, aliases, className, parentName);
};

const collectLocalErrorParents = (
  ast: AstNode,
  aliases: ReadonlyMap<string, string>
): ReadonlyMap<string, string> => {
  const parents = new Map<string, string>();

  walk(ast, (node) => {
    if (node.type === 'ClassDeclaration') {
      const className = identifierName(
        (node as unknown as { id?: AstNode }).id
      );
      const parentName = identifierName(
        (node as unknown as { superClass?: AstNode }).superClass
      );
      recordLocalErrorParent(parents, aliases, className, parentName);
      return;
    }

    collectClassExpressionParent(node, parents, aliases);
  });

  return parents;
};

/**
 * Return the raw AST elements of a trail's `detours` array.
 *
 * @remarks
 * Spread elements (`...baseDetours`) in the `detours` array are intentionally
 * skipped here and by {@link extractDetourOnTypes}. This makes the ordering
 * analysis best-effort for arrays that contain spreads: only literal inline
 * detour object entries are ordering-checked, so spreads can cause both false
 * negatives and false positives depending on where they sit relative to the
 * literal entries.
 */
const getDetourElements = (config: AstNode): readonly (AstNode | null)[] => {
  const detoursProp = findConfigProperty(config, 'detours');
  if (!detoursProp) {
    return [];
  }

  const detoursValue = detoursProp.value as AstNode | undefined;
  if (!detoursValue || detoursValue.type !== 'ArrayExpression') {
    return [];
  }

  const elements = (detoursValue as AstNode)['elements'] as
    | readonly (AstNode | null)[]
    | undefined;
  return elements ?? [];
};

const extractDetourOnTypes = (
  config: AstNode,
  sourceCode: string,
  aliases: ReadonlyMap<string, string>
): readonly DetourOnType[] =>
  getDetourElements(config).flatMap((element) => {
    if (!element || element.type !== 'ObjectExpression') {
      return [];
    }

    const onProp = findConfigProperty(element, 'on');
    const onNode = onProp?.value as AstNode | undefined;
    const onTypeName = identifierName(onNode);
    if (!onNode || !onTypeName) {
      return [];
    }

    return [
      {
        line: offsetToLine(sourceCode, onNode.start),
        onType: resolveKnownErrorName(onTypeName, aliases),
      },
    ];
  });

const nextParentType = (
  errorType: string,
  localParents: ReadonlyMap<string, string>
): string | null =>
  localParents.get(errorType) ?? knownErrorParents.get(errorType) ?? null;

const isSameOrSubtype = (
  candidate: string,
  ancestor: string,
  localParents: ReadonlyMap<string, string>
): boolean => {
  let current: string | null = candidate;
  const seen = new Set<string>();

  while (current && !seen.has(current)) {
    if (current === ancestor) {
      return true;
    }

    seen.add(current);
    current = nextParentType(current, localParents);
  }

  return false;
};

const buildDiagnostic = (
  trailId: string,
  shadowedType: string,
  shadowingType: string,
  filePath: string,
  line: number
): WardenDiagnostic => ({
  filePath,
  line,
  message: `Trail "${trailId}" declares detour on "${shadowedType}" after earlier detour on "${shadowingType}". Because "${shadowingType}" matches "${shadowedType}" first, the later detour is unreachable.`,
  rule: 'unreachable-detour-shadowing',
  severity: 'error',
});

const findShadowingDetour = (
  detours: readonly DetourOnType[],
  index: number,
  localParents: ReadonlyMap<string, string>
): DetourOnType | null => {
  const detour = detours[index];
  if (!detour) {
    return null;
  }

  for (let previousIndex = 0; previousIndex < index; previousIndex += 1) {
    const previous = detours[previousIndex];
    if (
      previous &&
      isSameOrSubtype(detour.onType, previous.onType, localParents)
    ) {
      return previous;
    }
  }

  return null;
};

const buildTrailDiagnostics = (
  trailId: string,
  detours: readonly DetourOnType[],
  filePath: string,
  localParents: ReadonlyMap<string, string>
): readonly WardenDiagnostic[] => {
  const diagnostics: WardenDiagnostic[] = [];

  for (let index = 1; index < detours.length; index += 1) {
    const detour = detours[index];
    const shadowing = findShadowingDetour(detours, index, localParents);
    if (!detour || !shadowing) {
      continue;
    }

    diagnostics.push(
      buildDiagnostic(
        trailId,
        detour.onType,
        shadowing.onType,
        filePath,
        detour.line
      )
    );
  }

  return diagnostics;
};

const buildDiagnostics = (
  ast: AstNode,
  sourceCode: string,
  filePath: string
): readonly WardenDiagnostic[] => {
  const aliases = collectKnownErrorAliases(ast);
  const localParents = collectLocalErrorParents(ast, aliases);
  const diagnostics: WardenDiagnostic[] = [];

  for (const definition of findTrailDefinitions(ast)) {
    if (definition.kind !== 'trail') {
      continue;
    }

    diagnostics.push(
      ...buildTrailDiagnostics(
        definition.id,
        extractDetourOnTypes(definition.config, sourceCode, aliases),
        filePath,
        localParents
      )
    );
  }

  return diagnostics;
};

export const unreachableDetourShadowing: WardenRule = {
  check(sourceCode: string, filePath: string): readonly WardenDiagnostic[] {
    if (isTestFile(filePath)) {
      return [];
    }

    const ast = parse(filePath, sourceCode);
    if (!ast) {
      return [];
    }

    return buildDiagnostics(ast, sourceCode, filePath);
  },
  description:
    'Detect later detours whose on: error type is already matched by an earlier same or broader detour.',
  name: 'unreachable-detour-shadowing',
  severity: 'error',
};
