import { Registry } from "./registry.js";

export interface BaseExtensionDefinition {
  readonly id: string;
  readonly version: string;
  readonly label: string;
}

export const baseExtensionRegistry = new Registry<BaseExtensionDefinition>(
  "base-extensions"
);

export function registerBaseExtension(extension: BaseExtensionDefinition): void {
  baseExtensionRegistry.register(extension.id, extension);
}

export function freezeBaseExtensions(): void {
  baseExtensionRegistry.freeze();
}
