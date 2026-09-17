import { createPublicError, type PublicError } from "../core/contracts/public-error.js";
import { err, ok, type Result } from "../core/contracts/result.js";
import type { AuthenticatedCommandContext } from "../commands/authenticated-command-context.js";
import type { CommandRegistry } from "../commands/command-registry.js";
import type {
  CommitResult,
  MutationCoordinator,
  MutationDefinition
} from "../mutations/mutation-coordinator.js";
import { createMutationPlan } from "../mutations/plans/plan-contract.js";
import type {
  DomainCreateInput,
  DomainDocument,
  DomainRepositoryContract
} from "../storage/repositories/domain-repository.js";

export function registerDomainCommandHandlers(
  registry: CommandRegistry,
  coordinator: MutationCoordinator,
  domains: DomainRepositoryContract
): void {
  // 1. domain:create
  const createMutation: MutationDefinition<DomainCreateInput, DomainDocument> = {
    getLockKeys: (ctx) => {
      const parentUuid = ctx.command.payload?.record?.definition?.hierarchy?.parentDomainUuid;
      return parentUuid ? ["domain:root", `domain:${parentUuid}`] : ["domain:root"];
    },
    freshRead: async () => {
      return ok({ revision: 0 });
    },
    buildPlan: async (ctx) => {
      const plan = createMutationPlan({
        commandId: ctx.command.commandId,
        lockKeys: ctx.command.payload?.record?.definition?.hierarchy?.parentDomainUuid
          ? ["domain:root", `domain:${ctx.command.payload.record.definition.hierarchy.parentDomainUuid}`]
          : ["domain:root"],
        writeSet: [
          {
            targetRef: "domain:new",
            operationType: "create",
            payload: ctx.command.payload
          }
        ],
        summary: `Create domain '${ctx.command.payload?.name}'`
      });
      return ok(plan);
    },
    commit: async (plan) => {
      const payload = plan.writeSet[0]?.payload as DomainCreateInput;
      if (!payload) {
        return err(
          createPublicError({
            code: "DM_INVALID_DOMAIN_REPOSITORY_INPUT",
            category: "validation",
            message: "Missing create payload in mutation plan"
          })
        );
      }
      const createRes = await domains.create(payload);
      if (!createRes.ok) return err(createRes.error);
      return ok({
        result: createRes.value,
        resultingRevisions: { [createRes.value.id]: createRes.value.record.revision },
        changed: true,
        summary: `Created domain '${createRes.value.name}' (${createRes.value.id})`
      });
    }
  };

  registry.register({
    type: "domain:create",
    visibility: "public",
    transactional: true,
    description: "Authoritatively creates a new Domain in the world repository",
    mutationDefinition: createMutation,
    handler: async (ctx) => {
      const coordRes = await coordinator.execute(ctx, createMutation);
      if (!coordRes.ok) return err(coordRes.error);
      const receipt = coordRes.value;
      if (receipt.status === "rejected") {
        return err(
          receipt.error ??
            createPublicError({
              code: "DM_COMMAND_EXECUTION_FAILED",
              category: "internal",
              message: "domain:create failed"
            })
        );
      }
      return ok(receipt.result as DomainDocument);
    }
  });

  // 2. domain:update
  const updateMutation: MutationDefinition<DomainDocument, DomainDocument> = {
    getLockKeys: (ctx) => [`domain:${ctx.command.payload?.id}`],
    freshRead: async (ctx) => {
      const id = ctx.command.payload?.id;
      if (!id) {
        return err(
          createPublicError({
            code: "DM_DOMAIN_NOT_FOUND",
            category: "not-found",
            message: "Missing domain id in payload"
          })
        );
      }
      const docRes = domains.read(id);
      if (!docRes.ok) return err(docRes.error);
      return ok({
        revision: docRes.value.record.revision,
        entityRevisions: { [`domain:${id}`]: docRes.value.record.revision }
      });
    },
    buildPlan: async (ctx, fresh) => {
      const id = ctx.command.payload.id;
      return ok(
        createMutationPlan({
          commandId: ctx.command.commandId,
          lockKeys: [`domain:${id}`],
          expectedRevisions: { [`domain:${id}`]: fresh.revision ?? 0 },
          writeSet: [
            {
              targetRef: `domain:${id}`,
              operationType: "update",
              payload: ctx.command.payload,
              expectedRevision: fresh.revision
            }
          ],
          summary: `Update domain '${ctx.command.payload.name}'`
        })
      );
    },
    commit: async (plan) => {
      const doc = plan.writeSet[0]?.payload as DomainDocument;
      const saveRes = await domains.save(doc);
      if (!saveRes.ok) return err(saveRes.error);
      return ok({
        result: doc,
        resultingRevisions: { [doc.id]: saveRes.value.revision },
        changed: saveRes.value.status === "updated",
        summary: `Updated domain '${doc.name}' (${doc.id})`
      });
    }
  };

  registry.register({
    type: "domain:update",
    visibility: "public",
    transactional: true,
    description: "Authoritatively updates an existing Domain document",
    mutationDefinition: updateMutation,
    handler: async (ctx) => {
      const coordRes = await coordinator.execute(ctx, updateMutation);
      if (!coordRes.ok) return err(coordRes.error);
      const receipt = coordRes.value;
      if (receipt.status === "rejected") {
        return err(
          receipt.error ??
            createPublicError({
              code: "DM_COMMAND_EXECUTION_FAILED",
              category: "internal",
              message: "domain:update failed"
            })
        );
      }
      return ok(receipt.result as DomainDocument);
    }
  });

  // 3. domain:archive
  const archiveMutation: MutationDefinition<{ id: string; archivedAt?: number }, { status: string; revision: number }> = {
    getLockKeys: (ctx) => [`domain:${ctx.command.payload?.id}`],
    freshRead: async (ctx) => {
      const id = ctx.command.payload?.id;
      if (!id) {
        return err(
          createPublicError({
            code: "DM_DOMAIN_NOT_FOUND",
            category: "not-found",
            message: "Missing domain id in payload"
          })
        );
      }
      const docRes = domains.read(id);
      if (!docRes.ok) return err(docRes.error);
      return ok({
        revision: docRes.value.record.revision,
        entityRevisions: { [`domain:${id}`]: docRes.value.record.revision }
      });
    },
    buildPlan: async (ctx, fresh) => {
      const id = ctx.command.payload.id;
      return ok(
        createMutationPlan({
          commandId: ctx.command.commandId,
          lockKeys: [`domain:${id}`],
          expectedRevisions: { [`domain:${id}`]: fresh.revision ?? 0 },
          writeSet: [
            {
              targetRef: `domain:${id}`,
              operationType: "archive",
              payload: ctx.command.payload
            }
          ],
          summary: `Archive domain '${id}'`
        })
      );
    },
    commit: async (plan) => {
      const payload = plan.writeSet[0]?.payload as { id: string; archivedAt?: number };
      const res = await domains.archive(payload.id, payload.archivedAt);
      if (!res.ok) return err(res.error);
      return ok({
        result: res.value,
        resultingRevisions: { [payload.id]: res.value.revision },
        changed: true,
        summary: `Archived domain '${payload.id}'`
      });
    }
  };

  registry.register({
    type: "domain:archive",
    visibility: "public",
    transactional: true,
    description: "Authoritatively transitions a Domain to archived state",
    mutationDefinition: archiveMutation,
    handler: async (ctx) => {
      const coordRes = await coordinator.execute(ctx, archiveMutation);
      if (!coordRes.ok) return err(coordRes.error);
      const receipt = coordRes.value;
      if (receipt.status === "rejected") {
        return err(
          receipt.error ??
            createPublicError({
              code: "DM_COMMAND_EXECUTION_FAILED",
              category: "internal",
              message: "domain:archive failed"
            })
        );
      }
      return ok(receipt.result as { status: string; revision: number });
    }
  });

  // 4. domain:restore
  const restoreMutation: MutationDefinition<{ id: string }, { status: string; revision: number }> = {
    getLockKeys: (ctx) => [`domain:${ctx.command.payload?.id}`],
    freshRead: async (ctx) => {
      const id = ctx.command.payload?.id;
      if (!id) {
        return err(
          createPublicError({
            code: "DM_DOMAIN_NOT_FOUND",
            category: "not-found",
            message: "Missing domain id in payload"
          })
        );
      }
      const docRes = domains.read(id);
      if (!docRes.ok) return err(docRes.error);
      return ok({
        revision: docRes.value.record.revision,
        entityRevisions: { [`domain:${id}`]: docRes.value.record.revision }
      });
    },
    buildPlan: async (ctx, fresh) => {
      const id = ctx.command.payload.id;
      return ok(
        createMutationPlan({
          commandId: ctx.command.commandId,
          lockKeys: [`domain:${id}`],
          expectedRevisions: { [`domain:${id}`]: fresh.revision ?? 0 },
          writeSet: [
            {
              targetRef: `domain:${id}`,
              operationType: "restore",
              payload: ctx.command.payload
            }
          ],
          summary: `Restore domain '${id}'`
        })
      );
    },
    commit: async (plan) => {
      const payload = plan.writeSet[0]?.payload as { id: string };
      const res = await domains.restore(payload.id);
      if (!res.ok) return err(res.error);
      return ok({
        result: res.value,
        resultingRevisions: { [payload.id]: res.value.revision },
        changed: true,
        summary: `Restored domain '${payload.id}'`
      });
    }
  };

  registry.register({
    type: "domain:restore",
    visibility: "public",
    transactional: true,
    description: "Authoritatively restores an archived Domain to active state",
    mutationDefinition: restoreMutation,
    handler: async (ctx) => {
      const coordRes = await coordinator.execute(ctx, restoreMutation);
      if (!coordRes.ok) return err(coordRes.error);
      const receipt = coordRes.value;
      if (receipt.status === "rejected") {
        return err(
          receipt.error ??
            createPublicError({
              code: "DM_COMMAND_EXECUTION_FAILED",
              category: "internal",
              message: "domain:restore failed"
            })
        );
      }
      return ok(receipt.result as { status: string; revision: number });
    }
  });
}
