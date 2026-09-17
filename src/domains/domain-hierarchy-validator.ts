import { err, ok, type Result } from "../core/contracts/result.js";
import { createPublicError, type Warning } from "../core/contracts/public-error.js";
import { isJournalEntryUuid } from "../core/identity/refs.js";

export interface DomainHierarchyNode {
  readonly uuid: string;
  readonly parentDomainUuid: string | null;
}

function invalid(message: string): Result<never> {
  return err(createPublicError({
    code: "DM_INVALID_DOMAIN_HIERARCHY",
    category: "validation",
    message
  }));
}

function cycle(nodeUuid: string): Result<never> {
  return err(createPublicError({
    code: "DM_DOMAIN_HIERARCHY_CYCLE",
    category: "integrity",
    message: `Domain hierarchy contains a cycle involving ${nodeUuid}`
  }));
}

function missingNode(nodeUuid: string): Result<never> {
  return err(createPublicError({
    code: "DM_DOMAIN_HIERARCHY_NODE_NOT_FOUND",
    category: "not-found",
    message: `Domain hierarchy node was not found: ${nodeUuid}`
  }));
}

function missingParent(parentUuid: string): Result<never> {
  return err(createPublicError({
    code: "DM_DOMAIN_PARENT_NOT_FOUND",
    category: "not-found",
    message: `Domain parent was not found: ${parentUuid}`
  }));
}

function validateNodeShape(node: DomainHierarchyNode): Result<void> {
  if (!isJournalEntryUuid(node.uuid)) return invalid("Domain hierarchy node uuid must be a full JournalEntry UUID");
  if (node.parentDomainUuid !== null && !isJournalEntryUuid(node.parentDomainUuid)) {
    return invalid("Domain parentDomainUuid must be null or a full JournalEntry UUID");
  }
  return ok(undefined);
}

function orphanWarning(nodeUuid: string, parentUuid: string): Warning {
  return {
    code: "DM_DOMAIN_ORPHAN_PARENT",
    message: `Domain ${nodeUuid} references a missing parent ${parentUuid}`,
    details: { nodeUuid, parentUuid }
  };
}

export function validateDomainHierarchy(nodes: readonly DomainHierarchyNode[]): Result<void> {
  const byUuid = new Map<string, DomainHierarchyNode>();
  const warnings: Warning[] = [];

  for (const node of nodes) {
    const shape = validateNodeShape(node);
    if (!shape.ok) return shape;
    if (byUuid.has(node.uuid)) return invalid(`Duplicate Domain hierarchy UUID: ${node.uuid}`);
    byUuid.set(node.uuid, node);
  }

  for (const node of nodes) {
    if (node.parentDomainUuid !== null && !byUuid.has(node.parentDomainUuid)) {
      warnings.push(orphanWarning(node.uuid, node.parentDomainUuid));
    }
  }

  for (const node of nodes) {
    const visited = new Set<string>();
    let current: string | null = node.uuid;
    while (current !== null) {
      if (visited.has(current)) return cycle(current);
      visited.add(current);
      const currentNode = byUuid.get(current);
      if (currentNode === undefined) break;
      current = currentNode.parentDomainUuid;
    }
  }

  return ok(undefined, warnings);
}

export function validateDomainReparent(
  nodes: readonly DomainHierarchyNode[],
  nodeUuid: string,
  parentDomainUuid: string | null
): Result<void> {
  if (!isJournalEntryUuid(nodeUuid)) return invalid("Domain uuid must be a full JournalEntry UUID");
  if (parentDomainUuid !== null && !isJournalEntryUuid(parentDomainUuid)) {
    return invalid("Domain parentDomainUuid must be null or a full JournalEntry UUID");
  }

  const current = nodes.find((node) => node.uuid === nodeUuid);
  if (current === undefined) return missingNode(nodeUuid);
  if (parentDomainUuid !== null && !nodes.some((node) => node.uuid === parentDomainUuid)) return missingParent(parentDomainUuid);
  if (parentDomainUuid === nodeUuid) return cycle(nodeUuid);

  const proposed = nodes.map((node) => (
    node.uuid === nodeUuid ? { ...node, parentDomainUuid } : node
  ));
  return validateDomainHierarchy(proposed);
}
