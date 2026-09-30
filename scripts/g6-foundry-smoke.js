/**
 * G6 Foundry v13 — roteiro com fases persistidas. Cole inteiro no console.
 * Use um mundo de testes com socketlib, um GM e um Player conectado.
 * GM cria fixtures; Player executa; GM aprova/rejeita; F5; troca de Primary GM.
 * Não altera Domains existentes. A recuperação simula queda APENAS no tratado
 * criado por este roteiro, usando seu before-image/intent econômico real.
 * Relatório: DM_G6_SMOKE_REPORT. Download: DM_G6_SMOKE.download().
 */
(async () => {
  const NS = "domain-manager", MARK = "domain-manager-g6-smoke-v2";
  const ENTITY = "domain-manager-diplomacy", TX = "domain-manager-transactions";
  const rawApi = game.modules.get(NS)?.api, gm = !!game.user?.isGM;
  // Pace the runner below the kernel's 50 requests/second limit.
  const paced = (target, name) => async (...args) => { await new Promise(resolve => setTimeout(resolve, 50)); return target[name](...args); };
  const raw = rawApi?.diplomacy;
  const d = raw ? Object.freeze({ ...Object.fromEntries(["relations", "reputation", "agreements", "territory", "disputes", "proposals"].map(owner =>
    [owner, Object.freeze(Object.fromEntries(Object.keys(raw[owner]).map(name => [name, paced(raw[owner], name)])))])),
    open: paced(raw, "open"), previewTerritory: paced(raw, "previewTerritory"), capabilities: paced(raw, "capabilities") }) : null;
  const api = rawApi ? { ...rawApi, economy: Object.fromEntries(["createAccount", "getAccount"].map(name => [name, paced(rawApi.economy, name)])) } : null;
  const page = globalThis.DM_G6_SMOKE_PAGE_ID ??= crypto.randomUUID();
  const rows = [], clone = x => JSON.parse(JSON.stringify(x));
  const stable = x => JSON.stringify(x, function (_key, value) {
    return value && typeof value === "object" && !Array.isArray(value)
      ? Object.fromEntries(Object.keys(value).sort().map(k => [k, value[k]])) : value;
  });
  const assert = (condition, detail) => { if (!condition) throw Error(detail); };
  const check = async (name, fn) => {
    try { await fn(); rows.push({ status: "PASS", teste: name }); return true; }
    catch (e) { rows.push({ status: "FAIL", teste: name, detalhe: e?.message ?? String(e) }); return false; }
  };
  const pending = (name, detail) => rows.push({ status: "PENDING", teste: name, detalhe: detail });
  const unwrap = r => { assert(r?.ok, `${r?.error?.code ?? "NO_RESULT"}: ${r?.error?.message ?? "Resposta ausente"}`); return r.value; };
  const call = async promise => unwrap(await promise);
  const deny = async (promise, code) => { const r = await promise; assert(r && !r.ok && (!code || r.error.code === code), `Esperada rejeição ${code ?? "sem efeito"}; recebido ${JSON.stringify(r)}`); };
  const clean = () => assert(!rows.some(r => r.status === "FAIL"), "Há FAIL nesta fase; progresso não será avançado.");
  const authority = () => { const raw = game.settings.get(NS, "primaryAuthorityState"); return typeof raw === "string" ? JSON.parse(raw) : raw; };
  const rpc = (name, ...args) => {
    const socket = globalThis.socketlib?.modules?.get(NS);
    assert(socket && typeof socket.executeAsUser === "function", "Socketlib do módulo indisponível");
    return socket.executeAsUser(name, authority().authorityUserId, ...args);
  };
  const fixture = () => game.journal.contents.find(j => j.flags?.[MARK]?.runnerVersion === 2);
  let doc = fixture(), s = doc ? clone(doc.flags[MARK]) : null;
  const save = async () => { await doc.update({ [`flags.${MARK}`]: clone(s) }); };
  const detail = (owner, id, extra = {}) => call(d[owner].query({ id, ...extra }));
  const modify = async (owner, id, action, reason = "G6 smoke") => {
    const current = await detail(owner, id);
    return call(d[owner].modify({ id, expectedRevision: current.revision, action, reason }));
  };
  const base = (label, visibility = "public") => ({ schemaVersion: 1, revision: 0, label, visibility, createdAt: 0, updatedAt: 0 });
  const parties = () => [{ type: "domain", uuid: doc.uuid }, { type: "narrative", id: `g6-guild-${s.runId}` }];
  const relation = (id, visibility) => ({ definition: { id: "g6-smoke:relation", version: 1, label: "Smoke trust", symmetry: "symmetric", minParties: 2,
    maxParties: null, allowedPartyTypes: ["domain", "narrative"], allowedPartyRoles: ["partner"], allowMultiple: true, stancePolicy: "derived",
    axes: [{ id: "g6-smoke:trust", label: "Trust", minimum: -100, maximum: 100, defaultValue: 0 }] }, state: { relation: {
      ...base(`[G6 SMOKE] ${visibility} ${s.runId}`, visibility), id, definitionId: "g6-smoke:relation", definitionVersion: 1, lifecycle: "active", scope: null,
      parties: parties().map((ref, i) => ({ id: `p${i}`, role: "partner", ref })), baseAxes: [{ axisId: "g6-smoke:trust", value: 20, fromPartyId: null, toPartyId: null }], endedAt: null }, modifiers: [], events: [] } });
  const incident = amount => ({ kind: "incident", deltas: [{ axisId: "g6-smoke:trust", value: amount, fromPartyId: null, toPartyId: null }] });
  const territory = (id, label) => ({ territory: { ...base(label), uuid: id, kind: "domain-manager:region", scale: "region", locatedInUuid: null,
    administrativeParentUuid: null, geography: {}, hierarchyHistory: [] }, claims: [], recognitions: [], presence: [], influence: [], rights: [], links: [], occupations: [], events: [] });
  const source = (id, visibility = "public") => ({ id, sourceRef: { type: "manual", id: `g6-smoke-${s.runId}` }, visibility, startsAtWorldTick: 0, expiresAtWorldTick: null });
  const claim = (id, who) => ({ ...source(id), claimantRef: who, claimType: "domain-manager:ownership", lifecycle: "active", contested: false, strength: null, inherited: false });
  const score = x => x.scores.find(a => a.axisId === "g6-smoke:trust")?.effective;
  const balance = async () => (await call(api.economy.getAccount(doc.uuid, "domain-manager:treasury"))).balanceMinor;
  const treaty = id => ({ definition: { id: "g6-smoke:treaty", version: 1, label: "Smoke Treaty", minParties: 2, maxParties: null,
    allowedPartyRoles: ["signatory"], allowedTermTypes: ["domain-manager:narrative", "domain-manager:capability", "domain-manager:obligation", "domain-manager:owner-operation"],
    amendmentRequiresApproval: true, automaticRenewalAllowed: false, effectiveLifecycles: ["active", "breached"] }, state: { agreement: {
      ...base(`[G6 SMOKE] Treaty ${id}`), id, definitionId: "g6-smoke:treaty", definitionVersion: 1, lifecycle: "draft", parties: parties().map((ref, i) => ({ id: `p${i}`, role: "signatory", ref })),
      terms: [], duration: { startsAtWorldTick: null, expiresAtWorldTick: null }, proposals: [], amendments: [], events: [], supersedesId: null }, obligations: [] }, executedOperations: [] });
  const payment = id => ({ id, ownerId: "domain-manager:economy", operation: "economy:adjust", targetRefs: [{ type: "domain", uuid: doc.uuid }],
    payload: { domainUuid: doc.uuid, resourceId: "domain-manager:treasury", deltaMinor: 7, reason: "G6 fixture payment" } });
  const term = (id, type, payload, visibility = "public") => ({ id, type: `domain-manager:${type}`, title: id, text: null, visibility, partyIds: ["p0", "p1"], payload });
  async function negotiate(id, terms) {
    await call(d.agreements.create({ id, data: treaty(id), reason: "G6 fixture" }));
    await modify("agreements", id, { kind: "propose", proposalId: "offer", partyId: "p0", terms,
      duration: { startsAtWorldTick: null, expiresAtWorldTick: null }, proposalExpiresAtWorldTick: null });
    await deny(d.agreements.modify({ id, expectedRevision: (await detail("agreements", id)).revision,
      action: { kind: "activate", proposalId: "offer", expectedProposalRevision: 0, amendmentId: "early" }, reason: "G6 incomplete acceptance" }));
    for (const partyId of ["p0", "p1"]) { const a = await detail("agreements", id); await modify("agreements", id,
      { kind: "accept", proposalId: "offer", expectedProposalRevision: a.proposals[0].revision, partyId }); }
    await modify("agreements", id, { kind: "activate", proposalId: "offer", expectedProposalRevision: 2, amendmentId: "activation" });
  }
  async function ui() {
    const app = await d.open();
    try {
      assert(app.rendered, "ApplicationV2 não renderizou");
      for (const tab of ["relations", "reputation", "agreements", "territory", "disputes", "proposals"]) {
        app.controller.selectTab(tab); unwrap(await app.controller.load()); await app.render({ force: true });
        const root = app.element?.[0] ?? app.element;
        assert(root?.querySelector?.("[data-dm-tab]"), `DOM ausente na aba ${tab}`);
      }
      app.controller.selectTab("relations"); app.controller.select(s.relation); unwrap(await app.controller.load()); await app.render({ force: true });
      assert(app.controller.detail?.id === s.relation, "Inspetor não carregou fixture");
    } finally { await app.close(); }
    assert(!app.rendered, "Janela não fechou");
  }
  async function common() {
    await check("API G6 publicada e sem persistência interna", async () => {
      assert(raw && Object.isFrozen(raw) && typeof raw.open === "function", "Instale o ZIP candidato G6 e aguarde ready");
      assert(!raw.store && !raw.adapter && !api.commandBus && !api.transactionStore, "Internals expostos");
    });
    if (!d) return;
    for (const owner of ["relations", "reputation", "agreements", "territory", "disputes", "proposals"]) await check(`Consulta paginada: ${owner}`, async () => {
      const value = await call(d[owner].query({ limit: 5 }));
      assert(Array.isArray(value.items) && value.items.length <= 5, "Paginação inválida");
      assert(!value.items.some(x => x.data || x.receipts || x.definition), "Estado canônico na lista");
    });
    await check(gm ? "Journals canônicos privados" : "Player sem flags canônicas no payload", async () => {
      for (const j of game.journal.contents) {
        const e = j.flags?.[ENTITY], tx = j.flags?.[TX]; if (!e && !tx) continue;
        if (!gm) assert(!e?.data && !Array.isArray(tx?.records), "Estado canônico chegou ao Player; G6 NÃO pode ser homologado");
        else for (const user of game.users.contents.filter(u => !u.isGM))
          assert(!j.testUserPermission(user, CONST.DOCUMENT_OWNERSHIP_LEVELS.LIMITED), `Journal privado acessível: ${j.id}`);
      }
    });
  }
  async function setup() {
    const player = game.users.contents.find(u => u.active && !u.isGM);
    assert(player, "Conecte um Player antes de iniciar");
    s = { runnerVersion: 2, runId: crypto.randomUUID(), phase: "building", page, creator: game.user.id, playerId: player.id,
      relation: `rel_${crypto.randomUUID()}`, secretRelation: `rel_${crypto.randomUUID()}`, reputation: `rep_${crypto.randomUUID()}`,
      agreement: crypto.randomUUID(), recoveryAgreement: crypto.randomUUID(), dispute: crypto.randomUUID(),
      root: `JournalEntry.${crypto.randomUUID().replaceAll("-", "").slice(0, 16)}`, child: `JournalEntry.${crypto.randomUUID().replaceAll("-", "").slice(0, 16)}`,
      privateClaimTerritory: `JournalEntry.${crypto.randomUUID().replaceAll("-", "").slice(0, 16)}`, privateClaimDispute: crypto.randomUUID(),
      proposalApprove: crypto.randomUUID(), proposalReject: crypto.randomUUID(), expectedTrust: 25, expectedRevision: 3 };
    doc = await JournalEntry.create({ name: `[DM G6 SMOKE] ${s.runId}`, ownership: { default: 0, [player.id]: 2 }, flags: { [MARK]: clone(s),
      [NS]: { schemaVersion: 1, revision: 0, definition: { identity: { aliases: [], summary: "G6 disposable fixture", description: "" },
        classification: { kind: "base", scale: "small", tags: ["g6-smoke"] }, hierarchy: { parentDomainUuid: null },
        capabilities: { enabled: ["domain-manager:domain", "domain-manager:economy"], config: {
          "domain-manager:domain": { controllers: [player.id] }, "domain-manager:economy": { schemaVersion: 1, accounts: [] } } } },
        state: { lifecycle: "active" }, metadata: { createdByUserId: game.user.id, archivedAt: null, source: { type: "manual", ref: null } } } } });
    assert(doc, "Falha ao criar Domain de teste"); await save();
    await call(api.economy.createAccount({ domainUuid: doc.uuid, resourceId: "domain-manager:treasury", initialBalanceMinor: 0 }));
    await check("Relação: base, incidente, histórico e revisão", async () => {
      await call(d.relations.create({ id: s.relation, data: relation(s.relation, "public"), reason: "G6 fixture" }));
      await call(d.relations.create({ id: s.secretRelation, data: relation(s.secretRelation, "secret"), reason: "G6 fixture" }));
      await modify("relations", s.relation, incident(5));
      assert(score(await detail("relations", s.relation)) === 25, "Incidente não alterou base");
      const m = { id: "secret-modifier", axisId: "g6-smoke:trust", value: 60, fromPartyId: null, toPartyId: null,
        source: { type: "incident", id: "G6_PRIVATE_SENTINEL" }, visibility: "secret", lifecycle: "active", createdAt: 0,
        expiresAt: null, expiresAtWorldTick: null, stackKey: "g6-smoke:temporary", stacking: "add" };
      await modify("relations", s.relation, { kind: "modifier", value: m });
      assert(score(await detail("relations", s.relation)) === 85, "GM não vê modificador secreto");
      await modify("relations", s.relation, { kind: "end-modifier", id: m.id });
      assert(score(await detail("relations", s.relation)) === 25, "Fim de modificador não preservou base");
      await deny(d.relations.modify({ id: s.relation, expectedRevision: 0, action: incident(1), reason: "G6 stale" }));
      const history = await detail("relations", s.relation, { historyLimit: 1 }); assert(history.history.length === 1, "Histórico não paginado");
    });
    await check("Regressão G2: guardar recibo de consulta secreta do GM", async () => {
      s.privateReceiptCommand = unwrap(raw.commands.prepare("relations:query", { id: s.secretRelation }));
      const receipt = unwrap(await raw.commands.execute(s.privateReceiptCommand));
      assert(receipt.status === "executed" && receipt.result?.id === s.secretRelation, `Consulta secreta do GM não executada: ${JSON.stringify(receipt)}`);
      const status = unwrap(await raw.commands.status(s.privateReceiptCommand.commandId));
      assert(status.status === "executed" && status.result?.id === s.secretRelation, "Recibo próprio do GM não encontrado");
    });
    await check("Reputação: ajuste e banda pública independente", async () => {
      const data = { definitions: [{ id: "g6-smoke:standing", version: 1, label: "Standing", minimum: -100, maximum: 100, baseline: 0,
        visibility: "public", publicPresentation: "band", bands: [{ id: "g6-smoke:low", label: "Low", minimum: -100, maximum: -1 },
          { id: "g6-smoke:neutral", label: "Neutral", minimum: 0, maximum: 0 }, { id: "g6-smoke:high", label: "High", minimum: 1, maximum: 100 }], decay: null }],
        record: { ...base(`[G6 SMOKE] Reputation ${s.runId}`), id: s.reputation, subjectRef: parties()[0], audienceRef: parties()[1], entries: [],
          tracks: [{ definitionId: "g6-smoke:standing", definitionVersion: 1, score: 0, initialScore: 0, lastDecayWorldTick: null }] } };
      await call(d.reputation.create({ id: s.reputation, data, reason: "G6 fixture" }));
      await modify("reputation", s.reputation, { kind: "adjust", trackId: "g6-smoke:standing", delta: 10 });
      assert((await detail("reputation", s.reputation)).tracks[0].score === 10, "Reputação não ajustada");
      assert(score(await detail("relations", s.relation)) === 25, "Reputação alterou relação");
    });
    await check("Território: preview, eixos independentes e ciclo rejeitado", async () => {
      for (const [id, label] of [[s.root, "Root"], [s.child, "Child"]]) await call(d.territory.create({ id, data: territory(id, `[G6 SMOKE] ${label} ${s.runId}`), reason: "G6 fixture" }));
      const action = { kind: "reparent", parents: { locatedInUuid: s.root, administrativeParentUuid: null } };
      await call(d.previewTerritory({ id: s.child, expectedRevision: 0, action, reason: "G6 preview" }));
      assert((await detail("territory", s.child)).territory.locatedInUuid === null, "Preview escreveu estado");
      await modify("territory", s.child, action);
      assert((await call(d.territory.query({ parentUuid: s.root }))).items.some(x => x.id === s.child), "Filho físico ausente");
      assert((await call(d.territory.query({ parentUuid: s.root, treeAxis: "administrativeParentUuid" }))).total === 0, "Árvore administrativa copiou física");
      await deny(d.territory.modify({ id: s.root, expectedRevision: 0, action: { kind: "reparent", parents: { locatedInUuid: s.child, administrativeParentUuid: null } }, reason: "G6 cycle" }));
    });
    await check("Transferência em lote preserva reivindicações concorrentes", async () => {
      for (const id of [s.root, s.child]) for (const [cid, who] of [["old", parties()[0]], ["competitor", parties()[1]]])
        await modify("territory", id, { kind: "claim", value: claim(cid, who) });
      const targets = []; for (const id of [s.root, s.child]) targets.push({ territoryUuid: id, expectedRevision: (await detail("territory", id)).revision,
        supersedeClaimIds: ["old"], newClaim: { ...claim("buyer", { type: "narrative", id: "g6-buyer" }), startsAtWorldTick: Math.max(0, Math.floor(game.time.worldTime)) } });
      await modify("territory", s.root, { kind: "transfer", targets });
      for (const id of [s.root, s.child]) { const t = await detail("territory", id);
        assert(t.claims.find(c => c.id === "old").lifecycle === "superseded" && t.claims.find(c => c.id === "competitor").lifecycle === "active", "Transferência apagou concorrente"); }
    });
    await check("Direitos: proveniência, herança, escopo e condição não resolvida", async () => {
      for (const [id, conditionRefs, grants] of [["visible", [], ["g6-smoke:entry"]], ["conditional", [{ type: "condition", id: "unresolved" }], ["g6-smoke:conditional"]]])
        await modify("territory", s.root, { kind: "right", value: { ...source(id), beneficiaryRef: parties()[0], rightType: "domain-manager:entry",
          inherited: true, revocable: true, active: true, conditionRefs, grants } });
      const scoped = JSON.stringify(await call(d.capabilities(doc.uuid, s.child)));
      assert(scoped.includes("g6-smoke:entry") && scoped.includes("territory-right") && !scoped.includes("g6-smoke:conditional"), "Direito/herança/condição incorretos");
      assert(!JSON.stringify(await call(d.capabilities(doc.uuid))).includes("g6-smoke:entry"), "Direito vazou escopo territorial");
    });
    await check("Disputa: decisão explícita sem transferir propriedade", async () => {
      await call(d.disputes.create({ id: s.dispute, data: { ...base(`[G6 SMOKE] Dispute ${s.runId}`), id: s.dispute, disputeType: "domain-manager:ownership",
        territoryUuids: [s.root, s.child], parties: parties(), claimRefs: [], lifecycle: "latent", events: [] }, reason: "G6 fixture" }));
      await modify("disputes", s.dispute, { kind: "decide", lifecycle: "settled", outcomeRef: { type: "manual-outcome", id: "g6-settlement" } });
      assert((await detail("disputes", s.dispute)).lifecycle === "settled", "Disputa não resolvida");
      assert((await detail("territory", s.root)).claims.find(c => c.id === "competitor").lifecycle === "active", "Disputa concedeu propriedade automaticamente");
    });
    await check("Tratado: unanimidade, obrigação vencida e pagamento sem repetição", async () => {
      await negotiate(s.agreement, [term("payment", "owner-operation", { operations: [payment("pay")] }), term("access", "capability", {
        beneficiaryPartyId: "p0", capabilityIds: ["g6-smoke:treaty"], scopeRef: null, conditionRefs: [] }),
        term("due", "obligation", { kind: "domain-manager:payment", obligatedPartyId: "p0", beneficiaryPartyId: "p1", dueAtWorldTick: 0, graceTicks: 0,
          overduePolicy: "report", requirementRef: { type: "resource", id: "domain-manager:treasury" }, consequences: [] })]);
      assert(await balance() === 7, "Pagamento não aplicado uma vez");
      await modify("agreements", s.agreement, { kind: "suspend" }); await modify("agreements", s.agreement, { kind: "resume" });
      assert(await balance() === 7, "Resume repetiu pagamento");
      const a = await detail("agreements", s.agreement); assert(a.lifecycle === "active" && a.obligations[0].lifecycle !== "breached", "Vencimento decidiu quebra automaticamente");
      assert(JSON.stringify(await call(d.capabilities(doc.uuid))).includes("g6-smoke:treaty"), "Grant do tratado ausente");
      await negotiate(s.recoveryAgreement, [term("recovery-pay", "owner-operation", { operations: [payment("recovery-pay")] })]);
      assert(await balance() === 14, "Pagamento da fixture recovery incorreto");
    });
    await check("Regressão: tratado novo rejeita recibos de efeitos inventados", async () => {
      const id = crypto.randomUUID();
      await deny(d.agreements.create({ id, data: { ...treaty(id), executedOperations: ["forged-receipt"] }, reason: "Invalid fixture" }), "DM_AGREEMENT_CREATE_INVALID");
      await deny(d.agreements.query({ id }), "DM_DIPLOMACY_NOT_FOUND");
    });
    await check("Regressão: preparar claim restrito com audiência independente da disputa", async () => {
      const data = territory(s.privateClaimTerritory, `[G6 SMOKE] claim privacy ${s.runId}`);
      data.claims = [{ ...claim("G6_RESTRICTED_CLAIM_SENTINEL", parties()[1]), visibility: "restricted" }];
      await call(d.territory.create({ id: s.privateClaimTerritory, data, reason: "Claim privacy fixture" }));
      await call(d.disputes.create({ id: s.privateClaimDispute, data: { ...base("Claim privacy dispute", "restricted"), id: s.privateClaimDispute,
        disputeType: "domain-manager:ownership", territoryUuids: [s.privateClaimTerritory], parties: parties(),
        claimRefs: [{ territoryUuid: s.privateClaimTerritory, claimId: "G6_RESTRICTED_CLAIM_SENTINEL" }], lifecycle: "latent", events: [] }, reason: "Claim privacy fixture" }));
    });
    await check("ApplicationV2: seis abas, inspetor e fechamento", ui);
    clean(); s.phase = "await-player"; await save();
  }
  async function player() {
    assert(doc && s.phase !== "building", "GM precisa concluir setup primeiro");
    assert(game.user.id === s.playerId, `Execute como Player controlador ${s.playerId}`);
    await check("Player: segredo não aparece em detalhe ou lista", async () => {
      await deny(d.relations.query({ id: s.secretRelation }), "DM_DIPLOMACY_NOT_FOUND");
      const list = await call(d.relations.query({ search: s.runId, limit: 100 })); assert(!list.items.some(x => x.id === s.secretRelation), "Segredo listado");
      const a = await detail("relations", s.relation); assert(score(a) === s.expectedTrust && !JSON.stringify(a).includes("G6_PRIVATE_SENTINEL"), "Score ou histórico secreto exposto");
    });
    await check("Player: sem mutação direta nem revisão de GM", async () => {
      await deny(d.relations.modify({ id: s.relation, expectedRevision: s.expectedRevision, action: incident(99), reason: "G6 Player direct" }), "DM_SECURITY_PERMISSION_DENIED");
      await deny(d.proposals.decide({ id: s.proposalApprove, expectedRevision: 0, decision: "approve", reason: "G6 Player forged review" }), "DM_SECURITY_PERMISSION_DENIED");
    });
    await check("Regressão G2 Player: replay e status não revelam recibo do GM", async () => {
      const status = await rpc("queryCommandStatus", s.privateReceiptCommand.commandId, s.creator);
      assert(status && !status.ok && !JSON.stringify(status).includes(`[G6 SMOKE] secret`), "Status de outro usuário vazou");
      const replay = unwrap(await rpc("executeCommand", { protocol: "dm-command-v1", kind: "DM_CMD_REQUEST",
        correlationId: `corr_${crypto.randomUUID()}`, command: s.privateReceiptCommand, declaredSenderUserId: game.user.id }));
      assert(replay.status === "rejected" && !JSON.stringify(replay).includes(`[G6 SMOKE] secret`), "Replay devolveu a consulta secreta do GM");
    });
    await check("Player: reputação publica banda sem score canônico", async () => {
      const rep = await detail("reputation", s.reputation); assert(rep.tracks?.[0]?.band === "High", "Banda pública ausente");
      assert(!JSON.stringify(rep).includes('"score"') && !rep.entries, "Score/histórico de reputação exposto");
    });
    await check("Regressão Player: participar da disputa não revela claim territorial restrito", async () => {
      assert((await detail("territory", s.privateClaimTerritory)).claims.length === 0, "Claim restrito apareceu no território");
      const dispute = await detail("disputes", s.privateClaimDispute);
      assert(dispute.claimRefs.length === 0 && !JSON.stringify(dispute).includes("G6_RESTRICTED_CLAIM_SENTINEL"), "Claim vazou pela disputa");
    });
    await check("Player: propostas duráveis sem alteração canônica", async () => {
      if (s.phase === "await-player") for (const id of [s.proposalApprove, s.proposalReject]) {
        const found = await d.proposals.query({ id }); if (found.ok) continue;
        assert(found.error.code === "DM_DIPLOMACY_NOT_FOUND", found.error.message);
        await call(d.proposals.submit({ id, intent: { kind: "relation", mode: "modify", id: s.relation, expectedRevision: s.expectedRevision, action: incident(5), reason: "G6 Player proposal" } }));
      }
      const p = await detail("proposals", s.proposalApprove); assert(p.original.action.deltas[0].value === 5, "Original alterado");
      assert(score(await detail("relations", s.relation)) === s.expectedTrust, "Proposta alterou estado fora da decisão de GM");
      if (s.phase !== "await-player") assert(p.lifecycle === "approved" && (await detail("proposals", s.proposalReject)).lifecycle === "rejected", "Decisões não persistiram");
    });
    await check("Player: UI e inspetor", ui);
    if (s.phase !== "completed") pending("Continuação GM", s.phase === "await-player" ? "Execute o mesmo script no GM para revisar as propostas." : "Relatório Player pronto; execute o GM conforme a fase registrada.");
  }
  async function prepareRecovery() {
    assert(authority()?.authorityUserId === game.user.id, "Prepare recovery no Primary GM atual");
    const journal = game.journal.contents.find(j => j.flags?.[ENTITY]?.id === s.recoveryAgreement);
    const txDoc = game.journal.contents.find(j => Array.isArray(j.flags?.[TX]?.records));
    assert(journal && txDoc, "Fixture ou Transaction Journal ausente");
    const snap = clone(txDoc.flags[TX]);
    const tx = snap.records.find(t => t.state === "committed" && t.recoveryData?.type === "diplomacy:write"
      && t.recoveryData.effects?.length && t.recoveryData.writes?.some(w => w.after.id === s.recoveryAgreement));
    assert(tx, "Intent econômico durável real não encontrado");
    const write = tx.recoveryData.writes.find(w => w.after.id === s.recoveryAgreement);
    assert(write.before && stable(journal.flags[ENTITY]) === stable(write.after), "Fixture mudou depois do intent; abortando injeção");
    s.recoveryTx = tx.transactionId; s.phase = "injecting-recovery"; s.page = page; s.authorityBefore = clone(authority()); await save();
    // Put the fence intent first, then restore only this fixture's before-image.
    tx.state = "prepared"; tx.safeAutoRecovery = true;
    tx.history = tx.history.filter(h => !["committing", "committed"].includes(h.toState));
    tx.recoveryData.steps = tx.recoveryData.steps.map(step => { const { receipt, ...intent } = step; return { ...intent, state: "executing" }; });
    snap.updatedAt = Date.now(); await txDoc.update({ [`flags.${TX}`]: snap });
    await journal.update({ [`flags.${ENTITY}`]: write.before });
    s.phase = "await-reload"; await save();
  }
  async function verify() {
    assert(score(await detail("relations", s.relation)) === s.expectedTrust, "Incidente não persistiu");
    assert((await detail("relations", s.relation)).revision === s.expectedRevision, "Revisão duplicada/perdida");
    assert((await detail("agreements", s.agreement)).lifecycle === "active", "Tratado não persistiu");
    assert((await detail("agreements", s.recoveryAgreement)).lifecycle === "active", "Recovery não concluiu before-image");
    assert(await balance() === 14, "Recovery/reload repetiu efeito econômico");
    const t = await detail("territory", s.child); assert(t.territory.locatedInUuid === s.root && t.claims.find(c => c.id === "competitor").lifecycle === "active", "Árvore/claims não persistiram");
    assert((await detail("proposals", s.proposalApprove)).original.action.deltas[0].value === 5, "Original de proposta não persistiu");
    const snap = game.journal.contents.find(j => Array.isArray(j.flags?.[TX]?.records))?.flags[TX];
    assert(snap?.records.find(t => t.transactionId === s.recoveryTx)?.state === "committed", "Recovery não finalizou transação");
  }
  async function gmPhase() {
    if (!s) { await setup(); pending("Player real", "Execute este arquivo no Player controlador, depois no Primary GM."); }
    else if (s.phase === "injecting-recovery") throw Error("Injeção interrompida: preserve os Journals e o relatório para diagnóstico; esta execução não valida recovery.");
    else if (s.phase === "building") throw Error("Setup parcial: veja os FAIL. Preserve fixtures para diagnóstico; não avance a homologação.");
    else if (s.phase === "await-player") {
      const a = await d.proposals.query({ id: s.proposalApprove }), b = await d.proposals.query({ id: s.proposalReject });
      if (!a.ok || !b.ok) { pending("Player real", "Aguardando as duas propostas: execute este arquivo no Player controlador."); return; }
      await check("GM: edição auditada, aprovação e rejeição", async () => {
        if (a.value.lifecycle === "pending") await call(d.proposals.decide({ id: s.proposalApprove, expectedRevision: 0, decision: "approve", reason: "G6 GM edit +2",
          editedIntent: { ...a.value.original, action: incident(2) } }));
        if (b.value.lifecycle === "pending") await call(d.proposals.decide({ id: s.proposalReject, expectedRevision: 0, decision: "reject", reason: "G6 GM reject" }));
        assert((await detail("proposals", s.proposalApprove)).original.action.deltas[0].value === 5, "GM sobrescreveu original");
        assert(score(await detail("relations", s.relation)) === 27, "Aprovação editada/rejeição alterou score incorreto");
        s.expectedTrust = 27; s.expectedRevision = 4; await save();
      });
      clean(); await check("Fixture de recovery: intent real com recibo econômico perdido", prepareRecovery);
      pending("F5 real obrigatório", "Pare as ações do módulo, dê F5 no Primary GM e execute este mesmo arquivo.");
    } else if (s.phase === "await-reload") {
      assert(s.page !== page, "Dê F5 real antes de continuar; repetir na mesma página não valida recarga");
      await check("F5: estado, propostas, transação recuperada e pagamento uma vez", verify); clean();
      await check("F5: mutação pela autoridade após recovery", async () => {
        await modify("relations", s.relation, incident(1)); s.expectedTrust++; s.expectedRevision++; await save();
        assert(score(await detail("relations", s.relation)) === s.expectedTrust, "Mutação pós-recovery falhou");
      });
      clean(); s.phase = "await-failover"; s.authorityBefore = clone(authority()); await save();
      pending("Troca de Primary GM", "Conecte outro GM, altere Primary GM preferido nas configurações do módulo e execute este arquivo no novo Primary GM.");
    } else if (s.phase === "await-failover") {
      const now = authority();
      if (now.authorityUserId === s.authorityBefore.authorityUserId) { pending("Troca de Primary GM", "A autoridade ainda é a anterior; conecte outro GM e troque o preferido."); return; }
      assert(now.authorityUserId === game.user.id && now.authorityEpoch > s.authorityBefore.authorityEpoch, "Execute no novo Primary GM após avançar epoch");
      await check("Failover: estado reidratado e efeito econômico uma vez", verify); clean();
      await check("Failover: nova autoridade confirma mutação", async () => {
        await modify("relations", s.relation, incident(1)); s.expectedTrust++; s.expectedRevision++; await save();
        assert(score(await detail("relations", s.relation)) === s.expectedTrust && await balance() === 14, "Nova autoridade duplicou/perdeu efeito");
      });
      await check("Failover: UI renderiza", ui); clean(); s.phase = "completed"; await save();
      pending("Player após decisões e failover", "Execute novamente no Player e baixe ambos os relatórios. A conclusão exige ausência de FAIL em todas as fases.");
    } else if (s.phase === "completed") {
      await check("Revalidação final GM", verify); await check("UI final GM", ui);
    } else throw Error(`Fase desconhecida: ${s.phase}`);
  }
  try { await common(); clean(); if (d) { if (gm) await gmPhase(); else await player(); } }
  catch (e) { rows.push({ status: "FAIL", teste: "Fase interrompida", detalhe: e?.message ?? String(e) }); }
  const key = `DM_G6_SMOKE:${game.world?.id ?? "world"}:${game.user.id}`;
  let past = []; try { past = JSON.parse(localStorage.getItem(key) ?? "[]"); } catch { /* fresh browser */ }
  const report = { runnerVersion: 2, runId: s?.runId ?? null, userId: game.user.id, role: gm ? "GM" : "Player", phase: s?.phase ?? "preflight",
    page, timestamp: new Date().toISOString(), foundry: game.version, module: api?.version, authority: d ? authority() : null, rows };
  past.push(report); try { localStorage.setItem(key, JSON.stringify(past)); } catch { console.warn("Exporte o relatório antes de F5: localStorage indisponível."); }
  globalThis.DM_G6_SMOKE_REPORT = report;
  globalThis.DM_G6_SMOKE = Object.freeze({ reports: past, download() {
    const url = URL.createObjectURL(new Blob([JSON.stringify(past, null, 2)], { type: "application/json" }));
    const a = document.createElement("a"); a.href = url; a.download = `g6-foundry-smoke-${game.user.id}.json`; a.click(); URL.revokeObjectURL(url);
  } });
  console.table(rows);
  console.info(`[G6 SMOKE] ${report.role}; fase=${report.phase}; ${rows.filter(r => r.status === "PASS").length} PASS; ${rows.filter(r => r.status === "FAIL").length} FAIL; ${rows.filter(r => r.status === "PENDING").length} PENDING.`);
  console.info("Relatórios acumulados: DM_G6_SMOKE.reports. Download: DM_G6_SMOKE.download(). PASS local não significa G6 homologado.");
  return report;
})();
