# 32 — UI / UX Implementation Playbook

> **Pacote:** DOMAIN_MANAGER_IMPLEMENTATION_PACKAGE_V1  
> **Autoridade normativa:** `DOMAIN_MANAGER_MASTER_SPECIFICATION_V1.md`  
> **Status:** operacional / implementação  
> **Regra:** este documento explica COMO executar o Master; não pode contrariá-lo.

## Propósito

Traduzir a arquitetura visual e de interação do Master em regras de construção consistentes e leves.

## Regra de conflito

Se este arquivo divergir do Master:
1. parar a implementação da parte afetada;
2. identificar a seção/DEC conflitante;
3. aplicar o Master;
4. atualizar este documento;
5. nunca improvisar uma terceira regra.
# 33. UI DESIGN SYSTEM

## 33.1. Architecture

```text
Foundations
→ Tokens
→ Primitives
→ Compound Patterns
→ Domain Patterns
→ Screens / Workspaces
```

No per-screen visual foundation.

## 33.2. Design direction

- dark-first;
- military-tech / gothic-tech;
- console operacional, not cinematic HUD;
- low performance cost;
- CSS-first;
- decoration subordinate to clarity.

Avoid:
- permanent glitch on functional text;
- strong scanlines;
- heavy blur;
- huge shadows on repeated rows;
- tiny text;
- constant animation;
- images as structural dependency.

## 33.3. Token categories

Namespace `--dm-*`.

At minimum:
- color primitives;
- semantic surfaces;
- foreground/text;
- border;
- semantic status;
- spacing;
- typography;
- radius;
- elevation;
- motion duration/easing;
- z-layer;
- responsive/density values.

Status grammar:
```text
neutral
info
success
warning
danger
special
```

Never color-only meaning.

## 33.4. Density

```text
compact
default
comfortable
```

Density changes presentation, not semantics.

## 33.5. Motion

Jobs:
```text
feedback
continuity
attention
progress
```

If motion has no job, default = remove.

`prefers-reduced-motion` mandatory.

---

# 34. APP SHELL E NAVIGATION

Global navigation small/stable.

Concept:
```text
Domains
Operations
Timeline
Search / Command Palette
```

Domain-local navigation separate:
```text
Overview
People
Economy
Projects
Facilities
Diplomacy
Missions
Knowledge
```

Exact grouping can evolve without changing information architecture.

Domain Explorer:
- lazy tree;
- keyboard navigation;
- selected vs expanded distinct;
- physical/admin labels when needed;
- preserves expanded state as local preference;
- audience-filtered before client.

Breadcrumb:
- ancestry;
- clickable;
- compress long middle segments;
- not substitute for tree.

Preserve Context is formal:
- filters;
- sort;
- scroll;
- selection;
- current section;
- inspector state when reasonable.

---

# 35. COLLECTIONS / DATAGRID

`DMCollection` separates data/query state from representation.

Representations:
- Table;
- List;
- Cards;
- Tree;
- Board;
- Gantt;
- Timeline.

Choose by task, not beauty.

`DMDataGrid`:
- declarative columns;
- stable column keys;
- formatting presentation-only;
- search;
- filters;
- sort;
- grouping;
- selection;
- bulk;
- pagination;
- virtualization;
- optional inline edit;
- keyboard contracts.

Large datasets:
- pagination/virtualization;
- provider/index sorting/filter;
- no rendering thousands blindly.

Cards:
- overview/small sets;
- not default at empire scale.

Empty ≠ No Results ≠ Permission Denied ≠ Missing Capability ≠ Error.

---

# 36. INSPECTOR / SPLIT VIEW / DRAWERS

Inspector hierarchy:
```text
Summary
Explanation
Details
Related
History
Actions
```

- preserves list context;
- history lazy;
- destructive actions separated;
- widths compact/standard/wide;
- narrow layout becomes sheet/page.

Split view:
```text
Collection | Detail
```

