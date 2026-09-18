export {
  composeDomainManagerRuntime,
  type DomainManagerRuntime,
  type DomainManagerRuntimeOptions
} from "./bootstrap/domain-manager-runtime.js";
export {
  PeopleApplication,
  PeopleApplicationController,
  type PeopleAppOptions,
  type PeopleTab,
  type SelectedEntity
} from "./ui/domain-patterns/people/people-app.js";
export {
  PeopleRepairTool,
  type PeopleRepairResult
} from "./people/services/people-repair-tool.js";
export {
  PeopleService,
  type PublicPeopleApi,
  type PeopleServiceOptions
} from "./people/services/people-service.js";
