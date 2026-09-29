import type { DomainReadRepository, DomainRepositoryContract } from "../../src/storage/repositories/domain-repository.js";
import { PeopleService, type PublicPeopleApi } from "../../src/people/services/people-service.js";
import { PeopleRepository } from "../../src/people/repositories/people-repository.js";
import { WorkforceReservationService } from "../../src/people/services/workforce-reservation-service.js";
import type { WorkforceReservationPort } from "../../src/people/services/workforce-reservation-port.js";

declare const readOnly: DomainReadRepository;
declare const mutable: DomainRepositoryContract;
declare const publicPeople: PublicPeopleApi;

new PeopleService(readOnly);
const internal: WorkforceReservationPort = new WorkforceReservationService(mutable);
internal.getReservations("JournalEntry.domain");
// @ts-expect-error Internal repository requires update(), which a read-only contract lacks.
new PeopleRepository(readOnly);
// @ts-expect-error Internal workforce service must never accept the public read-only repository.
new WorkforceReservationService(readOnly);
// @ts-expect-error Public People must not satisfy the mutation port.
const invalidPort: WorkforceReservationPort = publicPeople;
// @ts-expect-error Public People must not expose direct workforce mutation.
publicPeople.allocateWorkforceReservation({ domainUuid: "domain", projectId: "project", amount: 5 });
