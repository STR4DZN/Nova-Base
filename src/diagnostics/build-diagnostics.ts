import { BUILD_METADATA } from "../core/versioning/build-metadata.js";

export function getBuildDiagnostics() {
  return {
    ...BUILD_METADATA
  };
}
