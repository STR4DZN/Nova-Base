import { BUILD_METADATA } from "../core/versioning/build-metadata.js";

export interface DiagnosticsSnapshot {
  readonly moduleVersion: string;
  readonly buildChannel: string;
  readonly target: string;
  readonly diagnosticScope: "bootstrap";
}

export function createDiagnosticsSnapshot(): DiagnosticsSnapshot {
  return Object.freeze({
    ...BUILD_METADATA,
    diagnosticScope: "bootstrap"
  });
}
