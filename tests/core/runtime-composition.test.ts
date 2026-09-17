import assert from "node:assert/strict";
import test from "node:test";
import { PrimaryAuthorityService } from "../../src/authority/primary-authority-service.js";
import type {
  FoundryAuthorityUserLike,
  PrimaryAuthorityHost
} from "../../src/authority/foundry-primary-authority-adapter.js";
import { composeDomainManagerRuntime } from "../../src/bootstrap/domain-manager-runtime.js";
import type { DomainDocumentStore } from "../../src/storage/repositories/domain-repository.js";

function emptyStore(): DomainDocumentStore {
  return {
    get: () => undefined,
    list: () => [],
    create: async () => {
      throw new Error("create should not be called while composing runtime");
    }
  };
}

function authorityHost(): PrimaryAuthorityHost {
  const service = new PrimaryAuthorityService<FoundryAuthorityUserLike>({
    getUsers: () => [],
    getPreferredUserId: () => null,
    getCurrentUserId: () => null
  });

  return {
    service,
    reconcile: async () => service.resolve(),
    synchronizePersistedState: (value) => service.synchronizeState(value as import("../../src/authority/primary-authority-service.js").PrimaryAuthorityState)
  };
}

test("composition root wires injected Domain and Authority boundaries into one runtime", () => {
  const authority = authorityHost();
  const runtime = composeDomainManagerRuntime({ domainStore: emptyStore(), authority });

  assert.equal(Object.isFrozen(runtime), true);
  assert.equal(runtime.domains.query().ok, true);
  assert.equal(runtime.authority, authority);
});

test("composition root performs no persistence writes during construction", () => {
  let domainWrites = 0;
  let authorityReconciles = 0;
  const store: DomainDocumentStore = {
    get: () => undefined,
    list: () => [],
    create: async () => {
      domainWrites += 1;
      throw new Error("unexpected write");
    }
  };
  const authority = authorityHost();
  const wrappedAuthority: PrimaryAuthorityHost = {
    service: authority.service,
    async reconcile() {
      authorityReconciles += 1;
      return authority.reconcile();
    },
    synchronizePersistedState: (value) => authority.synchronizePersistedState(value)
  };

  composeDomainManagerRuntime({ domainStore: store, authority: wrappedAuthority });
  assert.equal(domainWrites, 0);
  assert.equal(authorityReconciles, 0);
});