Useful for Requests, Missions, Knowledge, Agreements.

Avoid nested Dialogs/Drawers.

---

# 37. OPERATIONS WORKSPACE

Operations is decision surface, not truth store.

Answers:
1. What needs attention?
2. What is upcoming?
3. What changed?
4. What can I do?

Sections:
- Needs Attention;
- Action Queue;
- Upcoming;
- Activity;
- metrics.

Needs Attention sources:
- Requests waiting;
- blocked Projects;
- obligations;
- scheduler failures;
- resource pressure;
- deadlines;
- recoveries.

Action Queue ≠ Activity Feed.

Activity Feed = readable recent history.
Audit log = technical trace.

Drill-down always routes to owning subsystem/source.

---

# 38. FORMS / QUICK CREATE / WIZARDS

## Quick Create

- essential fields only;
- safe defaults;
- can expand to Advanced without losing input;
- Create and open / Create another when useful.

## Advanced Create

- sections or Wizard;
- Wizard only when sequential dependencies justify it.

## Validation

Client:
- fast feedback.

Authority:
- final validation.

Distinguish:
- error;
- warning;
- advisory.

Never erase user input on failure.

## Draft

Draft ≠ committed entity.
Autosave mainly for safe preferences/drafts, not financial/rights mutations.

## Preview/Diff

`DMChangePreview` is based on Plan.
Shows:
- before/after;
- added/changed/removed;
- reserve/release;
- target count;
- blockers/warnings;
- grouped child subsystem impacts.

State changing after preview may require replan/reconfirmation.

---

# 39. DESTRUCTIVE ACTIONS

Safety proportional to impact.

```text
Tier 1 reversible
→ direct / undo

Tier 2 meaningful
→ confirmation

Tier 3 destructive
→ impact summary + confirmation

Tier 4 irreversible
→ impact summary + type-to-confirm + audit/recovery guidance
```

Hard delete Domain, purge history, destructive migration:
- strongest protection.

Avoid confirmation fatigue.

---

# 40. ADVANCED VIEWS

## Timeline
- past/present/future;
- filters;
- lazy history;
- secret-safe.

## Schedule
- list/day/week;
- CalendarAdapter;
- drag reschedule only via Command/Plan;
- list fallback.

## Gantt
- optional;
- lazy;
- Project remains usable without it;
- drag/resize generates commands;
- windowing for scale.

## Kanban
- lifecycle/stage alternative;
- drag transition generates Command;
- invalid transition blocked/explained.

## Graph
- optional;
- Relations/Knowledge/dependencies;
- node/depth caps;
- lazy expansion;
- authority-side secret filtering;
- fallback table/tree/list;
- no required heavy graph library.

---

# 41. GLOBAL SEARCH E COMMAND PALETTE

Search:
- audience-aware index;
- grouped results;
- exact/prefix/fuzzy weighting;
- context disambiguation;
- incremental/rebuildable;
- no secret leakage through autocomplete/counts/snippets.

Command Palette:
- Ctrl/Cmd+K candidate;
- pages + entities + Actions;
- availability from Action Registry;
- destructive actions still require preview/confirm;
- power tool, not sole navigation.

Shortcuts:
- central registry;
- conflict detection;
- input-context aware;
- discoverable;
- optional personal remapping.

---
## Ordem de construção de UI

1. foundations/tokens;
2. primitives;
3. patterns;
4. Domain patterns;
5. screens;
6. advanced views.

Não construir screens com CSS isolado antes de primitives.

## Bugs visuais blockers

- botão desalinhado;
- scrollbar indevida;
- nested scrolling problemático;
- clipping;
- texto ilegível;
- action escondida por overflow;
- layout que quebra em janela Foundry menor;
- state visual que depende apenas de cor.

## Performance visual

Em weak PC:
- evitar blur/filter/shadow repetido;
- não montar Graph/Gantt escondidos;
- lazy portraits;
- DOM controlado;
- reduced motion.
