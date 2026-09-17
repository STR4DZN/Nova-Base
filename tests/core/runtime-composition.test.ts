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

test("G2-AUD-008: runtime.domains is a physical read-only facade without mutators", () => {
  const authority = authorityHost();
  const runtime = composeDomainManagerRuntime({ domainStore: emptyStore(), authority });

  // Runtime properties must be strictly read-only; mutators must not exist on the object
  assert.equal("create" in runtime.domains, false, "create must not exist on runtime.domains");
  assert.equal("save" in runtime.domains, false, "save must not exist on runtime.domains");
  assert.equal("update" in runtime.domains, false, "update must not exist on runtime.domains");
  assert.equal("archive" in runtime.domains, false, "archive must not exist on runtime.domains");
  assert.equal("restore" in runtime.domains, false, "restore must not exist on runtime.domains");
  assert.equal("reparent" in runtime.domains, false, "reparent must not exist on runtime.domains");
  assert.equal("rebuildIndex" in runtime.domains, false, "rebuildIndex must not exist on runtime.domains");

  // Read methods must exist
  assert.equal(typeof runtime.domains.read, "function");
  assert.equal(typeof runtime.domains.query, "function");
  assert.equal(typeof runtime.domains.load, "function");
  assert.equal(typeof runtime.domains.checkIntegrity, "function");

  // Index must also be a read-only projection without mutators
  const index = runtime.domains.getIndex();
  assert.equal("upsert" in index, false, "upsert must not exist on read-only index");
  assert.equal("rebuild" in index, false, "rebuild must not exist on read-only index");
  assert.equal("remove" in index, false, "remove must not exist on read-only index");
  assert.equal(typeof index.get, "function");
  assert.equal(typeof index.list, "function");
  assert.equal(typeof index.query, "function");
});
