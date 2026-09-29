/**
 * Domain Manager G5 smoke v2 — Foundry v13.351 / module v0.0.6.
 * Execute the entire file as GM, F5 when requested, execute again. Two real
 * reloads test a durable executing workforce step: first fenced, then recovered.
 * Finally run the same file as a Player controller with a GM online.
 * Mutations use public command facades. Only the GM crash fixture edits its own
 * Domain and its own transaction record; no second runtime/socket is created.
 * Cleanup: await DM_G5_SMOKE_CLEANUP(). Reports: DM_G5_SMOKE_REPORT.
 */
(async () => {
  const NS = "domain-manager", MARK = "domain-manager-g5-smoke-v2";
  const TX_NS = "domain-manager-transactions", TX_NAME = "[Domain Manager] Transaction Store";
  const rows = [], isGM = !!game.user?.isGM, pageId = globalThis.DM_G5_SMOKE_PAGE_ID ??= crypto.randomUUID();
  const api = game.modules.get(NS)?.api;
  const clone = x => JSON.parse(JSON.stringify(x));
  const add = (status, name, details = "") => {
    rows.push({ status, name, details: String(details) });
    console[status === "FAIL" ? "error" : "log"](`[G5 SMOKE v2] ${status} — ${name}${details ? ` :: ${details}` : ""}`);
  };
  const check = (value, name, details = "") => { add(value ? "PASS" : "FAIL", name, details); return !!value; };
  const must = (value, name, details = "") => { if (!check(value, name, details)) throw new Error(name); };
  const requireCleanPhase = () => {
    if (rows.some(row => row.status === "FAIL")) throw new Error("Corrija os FAIL desta fase antes de avançar o smoke.");
  };
  async function call(name, promise) {
    const r = await promise;
    must(r?.ok && r.value?.status !== "rejected", name, r?.ok ? JSON.stringify(r.value?.error ?? r.value?.status ?? "") : JSON.stringify(r?.error));
    return r.value?.status === "executed" ? r.value.result : r.value;
  }
  async function deny(name, promise, code) {
    const r = await promise, error = r?.ok ? r.value?.error : r?.error;
    check((!r?.ok || r.value?.status === "rejected") && (!code || error?.code === code), name, error?.code ?? "unexpected success");
  }
  const fixtures = () => game.journal.contents.filter(d => d.flags?.[MARK]?.kind === "fixture");
  const getA = () => fixtures().find(d => d.flags[MARK].role === "A");
  const data = d => d.flags[NS].definition.capabilities.config;
  const workforce = async d => (await call("People: workforce query", api.people.getWorkforce(d.uuid))).types.general;
  const balance = async (d, resource) => (await call(`Economy: read ${resource}`, api.economy.getAccount(d.uuid, `domain-manager:${resource}`))).balanceMinor;
  const saveState = (d, s) => d.update({ [`flags.${MARK}`]: s });
  const txDoc = () => game.journal.contents.find(d => d.name === TX_NAME && d.flags?.[TX_NS]?.records);
  const participant = name => ({ participantRef: `narrative:${name}`, participantType: "narrative", role: "participant", name });
  async function project(d, name, amount = 0, workRequired = 20) {
    return (await call(`Project: start ${name}`, api.projects.startProject({ domainUuid: d.uuid,
      definitionId: "domain-manager:survey", name, workRequired, workforceRequired: amount }))).project.id;
  }
  async function activity(d, name, durationTicks, definitionId = "domain-manager:rest-and-recuperation") {
    return (await call(`Downtime: start ${name}`, api.downtime.startActivity({ domainUuid: d.uuid,
      definitionId, label: name, durationTicks, participants: [{ ...participant(name),
        role: definitionId === "domain-manager:crafting" ? "owner" : "participant" }] }))).activity.id;
  }
  async function verify(d, s) {
    const p = await call("Persistência: Project A", api.projects.getProject(d.uuid, s.projectA));
    check(p.lifecycle === "completed" && p.workCompleted === 20, "Project completo persistido");
    const f = await call("Persistência: Workshop", api.facilities.getFacility(d.uuid, s.facility));
    check(f.integrity.current === 90, "Facility reparada persistida", f.integrity.current);
    const a = await call("Persistência: Crafting", api.downtime.getActivity(d.uuid, s.crafting));
    check(a.lifecycle === "completed" && a.elapsedTicks === 10, "Downtime finita salvou ticks finais", `${a.lifecycle}/${a.elapsedTicks}`);
    const rest = await call("Persistência: atividade indefinida", api.downtime.getActivity(d.uuid, s.indefinite));
    check(rest.lifecycle === "inProgress" && rest.durationTicks === null && rest.elapsedTicks === 100,
      "Indefinite não auto-completa e preserva 100 ticks", `${rest.lifecycle}/${rest.durationTicks}/${rest.elapsedTicks}`);
    const vm = api.downtime.buildViewModel(d.flags[NS]);
    check(vm.activities.some(a => a.id === s.indefinite && a.isIndefinite && a.progressPercent === null), "Indefinite: percentual null na projeção");
    check(await balance(d, "materials") === 1980, "Materials persistiu 1980");
    check(await balance(d, "supplies") === 15, "Supplies persistiu 15");
    check(await balance(d, "treasury") === 5100, "Treasury persistiu 5100");
  }
  async function uiSmoke(d) {
    const bundle = await import("/modules/domain-manager/dist/main.js");
    for (const [key, cls, selector, modal] of [
      ["Projects", bundle.ProjectsApplication, ".dm-projects-app-v2", "openStartModal"],
      ["Facilities", bundle.FacilitiesApplication, ".dm-facilities-app-v2", "openCreateModal"],
      ["Downtime", bundle.DowntimeApplication, ".dm-downtime-app-v2", "openStartModal"]
    ]) {
      const app = new cls({ domainUuid: d.uuid, domains: api.domains });
      try {
        await app.render({ force: true });
        const root = app.element?.[0] ?? app.element;
        check(!!root?.querySelector?.(selector) || root?.matches?.(selector), `${key}: ApplicationV2 render`);
        app.controller[modal](); await app.render({ force: true });
        const root2 = app.element?.[0] ?? app.element;
        check(root2?.querySelectorAll?.(".dm-modal-backdrop").length === 1, `${key}: um modal`);
      } finally { await app.close(); }
      check(!app.rendered, `${key}: fechar janela`);
    }
  }
  async function createFixture(role, runId, playerId) {
    const gm = game.user.id;
    return JournalEntry.create({ name: `[DM G5 SMOKE v2] ${role} ${runId.slice(0,8)}`, ownership: { default: 0, [gm]: 3,
      ...(role === "A" && playerId ? { [playerId]: 2 } : {}) }, flags: {
      [MARK]: { kind: "fixture", runnerVersion: 2, role, runId, creator: gm, phase: "building", playerId, pageId },
      [NS]: { schemaVersion: 1, revision: 0, definition: {
        identity: { aliases: [], summary: "Disposable G5 smoke fixture", description: "" },
        classification: { kind: "base", scale: "small", tags: ["g5-smoke-v2"] }, hierarchy: { parentDomainUuid: null },
        capabilities: { enabled: ["domain", "people", "economy", "projects", "facilities", "downtime"].map(x=>`${NS}:${x}`), config: {
          [`${NS}:domain`]: { controllers: role === "A" && playerId ? [playerId] : [] },
          [`${NS}:people`]: { schemaVersion: 1, population: { mode: "manual", total: 30, precision: "exact" },
            populationGroups: [{ id: `pop_${crypto.randomUUID()}`, name: "Workers", count: 30, includedInTotal: true,
              visibility: "public", tags: [], workforceContributions: [{ workforceTypeId: "general", amount: 30 }] }],
            notables: [], roles: [], operationalGroups: [], assignments: [], reservations: [] },
          [`${NS}:economy`]: { schemaVersion: 1, accounts: [] }, [`${NS}:projects`]: { schemaVersion: 1, projects: [] },
          [`${NS}:facilities`]: { schemaVersion: 1, facilities: [] }, [`${NS}:downtime`]: { schemaVersion: 1, activities: [] }
        } }
      }, state: { lifecycle: "active" }, metadata: { createdByUserId: gm, archivedAt: null, source: { type: "manual", ref: null } } }
    } });
  }
  async function setup() {
    const runId = crypto.randomUUID(), playerId = game.users.contents.find(u => u.active && !u.isGM)?.id ?? null;
    const A = await createFixture("A", runId, playerId), B = await createFixture("B", runId, null);
    const s = { ...A.flags[MARK], otherUuid: B.uuid };
    await saveState(A, s);
    for (const [r,n] of [["materials",2000],["supplies",0],["treasury",5000]])
      await call(`Economy: create ${r}`, api.economy.createAccount({ domainUuid: A.uuid, resourceId: `${NS}:${r}`, initialBalanceMinor:n }));
    await call("Economy: treasury +100", api.economy.adjust({ domainUuid:A.uuid, resourceId:`${NS}:treasury`, deltaMinor:100, reason:"G5 smoke" }));
    await call("Economy: independent Domain", api.economy.createAccount({ domainUuid:B.uuid, resourceId:`${NS}:treasury`, initialBalanceMinor:0 }));
    check((await workforce(A)).capacity === 30, "Workforce capacity 30");
    s.projectA = await project(A, "A", 5);
    check((await workforce(A)).reserved === 5, "Project A reservou 5");
    await call("Project A advance 5", api.projects.advanceProject({ domainUuid:A.uuid,projectId:s.projectA,delta:5 }));
    await call("Project A pause", api.projects.pauseProject({ domainUuid:A.uuid,projectId:s.projectA }));
    check((await call("Project A query",api.projects.getProject(A.uuid,s.projectA))).lifecycle === "paused", "Project A paused");
    await call("Project A resume", api.projects.resumeProject({ domainUuid:A.uuid,projectId:s.projectA }));
    await call("Project A advance 15", api.projects.advanceProject({ domainUuid:A.uuid,projectId:s.projectA,delta:15 }));
    await call("Project A complete",api.projects.completeProject({ domainUuid:A.uuid,projectId:s.projectA }));
    check((await workforce(A)).reserved === 0, "Project complete liberou workforce");
    const pb = await project(A,"B",3);
    check((await workforce(A)).reserved === 3,"Project B reservou 3");
    await call("Project B cancel",api.projects.cancelProject({domainUuid:A.uuid,projectId:pb}));
    check((await workforce(A)).reserved === 0,"Project cancel liberou workforce");
    const pc = await project(A,"Incomplete");
    await deny("Projeto incompleto bloqueia conclusão",api.projects.completeProject({domainUuid:A.uuid,projectId:pc}),"DM_PROJECT_INCOMPLETE");
    await call("Cancel incomplete",api.projects.cancelProject({domainUuid:A.uuid,projectId:pc}));
    s.facility = (await call("Workshop create",api.facilities.createFacility({domainUuid:A.uuid,definitionId:`${NS}:basic-workshop`}))).facility.id;
    await call("Workshop damage 20",api.facilities.applyDamage({domainUuid:A.uuid,facilityId:s.facility,damage:20,reason:"Smoke"}));
    await call("Workshop repair 10",api.facilities.repairFacility({domainUuid:A.uuid,facilityId:s.facility,restoreIntegrity:10}));
    await deny("Maintenance sem configuração bloqueada",api.facilities.maintainFacility({domainUuid:A.uuid,facilityId:s.facility}),"DM_FACILITY_MAINTENANCE_NOT_CONFIGURED");
    const guard = (await call("Guard create",api.facilities.createFacility({domainUuid:A.uuid,definitionId:`${NS}:guard-post`}))).facility.id;
    await call("Guard decommission",api.facilities.decommissionFacility({domainUuid:A.uuid,facilityId:guard}));
    check((await call("Guard query",api.facilities.getFacility(A.uuid,guard))).lifecycle === "decommissioned","Facility decommissioned");
    s.crafting = await activity(A,"Crafting",10,`${NS}:crafting`);
    await deny("Participante busy bloqueado",api.downtime.startActivity({domainUuid:A.uuid,definitionId:`${NS}:rest-and-recuperation`,participants:[participant("Crafting")]}),"DM_DOWNTIME_PARTICIPANT_BUSY");
    await call("Crafting pause",api.downtime.pauseActivity({domainUuid:A.uuid,activityId:s.crafting}));
    await call("Crafting resume",api.downtime.resumeActivity({domainUuid:A.uuid,activityId:s.crafting}));
    await call("Crafting advance 10",api.downtime.advanceActivity({domainUuid:A.uuid,activityId:s.crafting,ticks:10}));
    s.indefinite = await activity(A,"Indefinite",null);
    await call("Indefinite advance 100",api.downtime.advanceActivity({domainUuid:A.uuid,activityId:s.indefinite,ticks:100}));
    await verify(A,s); await uiSmoke(A);
    const ledger = await call("Ledger cross-system",api.economy.queryLedger({domainUuid:A.uuid}));
    check(ledger.entries.length >= 6,"Ledger contém atividade dos fluxos",ledger.entries.length);
    requireCleanPhase();
    // Real child effect through CommandBus: reserve four workers, then persist a
    // controlled crash image with no parent/receipt. Stop module writes until F5.
    const holder = await project(A,"Recovery holder",4);
    must((await workforce(A)).reserved === 4,"Recovery: 4 workers reserved");
    const store = txDoc(); must(!!store,"Transaction Journal durável encontrado");
    const snapshot = clone(store.flags[TX_NS]);
    const source = snapshot.records.find(t=>t.recoveryData?.type==="projects:start" && t.recoveryData?.projectId===holder);
    must(!!source?.recoveryData?.steps?.some(step=>step.subsystem==="people"),"Recovery: workforce intent real encontrado");
    s.recoveryTx = source.transactionId; s.phase="await-fence"; s.pageId=pageId;
    s.baseline = { projectA:s.projectA,facility:s.facility,crafting:s.crafting,indefinite:s.indefinite };
    await saveState(A,s);
    const record = clone(A.flags[NS]); record.revision += 1;
    record.definition.capabilities.config[`${NS}:projects`].projects = data(A)[`${NS}:projects`].projects.filter(p=>p.id!==holder);
    await A.update({[`flags.${NS}`]:record});
    source.state="prepared"; source.safeAutoRecovery=false;
    source.history=source.history.filter(h=>!["committing","committed"].includes(h.toState));
    source.recoveryData.steps=source.recoveryData.steps.map(step=>{
      if(step.subsystem!=="people") return step;
      const {receipt, ...intent}=step; return {...intent,state:"executing"};
    });
    snapshot.updatedAt=Date.now(); await store.update({[`flags.${TX_NS}`]:snapshot});
    console.warn("[G5 SMOKE v2] SETUP salvo. Dê F5 REAL e execute este mesmo arquivo no GM. Não execute outras ações do módulo antes do F5.");
  }
  async function fencePhase(A,s) {
    must(s.pageId!==pageId,"F5 real ocorrido antes de verificar recovery fence");
    await verify(A,s);
    await deny("Fence bloqueia escopo afetado",api.projects.startProject({domainUuid:A.uuid,definitionId:`${NS}:survey`,workRequired:1}),"DM_RECOVERY_SCOPE_BLOCKED");
    const B=game.journal.get(s.otherUuid.split('.').pop()); must(!!B,"Domain independente existe");
    await call("Outro Domain continua mutável",api.economy.adjust({domainUuid:B.uuid,resourceId:`${NS}:treasury`,deltaMinor:1,reason:"Fence isolation smoke"}));
    check((await workforce(A)).reserved===4,"Executing ainda preserva reserva antes de recovery");
    const tx=await call("Recovery tx query",api.economy.getTransaction(s.recoveryTx));
    check(tx?.state==="needs-recovery","Startup marcou transaction needs-recovery",tx?.state);
    requireCleanPhase();
    const store=txDoc(), snapshot=clone(store.flags[TX_NS]);
    const record=snapshot.records.find(t=>t.transactionId===s.recoveryTx);
    must(record?.state==="needs-recovery","Crash fixture isolada encontrada");
    record.safeAutoRecovery=true; snapshot.updatedAt=Date.now();
    await saveState(A,{...s,phase:"await-recovery",pageId});
    await store.update({[`flags.${TX_NS}`]:snapshot});
    console.warn("[G5 SMOKE v2] Fence verificada. Dê F5 REAL novamente e execute o mesmo arquivo no GM para verificar a recovery automática.");
  }
  async function recoveredPhase(A,s) {
    must(s.pageId!==pageId,"Segundo F5 real ocorrido");
    const tx=await call("Recovered tx query",api.economy.getTransaction(s.recoveryTx));
    must(tx?.state==="compensated","Executing workforce recuperado",tx?.state);
    check((await workforce(A)).reserved===0,"Recovery restituiu workforce exatamente");
    await verify(A,s);
    const id=await project(A,"After recovery",1,1);
    await call("Após recovery: cancel",api.projects.cancelProject({domainUuid:A.uuid,projectId:id}));
    check((await workforce(A)).reserved===0,"Fence removida e nova mutação liberada");
    requireCleanPhase();
    await saveState(A,{...s,phase:"player-ready",pageId});
    console.warn("[G5 SMOKE v2] GM/reload/recovery concluídos. Mantenha GM online e execute este mesmo arquivo em um Player para testar Socketlib e permissões.");
  }
  async function playerPhase(A,s) {
    must(s.phase==="player-ready","Fases GM e recovery concluídas");
    must(game.users.contents.some(u=>u.active&&u.isGM),"GM online para Socketlib");
    must(data(A)[`${NS}:domain`].controllers.includes(game.user.id),"Player é Controller persistido (rode o GM novamente para atribuir o Player conectado)");
    check(A.ownership[game.user.id]===2,"Controller permanece OBSERVER");
    const id=await project(A,"Remote Player",2,2);
    await call("Player advance via Primary",api.projects.advanceProject({domainUuid:A.uuid,projectId:id,delta:2}));
    await call("Player complete via Primary",api.projects.completeProject({domainUuid:A.uuid,projectId:id}));
    await deny("Player sem controle do outro Domain bloqueado",api.projects.startProject({domainUuid:s.otherUuid,definitionId:`${NS}:survey`,workRequired:1}));
    await deny("Player não pode aplicar dano GM-only",api.facilities.applyDamage({domainUuid:A.uuid,facilityId:s.facility,damage:1,reason:"Permission probe"}));
    check((await workforce(A)).reserved===0,"Player não deixou workforce presa");
    console.log("[G5 SMOKE v2] Player concluído. Confira FAIL=0 em todas as fases; failover com segundo GM continua separado.");
  }
  globalThis.DM_G5_SMOKE_CLEANUP = async () => {
    if(!game.user.isGM) throw new Error("Cleanup somente no GM");
    const docs=fixtures();
    for(const A of docs.filter(d=>d.flags[MARK].role==="A")) {
      const s=A.flags[MARK], tx=s.recoveryTx?await api.economy.getTransaction(s.recoveryTx):null;
      if(tx?.ok&&tx.value&&!["committed","compensated","failed"].includes(tx.value.state))
        throw new Error("Finalize as duas fases F5/recovery antes do cleanup. A fixture ainda está isolada.");
      for(const p of (await api.projects.getProjects(A.uuid)).value??[]) if(!["completed","cancelled","failed"].includes(p.lifecycle))
        await call("Cleanup: cancel project",api.projects.cancelProject({domainUuid:A.uuid,projectId:p.id}));
      for(const a of (await api.downtime.getActivities(A.uuid)).value??[]) if(["inProgress","paused"].includes(a.lifecycle))
        await call("Cleanup: cancel downtime",api.downtime.cancelActivity({domainUuid:A.uuid,activityId:a.id}));
    }
    for(const d of docs) await d.delete();
    console.log("[G5 SMOKE v2] Fixtures próprias removidas; journals globais de ledger/transactions preservados. Dê F5.");
  };
  try {
    must(!!api,"Domain Manager API publicada após bootstrap");
    must(game.modules.get("socketlib")?.active,"Socketlib ativo");
    check(String(game.version).startsWith("13."),"Foundry v13",game.version);
    for(const method of ["allocateWorkforceReservation","releaseWorkforceReservation","restoreWorkforceReservation"])
      check(typeof api.people[method]==="undefined",`People público não expõe ${method}`);
    for(const name of ["commandBus","transactionStore","ledgerStore","reservationStore","workforceReservations"])
      check(api[name]===undefined,`API não expõe ${name} mutável`);
    let A=getA();
    if(!A) { must(isGM,"Primeira fase precisa de GM"); await setup(); }
    else {
      const s=A.flags[MARK];
      if(!isGM) await playerPhase(A,s);
      else if(s.phase==="await-fence") await fencePhase(A,s);
      else if(s.phase==="await-recovery") await recoveredPhase(A,s);
      else if(s.phase==="player-ready") {
        await verify(A,s);
        const player=game.users.contents.find(u=>u.active&&!u.isGM);
        if(player&&!data(A)[`${NS}:domain`].controllers.includes(player.id)) {
          const r=clone(A.flags[NS]); r.revision+=1; r.definition.capabilities.config[`${NS}:domain`].controllers.push(player.id);
          await A.update({[`flags.${NS}`]:r,[`ownership.${player.id}`]:2});
        }
        if(!player) add("SKIP","Player remoto","Conecte um Player e execute novamente no GM para atribuí-lo.");
        else console.warn(`[G5 SMOKE v2] Rode o mesmo arquivo como ${player.name}, mantendo o GM online.`);
        add("SKIP","Failover físico de segundo GM","Não é simulado: requer dois clientes GM e desconexão/troca real de autoridade.");
      } else throw new Error("Fixture parcial. Execute await DM_G5_SMOKE_CLEANUP(), F5 e recomece.");
    }
  } catch(error) { add("FAIL","Smoke exception",error?.stack??error); }
  finally {
    const report={runnerVersion:2,at:new Date().toISOString(),user:game.user?.id,phase:getA()?.flags[MARK]?.phase??"none",rows,
      pass:rows.filter(r=>r.status==="PASS").length,fail:rows.filter(r=>r.status==="FAIL").length,skip:rows.filter(r=>r.status==="SKIP").length};
    globalThis.DM_G5_SMOKE_REPORT=report;
    console.table(rows); console.log(`[G5 SMOKE v2] PASS ${report.pass} / FAIL ${report.fail} / SKIP ${report.skip}`);
    ui?.notifications?.[report.fail?"error":"info"]?.(`G5 Smoke v2: ${report.pass} PASS / ${report.fail} FAIL / ${report.skip} SKIP`);
  }
})();
