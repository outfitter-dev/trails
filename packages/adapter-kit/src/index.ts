export { checkAdapters } from './check.js';
export { isOverlay, resolveTrailsOverlays } from './overlay.js';
export type { Overlay } from './overlay.js';
export type {
  AdapterCheckDiagnostic,
  AdapterCheckDiagnosticCode,
  AdapterCheckDiagnosticSeverity,
  AdapterFact,
  AdapterFactKind,
  AdapterFactProvenance,
  AdapterFactProvenanceSource,
  AdapterCheckReport,
  AdapterCheckSubject,
} from './check.js';
export {
  adapterSourceExportKind,
  adapterSourceExportKindHasType,
  adapterSourceExportKindHasValue,
  adapterSourceExports,
} from './source.js';
export type {
  AdapterSourceExportExpectation,
  AdapterSourceExportKind,
} from './source.js';
export {
  adapterTargetPlacements,
  deriveAdapterTargetCatalog,
  parseAdapterTargetsFromManifest,
} from './catalog.js';
export type {
  AdapterTargetCatalog,
  AdapterTargetCatalogDiagnostic,
  AdapterTargetCatalogDiagnosticCode,
  AdapterTargetCatalogEntry,
  AdapterTargetConformanceManifest,
  AdapterTargetManifestEntry,
  AdapterTargetPackageManifest,
  AdapterTargetParseContext,
  AdapterTargetPlacement,
  AdapterTargetPlacementValue,
} from './catalog.js';
