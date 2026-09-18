import test from "node:test";
import assert from "node:assert/strict";
import { createOpaqueId } from "../../src/core/identity/ids.js";
import {
  validateDomainRole,
  validateRoleDefinition,
  evaluateRole,
  type RoleDefinition,
  type DomainRole
} from "../../src/people/roles/role-types.js";
import type { OperationalGroup } from "../../src/people/operational-groups/operational-group-types.js";

test("G3 Group Roles: Scope validation, group linkage, and membership constraints", () => {
  const opGroupId = createOpaqueId("opg");
  const memberNotableId = createOpaqueId("not");
  const outsiderNotableId = createOpaqueId("not");

  // 1. Custom Role Definition with allowedScopes
  const squadLeaderDef: RoleDefinition = {
    id: "custom:squad-leader",
    version: 1,
    label: "Squad Leader",
    occupancy: { min: 1, max: 1 },
    allowedScopes: ["operational-group"]
  };

  const defValidation = validateRoleDefinition(squadLeaderDef);
  assert.equal(defValidation.ok, true, "Valid RoleDefinition with allowedScopes passes");

  // 2. Cannot create squad leader with scope: 'domain' because allowedScopes only permits operational-group
  const invalidDomainScoped = {
    id: createOpaqueId("role"),
    definitionId: "custom:squad-leader",
    occupants: [memberNotableId],
    scope: "domain"
  };
  const invalidDomainRes = validateDomainRole(invalidDomainScoped, [squadLeaderDef]);
  assert.equal(invalidDomainRes.ok, false, "Disallowed scope should be rejected");
  assert.equal(invalidDomainRes.error.code, "DM_ROLE_SCOPE_NOT_ALLOWED");

  // 3. Operational-group scope without operationalGroupId fails
  const missingGroupId = {
    id: createOpaqueId("role"),
    definitionId: "custom:squad-leader",
    occupants: [memberNotableId],
    scope: "operational-group"
  };
  const missingGroupIdRes = validateDomainRole(missingGroupId, [squadLeaderDef]);
  assert.equal(missingGroupIdRes.ok, false, "Missing operationalGroupId for group role should be rejected");
  assert.equal(missingGroupIdRes.error.code, "DM_ROLE_INVALID_OPERATIONAL_GROUP_ID");

  // 4. Operational-group scope with invalid ID prefix fails
  const badIdPrefix = {
    id: createOpaqueId("role"),
    definitionId: "custom:squad-leader",
    occupants: [memberNotableId],
    scope: "operational-group",
    operationalGroupId: "pop_invalid"
  };
  const badIdRes = validateDomainRole(badIdPrefix, [squadLeaderDef]);
  assert.equal(badIdRes.ok, false, "Bad prefix for operationalGroupId should be rejected");
  assert.equal(badIdRes.error.code, "DM_ROLE_INVALID_OPERATIONAL_GROUP_ID");

  // 5. Valid group role passes validation
  const validGroupRoleInput = {
    id: createOpaqueId("role"),
    definitionId: "custom:squad-leader",
    occupants: [memberNotableId],
    scope: "operational-group" as const,
    operationalGroupId: opGroupId,
    visibility: "public" as const,
    tags: []
  };
  const validRoleRes = validateDomainRole(validGroupRoleInput, [squadLeaderDef]);
  assert.equal(validRoleRes.ok, true, "Valid group role passes");
  assert.equal(validRoleRes.value.scope, "operational-group");
  assert.equal(validRoleRes.value.operationalGroupId, opGroupId);

  // 6. Role evaluation with active group and member occupant
  const mockGroup: OperationalGroup = {
    id: opGroupId,
    name: "Frontier Patrol",
    definitionId: "domain-manager:scout-patrol",
    membershipMode: "explicit",
    size: 5,
    members: [memberNotableId],
    lifecycle: "active",
    visibility: "public",
    tags: []
  };

  const evalGood = evaluateRole(validRoleRes.value, [squadLeaderDef], [mockGroup]);
  assert.equal(evalGood.isValidGroupRole, true, "Group role with member occupant is valid");
  assert.equal(evalGood.isRequirementSatisfied, true);

  // 7. Role evaluation with occupant NOT in the group roster
  const outsiderRole: DomainRole = {
    ...validRoleRes.value,
    occupants: [outsiderNotableId]
  };
  const evalOutsider = evaluateRole(outsiderRole, [squadLeaderDef], [mockGroup]);
  assert.equal(evalOutsider.isValidGroupRole, false, "Group role with non-member occupant is invalid");
  assert.equal(evalOutsider.isRequirementSatisfied, false);

  // 8. Role evaluation when group is disbanded
  const disbandedGroup: OperationalGroup = {
    ...mockGroup,
    lifecycle: "disbanded"
  };
  const evalDisbanded = evaluateRole(validRoleRes.value, [squadLeaderDef], [disbandedGroup]);
  assert.equal(evalDisbanded.isValidGroupRole, false, "Group role with disbanded group is invalid");
  assert.equal(evalDisbanded.isRequirementSatisfied, false);
});
