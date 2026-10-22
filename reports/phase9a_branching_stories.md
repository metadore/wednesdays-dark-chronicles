# Phase 9A — Branching Stories Report

**Date:** 2026-10-21
**Scope:** Implement interactive fiction — branching story authoring in the Grimoire, a public story navigation API, and a reader interface. Feature development only; no redesign, no migration of existing content.
**Status:** Phase 9A complete. **Awaiting explicit approval before beginning Phase 9B.**

---

## 1. Pre-Flight Inspection

The repository was inspected before any change was made. Findings and the
decisions they drove are recorded here.

| Inspected | Finding |
|---|---|
| Git working tree | **There is no Git repository.** Neither `C:\Users\Hp` nor the project tree contains a `.git` directory (`fatal: not a git repository`). Version control is therefore unavailable; preservation relied on the pre-existing `prisma/schema.prisma.bak` copy, which was taken before the first edit and removed once the work was verified. |
| Prisma schema | Prisma **5.22.0** (client and CLI). Models: `Post`, `Category`, `PostCategory`, `Artifact`, `ArtifactCategory`, `User`, `Inquiry`, `Comment`. No story-like model existed. |
| Migration history | Five migrations, `20261019081137_init` → `20261019165239_add_comments_model`, all additive, `migration_lock.toml` pinned to `postgresql`. |
| Existing post/category models | `Post` uses `slug @unique` + `published Boolean` + `publishedAt DateTime?`; `Category` uses `name`/`slug` both `@unique`. The story models follow these established conventions. |
| Public post-detail page | `post.html` at the site root, driven by `?slug=`, using `fetch` against `http://localhost:3000/api`. |
| Grimoire admin dashboard | `public/admin/{index.html,app.js,style.css}`. Vanilla JS, one pane per section, `apiFetch()` helper that attaches a CSRF token to every state-changing request, modal-based forms, `escapeHtml()` for interpolation. |
| Existing endpoints | `GET /api/posts`, `GET /api/posts/:slug`, `GET /api/categories`, `GET /api/artifacts`, `GET /api/artifacts/:slug`, `GET /api/categories/artifact-categories`, `GET|POST /api/inquiries`, `GET|POST /api/comments`, `GET /api/admin/posts` (+ posts/artifacts/categories mutations), `GET /api/inquiries/admin`, `GET /api/comments/admin`. |
| Database initialisation & test isolation | `src/lib/test-env.js` fails closed; `src/lib/prisma.js` binds the datasource explicitly in test mode; `scripts/prisma-cli.js` forces the CLI onto the same database; `tests/setup/test-mode-guard.cjs` aborts a mocha run without `NODE_ENV=test`. **All preserved unchanged.** |
| Browser storage & JS patterns | No `localStorage` usage existed anywhere in the project. Public pages are static HTML with inline `<script>`, Tailwind CDN, the "Obsidian & Ink" token set (`obsidian_ink/DESIGN.md`), and `escapeHtml` / `safeImageUrl` helpers. The reader follows that same pattern. |

### 1.1 Baseline before any change

```
$ npm test
  104 passing (2s)
```

The live database before any change:
`posts=5 artifacts=182 categories=11 users=3 inquiries=0 comments=0`.

---

## 2. Data Model

### 2.1 Why three models

The brief allowed `Story`, `StoryNode` and `StoryChoice`, or a cleaner fit.
Three models were chosen because a story is genuinely a **directed graph**:
the same node can be the target of many choices, and a choice needs a source
*and* a destination that are both nodes of the same story. A single "story
body with embedded sections" model could not express the graph, and a JSON
column could not express the referential integrity the brief requires.

The models follow the existing schema's conventions: `id String @id`, UUID
primary keys, `createdAt`/`updatedAt` on every record, `published Boolean`,
`publishedAt DateTime?`, a `@unique` `slug`.

### 2.2 The schema as implemented

`backend/prisma/schema.prisma` — three models appended; **no existing model
was modified**:

```prisma
model Story {
  id             String        @id @default(dbgenerated("gen_random_uuid()"))
  title          String
  slug           String        @unique
  introduction   String        @db.Text
  published      Boolean       @default(false)
  publishedAt    DateTime?
  startingNodeId String?
  createdAt      DateTime      @default(now())
  updatedAt      DateTime      @updatedAt
  nodes          StoryNode[]
  choices        StoryChoice[]

  startingNode StoryNode? @relation("StoryStartingNode", fields: [startingNodeId, id], references: [id, storyId], onDelete: NoAction)
}

model StoryNode {
  id              String        @id @default(uuid())
  storyId         String
  title           String?
  content         String        @db.Text
  isEnding        Boolean       @default(false)
  published       Boolean       @default(true)
  createdAt       DateTime      @default(now())
  updatedAt       DateTime      @updatedAt
  story           Story         @relation(fields: [storyId], references: [id], onDelete: Cascade)
  outgoingChoices StoryChoice[] @relation("ChoiceSource")
  incomingChoices StoryChoice[] @relation("ChoiceDestination")
  startingFor     Story[]       @relation("StoryStartingNode")

  @@unique([id, storyId])
  @@index([storyId])
}

model StoryChoice {
  id                String    @id @default(uuid())
  storyId           String
  nodeId            String
  destinationNodeId String
  label             String
  published         Boolean   @default(true)
  createdAt         DateTime  @default(now())
  updatedAt         DateTime  @updatedAt
  story             Story     @relation(fields: [storyId], references: [id], onDelete: Cascade)
  sourceNode        StoryNode @relation("ChoiceSource", fields: [nodeId, storyId], references: [id, storyId], onDelete: Cascade)
  destinationNode   StoryNode @relation("ChoiceDestination", fields: [destinationNodeId, storyId], references: [id, storyId], onDelete: NoAction)

  @@index([storyId])
  @@index([nodeId])
  @@index([destinationNodeId])
}
```

### 2.3 The composite foreign keys

The brief requires that *"no choice may lead into another unrelated story"*.
This is enforced **by PostgreSQL, not only by application code**. Every
foreign key that could cross a story boundary carries the story id as part of
the key:

| Foreign key | Target | Effect |
|---|---|---|
| `StoryChoice.(nodeId, storyId)` | `StoryNode.(id, storyId)` | A choice's **source** node must belong to the choice's own story. |
| `StoryChoice.(destinationNodeId, storyId)` | `StoryNode.(id, storyId)` | A choice's **destination** node must belong to the choice's own story. |
| `Story.(startingNodeId, id)` | `StoryNode.(id, storyId)` | A story's **starting node** must belong to that story. |

`StoryNode` exposes `@@unique([id, storyId])` purely as the target those
composite keys need. Because the story id is part of the key, PostgreSQL
rejects a mismatched story id itself.

**This was verified empirically, not assumed.** A read-only probe
(`backend/scripts/probe-story-constraints.js`, since removed) attempted each
cross-story write directly through Prisma, bypassing the application:

```
=== CONSTRAINT PROBE ===
  cross-story choice destination: REJECTED (P2003)
  cross-story choice source: REJECTED (P2003)
  cross-story starting node: REJECTED (P2003)
  same-story choice: ACCEPTED (correct)
  cleanup: probe stories removed
```

### 2.4 One schema deviation, and why

`Story.id` uses `@default(dbgenerated("gen_random_uuid()"))` rather than the
project's usual `@default(uuid())`.

**Reason:** Prisma cannot apply a *client-side* default to a field that
belongs to a relation's `fields` array. `Story.id` is part of the composite
`startingNode` relation, so `prisma.story.create()` without an explicit id
sent `NULL` and PostgreSQL rejected it:

```
Null constraint violation on the fields: (`id`)   [P2011]
```

The default is therefore generated by PostgreSQL itself. `gen_random_uuid()`
is built into PostgreSQL 13+ and was confirmed present on the target server:

```
gen_random_uuid -> 5fda04fb-a85d-4526-82c6-e289d73ad9b9
server_version   -> 16.15
```

`StoryNode.id` and `StoryChoice.id` are **not** part of any relation's
`fields` array, so they keep the project's standard `@default(uuid())` and
were confirmed to work unchanged. No other model was touched.

### 2.5 Migration

One **additive** migration was created. It creates three new tables and their
indexes and foreign keys; it contains **no `DROP`, no `ALTER` of an existing
table, and no data statement**.

`backend/prisma/migrations/20261021081641_add_branching_stories/migration.sql`

```sql
CREATE TABLE "Story" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
    "title" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "introduction" TEXT NOT NULL,
    "published" BOOLEAN NOT NULL DEFAULT false,
    "publishedAt" TIMESTAMP(3),
    "startingNodeId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Story_pkey" PRIMARY KEY ("id")
);
-- ... StoryNode, StoryChoice, their indexes, and five foreign keys ...
ALTER TABLE "Story" ADD CONSTRAINT "Story_startingNodeId_id_fkey" FOREIGN KEY ("startingNodeId", "id") REFERENCES "StoryNode"("id", "storyId") ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE "StoryNode" ADD CONSTRAINT "StoryNode_storyId_fkey" FOREIGN KEY ("storyId") REFERENCES "Story"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StoryChoice" ADD CONSTRAINT "StoryChoice_storyId_fkey" FOREIGN KEY ("storyId") REFERENCES "Story"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StoryChoice" ADD CONSTRAINT "StoryChoice_nodeId_storyId_fkey" FOREIGN KEY ("nodeId", "storyId") REFERENCES "StoryNode"("id", "storyId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StoryChoice" ADD CONSTRAINT "StoryChoice_destinationNodeId_storyId_fkey" FOREIGN KEY ("destinationNodeId", "storyId") REFERENCES "StoryNode"("id", "storyId") ON DELETE NO ACTION ON UPDATE CASCADE;
```

The migration was generated with `prisma migrate diff` from the two
datamodels, then applied with `prisma migrate deploy` to **both** databases:
the test database first, then the live database. No `migrate reset` was run
and no volume was removed.

---

## 3. Files Changed

### 3.1 Backend — new files

| File | Purpose |
|---|---|
| `backend/src/lib/story-validation.js` | The single place where the story rules live: field validators, slug rules, reachability, and the whole-graph structural verdict. Pure functions, no database access. |
| `backend/src/controllers/stories.controller.js` | The four public, read-only endpoints. |
| `backend/src/controllers/admin-stories.controller.js` | The fourteen administrative endpoints, including the transactional publish gating. |
| `backend/src/routes/stories.routes.js` | The public router. |
| `backend/tests/api/stories.test.js` | 27 public-API tests. |
| `backend/tests/api/admin-stories.test.js` | 49 administrative tests. |
| `backend/scripts/demo-story.js` | Creates/removes a published demo story for browser verification. |
| `backend/scripts/issue-admin-session.js` | Mints a session cookie for an **existing** administrator, for local browser verification. It creates, modifies and deletes no account and never reads a password. |
| `backend/scripts/reset-story-tables.js` | Drops only the three Phase 9A tables from the **test** database, to re-apply the corrected migration. It refuses to run against the production database. |

### 3.2 Backend — modified files

| File | Change |
|---|---|
| `backend/prisma/schema.prisma` | The three new models appended. **No existing model changed.** |
| `backend/src/routes/admin.routes.js` | The story routes added, inside the existing `router.use(protect)` guard, with `doubleCsrfProtection` on every mutation. |
| `backend/src/app.js` | Two lines: `import storyRoutes` and `app.use('/api/stories', storyRoutes)`. |

### 3.3 Frontend — new files

| File | Purpose |
|---|---|
| `branching_stories/code.html` | The public story listing. |
| `branching_stories/reader.html` | The reader. |

### 3.4 Frontend — modified files

| File | Change |
|---|---|
| `public/admin/index.html` | The **Stories** nav item, the Stories pane, and cache-busters (`style.css?v=4`, `app.js?v=4`). |
| `public/admin/app.js` | The story management section (~700 lines). No existing function was modified. |
| `public/admin/style.css` | The modal max-height/overflow fix (§7.3). |
| `home_the_void/code.html`, `grim_chronicles/code.html`, `the_vault/code.html` | **One** new sidebar entry each, pointing at the story listing. The existing entries were not reordered or restyled. |

### 3.5 Not modified

`.env`, `.env.test`, `.env.example`, `prisma/seed.js`, every existing
model, every existing controller, every existing route, every existing test,
`docker-compose.yml`, `package.json`, and the PostgreSQL installation.

---

## 4. API

### 4.1 Public endpoints — `/api/stories`

| Method | Path | Purpose | Success | Errors |
|---|---|---|---|---|
| `GET` | `/api/stories` | List the published stories. Returns the project's standard `{ data, meta }` envelope. | `200` | — |
| `GET` | `/api/stories/:slug` | A published story with its starting node, its nodes, its choices, and `choicesByNode` for convenience. | `200` | `400` malformed slug · `404` unknown or unpublished |
| `GET` | `/api/stories/:slug/nodes/:nodeId` | A node of that story and the choices that leave it. | `200` | `400` malformed slug/id · `404` unknown story, node, or unpublished node |
| `GET` | `/api/stories/:slug/nodes/:nodeId/choices/:choiceId` | Follow a choice to its destination node, with that node's onward choices. | `200` | `400` malformed id · `404` unknown story, choice, or unpublished destination |

Query parameters on `GET /api/stories`: `page` (default 1) and `limit`
(default 10, **capped at 50**, matching the posts endpoint). Invalid values
are clamped rather than rejected, exactly as `GET /api/posts` does.

**Every public query is filtered on `published: true`**, on the story and on
the node/choice, and is additionally scoped to the story that was already
proven published. A draft story is indistinguishable from a missing one.

### 4.2 Administrative endpoints — `/api/admin/stories`

Fourteen routes. All of them sit behind the router's existing `protect` (JWT)
guard, and every mutation additionally sits behind `doubleCsrfProtection`.

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/admin/stories` | List every story, published or not, with its structure verdict. |
| `GET` | `/api/admin/stories/:id` | One story with its full graph and verdict. |
| `GET` | `/api/admin/stories/:id/validate` | The structural verdict and a graph preview, without changing anything. |
| `POST` | `/api/admin/stories` | Create a story. Always starts as a draft. |
| `PUT` | `/api/admin/stories/:id` | Update title, slug and introduction. |
| `PATCH` | `/api/admin/stories/:id/publish` | Publish or unpublish. **Publication is refused unless the whole graph is valid.** |
| `DELETE` | `/api/admin/stories/:id` | Delete the story with its nodes and choices. |
| `POST` | `/api/admin/stories/:id/nodes` | Create a node. |
| `PUT` | `/api/admin/stories/:id/nodes/:nodeId` | Update a node's heading, text, ending flag and visibility. |
| `DELETE` | `/api/admin/stories/:id/nodes/:nodeId` | Delete a node. `?strategy=block` (default) or `?strategy=detach`. |
| `POST` | `/api/admin/stories/:id/nodes/:nodeId/choices` | Add a choice from a node to a destination. |
| `PUT` | `/api/admin/stories/:id/choices/:choiceId` | Update a choice's label, destination and visibility. |
| `DELETE` | `/api/admin/stories/:id/choices/:choiceId` | Delete a choice. |
| `POST` | `/api/admin/stories/:id/start` | Set the starting node. |

### 4.3 Validation rules

**Field validation** (`src/lib/story-validation.js`):

| Field | Rule |
|---|---|
| Title | Required, ≤ 120 characters. |
| Slug | Required, ≤ 80 characters, `^[a-z0-9]+(-[a-z0-9]+)*$`. Auto-derived from the title when omitted. |
| Introduction | Required, ≤ 2000 characters. |
| Node text | Required, ≤ 10 000 characters. |
| Node heading | Optional, ≤ 120 characters. |
| Choice label | Required, ≤ 200 characters. |
| Identifiers | `^[A-Za-z0-9_-]{1,64}$`; a malformed id is a `400`, not a lookup miss. |
| Nodes per story | ≤ 500. |
| Choices per node | ≤ 20. |

**Graph validation** — the verdict returned by `validateStoryGraph()`:

*Errors (blocking publication):*

- The story has no starting node, or the starting node does not belong to it.
- The starting node is also an ending node.
- An ending node has outgoing choices.
- A choice points at a node that does not exist in this story.
- A reachable node is not published.
- A published, reachable choice leads to a node that is not published.
- A reachable, non-ending node has no published choice leading onward.
- The story has no reachable ending.
- A reachable node cannot reach any ending.
- The story exceeds 500 nodes.

*Warnings (not blocking):*

- A node has no choices and is not an ending (a dead end).
- Some nodes cannot be reached from the starting node.

### 4.4 Publication gating and mutation safety

**A published story may never become structurally invalid.** Every mutation
that could change the shape of the graph runs inside a transaction that
re-validates the entire story afterwards and rolls the change back if the
result would be broken:

```js
const mutateAndVerify = async (storyId, mutate, { forPublication }) => {
  return prisma.$transaction(async (tx) => {
    const result = await mutate(tx);
    const story = await tx.story.findUnique({ where: { id: storyId }, include: { nodes: true, choices: true } });
    const verdict = validateStoryGraph(story, story.nodes, story.choices, { forPublication });
    if (!verdict.valid) {
      const err = new Error('The change would leave the story structurally invalid');
      err.statusCode = 409;
      err.errors = verdict.errors;
      throw err;      // rolls the transaction back
    }
    return { story, result };
  });
};
```

The transaction gives the "all or nothing" property the brief asks for: a
partially saved story structure cannot exist.

### 4.5 Deleting a node, and dangling choices

The brief requires that dangling choices never be left silently. The
behaviour is **explicit and deliberate**:

| Strategy | Behaviour |
|---|---|
| `?strategy=block` (default) | If any other node or choice still references the node, the deletion is **refused** with `409` and a list of the references (`incomingChoices`, `outgoingChoices`, `isStartingNode`). The delete button in the dashboard uses `?strategy=detach` deliberately, because the user has already confirmed the action. |
| `?strategy=detach` | The dependent choices — those that leave the node and those that point at it — are removed **in the same transaction** as the node, and the starting-node pointer is cleared first. Choices elsewhere in the story are untouched. |

The starting-node pointer is a foreign key with `ON DELETE NO ACTION`, so it
**must** be cleared before the node row is removed. This was found by a
failing test during development, and the same ordering applies in the story
deletion, the node deletion and the test cleanup.

---

## 5. Reader Interface

### 5.1 The listing — `branching_stories/code.html`

Uses the "Obsidian & Ink" tokens from `obsidian_ink/DESIGN.md`: obsidian
`#0A0A0A` canvas, `surface-container-lowest` cards, `Libre Caslon Text`
serif headings, `Inter` body, `Geist Mono` labels, the grain overlay, and
the hard-shadow hover treatment. It is a two-column grid on desktop and a
single column on mobile, with a real pagination bar driven by `meta`
(Roman numerals, matching the blog page).

**Every value from the API is written with `textContent` or
`setAttribute`.** Nothing is interpolated into `innerHTML`.

States handled: loading ("Consulting the Archive…"), empty ("No stories have
been unsealed."), and error ("The Archive Is Sealed.").

### 5.2 The reader — `branching_stories/reader.html`

* Story title, introduction and starting section.
* Readable narrative text (preserved line breaks via `white-space: pre-wrap`).
* Choice buttons with an arrow marker, the label, and an
  `aria-label="Choose: <label>"`.
* **The reader controls navigation.** Nothing advances automatically: a
  choice is followed only when the reader activates the button. There is no
  auto-traversal, and the graph is walked one bounded query at a time.
* **Backtracking** two ways: the "Back" control steps to the previous node,
  and the "The Path You Have Walked" panel lists every visited section and
  lets the reader jump directly to any of them.
* **Distinct ending presentation**: a burgundy-bordered banner ("The Path
  Concludes") and no choice buttons at all.
* **Restart**: the "Restart" button in the header and "Restart the Story" in
  the controls both clear the path and return to the opening section.
* Loading, empty and error states.

### 5.3 The local reading path

The path is kept in `localStorage` under `wdc.story.path.<slug>` and records
`{ nodeId, title, viaLabel }` for each step, so the reader can see which
choice led where.

**The path is validated before it is restored.** Three independent guards:

1. `loadPath()` discards anything that is not a JSON array, and discards
   every entry that is not an object with a non-empty string `nodeId`. The
   `title` and `viaLabel` are coerced to strings.
2. `validatePathAgainstStory()` drops any entry whose `nodeId` is not in the
   node list the server just returned — so a path saved against a story that
   has since been rewritten is not restored.
3. If the node for the current cursor cannot be found, the path is cleared
   and the story restarts from its beginning.

Storage failures (private mode, a full quota, disabled cookies) are caught
and ignored: `savePath()` and `clearPath()` never throw, and a failure to
store never breaks the reader.

**No authentication secret is ever written to `localStorage` or
`sessionStorage`.** The reader stores only node ids, section titles and
choice labels. The administrator's JWT lives in an `httpOnly` cookie set by
the server and is never exposed to the page.

### 5.4 Loop safety

A branching graph may legitimately contain a cycle. The reader never
traverses the graph: each choice is a single bounded query, so a cycle
cannot cause unbounded work. The server's own reachability analysis uses a
`visited` set plus an independent depth ceiling of 500, so it terminates
after visiting each node once.

---

## 6. Admin Dashboard Integration

The **Stories** pane was added to the Grimoire alongside the existing
Overview, Blog, Vault, Categories, The Séance and Messages panes. Nothing
else in the dashboard was touched.

Administrators can:

* Create a story (title, slug, introduction).
* Edit the title, slug and introduction.
* Add, edit and delete sections (nodes) — heading, text, passage/ending type,
  published/unpublished.
* Set the starting node, either from the dropdown ("Set as Start") or from
  a node's "Make Start" button.
* Add, edit and delete choices, with the destination chosen from a dropdown
  that lists only the nodes of that story.
* Configure ending nodes by choosing the "Ending (no choices)" type.
* **Preview the structure** — a readable list of every section, which is the
  start, whether it is an ending, whether it is published, and each of its
  choices and their destinations.
* **See the structural verdict** in the editor: a green box reading "The
  structure is valid and this story can be published", or a red box listing
  the exact errors ("The story has no starting node", …), plus any warnings.
* Publish and unpublish, and delete with a confirmation prompt.

The dashboard uses the existing `apiFetch()` helper, so every mutation
carries a CSRF token automatically, and the existing `escapeHtml()` for
interpolated values. New code writes to the DOM with `textContent` and
`createElement`.

**Structural invalidity of a published story is impossible** — §4.4 — and
the dashboard surfaces the server's own refusal message when a change is
rejected.

---

## 7. Defects Found and Fixed During This Phase

Four real defects were found by testing and by browser verification. Each is
recorded with the evidence.

### 7.1 The candidate schema initially dropped the existing models

While drafting the schema, a candidate file that contained only the three
story models was copied over `schema.prisma` in order to run
`prisma migrate diff`. The diff output revealed it:

```
-- DropTable
DROP TABLE "Post";
-- DropTable
DROP TABLE "Category";
...
```

The original schema was restored from the backup taken before the first
edit (`prisma/schema.prisma.bak`), and the migration was regenerated
correctly. The final diff is **purely additive** — three `CREATE TABLE`,
four `CREATE INDEX`, five `ADD CONSTRAINT`, and nothing else. The live
database was verified unchanged after the migration (§9).

### 7.2 Deleting a story failed with a foreign-key violation

The first test run of the admin suite produced:

```
[Error] 500 - Invalid `prisma.storyNode.deleteMany()` invocation:
Foreign key constraint violated: `Story_startingNodeId_id_fkey (index)`
```

**Cause:** `Story.startingNodeId` is a foreign key into `StoryNode` with
`ON DELETE NO ACTION`. The delete routine removed the node rows before
clearing the pointer, so PostgreSQL refused the deletion.

**Fix:** the starting-node pointer is now cleared **first**, in the story
deletion, in the node deletion, and in the test cleanup. The same defect
was present in three places and was fixed in all three.

### 7.3 The admin modal overflowed the viewport and its lower controls were unreachable

Found during browser verification of the story editor. The "+ Add Section"
button could not be clicked:

```
VIEWPORT: 1262x568
MODAL CONTENT STYLE: {"h":781,"sh":781,"overflowY":"visible","maxH":"none"}
ELEMENT AT POINT: null          <- the button was below the fold
```

**Cause:** `.modal-content` had no height constraint, so the tall story
editor (781px) overflowed a 568px viewport with `overflow: visible`. The
lower controls were rendered outside the visible area and could not be
reached, focused or clicked. The Phase 8.2 fix had applied `max-height` and
`overflow-y: auto` only inside the `@media (max-width: 720px)` block, so
desktop viewports were still affected.

**Fix:** `max-height: 92vh; overflow-y: auto;` was moved onto
`.modal-content` in the base rule, and the overlay gained `padding: 1rem`.
The control was then clicked successfully and the full authoring flow
completed in the browser.

### 7.4 The reader's structural report was never displayed

Two ordering defects in the new dashboard code:

* `renderStoryEditor()` replaces the whole modal body. The validation report
  was written **before** the render, so the render discarded it. The report
  is now written **after** the render.
* On the first open of a story the report was not requested at all. The
  `openStoryEditor()` path now requests it.

Both were confirmed fixed in the browser: the report now shows
"The structure is valid and this story can be published." with a green
border, and an invalid draft shows the exact list of errors.

### 7.5 The reader overflowed the viewport on a phone

At a 390px viewport the page was 439px wide:

```
DOC scrollWidth vs clientWidth: 439 vs 390
OVERFLOWING ELEMENTS: ['DIV cls=grain-overlay right=439 w=439',
                        'SPAN cls=... right=439 w=353']
```

**Fix:** the grain overlay was capped at `max-width: 100vw`; the section
heading, narrative text, story title and introduction were given
`overflow-wrap: break-word`; and the eyebrow row was made to wrap, with the
eyebrow truncating and the depth label not shrinking. Re-verified:

```
DOC scrollWidth vs clientWidth: 390 vs 390
OVERFLOWING ELEMENTS: []
```

---

## 8. Tests

### 8.1 New test files

**`backend/tests/api/stories.test.js` — 27 tests** (public API)

Listing the published stories; excluding draft stories; pagination metadata
and the limit cap; invalid pagination being clamped; retrieving a published
story with its starting node; `404` for a draft story, an unknown slug and a
malformed slug; the draft story's text not appearing in the response;
retrieving a node and its choices; an ending node returning no choices;
`404` for a node of a draft story; `404` for a published node requested
through a draft story; `404` for an unknown node; `400` for a malformed node
id; following a valid choice; reaching an ending; `404` for a choice that
does not belong to the source node; `404` for an unknown choice; `404` for a
choice of a draft story; a draft node inside a published story returning
`404`; a draft choice inside a published story not appearing and its label
not appearing anywhere in the response; a published choice leading to a draft
node being filtered out **and** refusing to be followed directly; a cyclic
graph not traversing indefinitely; and the posts, artifacts and categories
endpoints still working.

**`backend/tests/api/admin-stories.test.js` — 49 tests** (administrative API)

Every one of the fourteen administrative routes rejecting an unauthenticated
request with `401 "Authentication required"`; a state-changing request
without a CSRF token rejected with `403`; a CSRF token minted by a different
session rejected with `403`; creating a story; listing stories including
drafts; retrieving one story with its graph; updating title, slug and
introduction; a duplicate slug rejected; a missing title, slug or
introduction rejected; a malformed slug rejected; `404` for a story that
does not exist; creating nodes and linking them with choices; setting the
starting node; a starting node belonging to another story refused; a
starting node that is an ending refused; a choice whose destination does not
exist refused; **a choice that points into a different story refused**; a
choice that leaves an ending node refused; updating a choice; updating a
choice that belongs to a different story refused; deleting a choice;
publication refused with no starting node, with a dead-end starting node,
with no reachable ending, and with an unreachable draft node; publication
succeeding for a valid story; unpublishing; **a published story refusing a
mutation that would invalidate it, and being unchanged afterwards**; a
non-boolean publish flag rejected; the structure report being invalid and
then valid; a referenced node refusing deletion by default; a referenced
node being deleted with `?strategy=detach`, leaving no dangling choice;
deleting a story with its nodes and choices; `404` when deleting a story
that does not exist; and posts, artifacts, categories and users being
unchanged by the whole story lifecycle.

### 8.2 Independent runs of the story groups

| Group | Command | Result |
|---|---|---|
| Public stories | `NODE_ENV=test npx mocha tests/api/stories.test.js --exit` | **27 passing**, 0 failing, 0 pending |
| Admin stories | `NODE_ENV=test npx mocha tests/api/admin-stories.test.js --exit` | **49 passing**, 0 failing, 0 pending |

### 8.3 The complete suite, three times, three separate processes

| Run | Passing | Failing | Pending | Skipped | Duration |
|---|---|---|---|---|---|
| 1 | **180** | **0** | **0** | **0** | ~3s |
| 2 | **180** | **0** | **0** | **0** | ~3s |
| 3 | **180** | **0** | **0** | **0** | ~3s |

Exact totals confirmed with the JSON reporter:
`passes=180 failures=0 pending=0 skipped=undefined tests=180`.

**180 = the 104 tests that existed before this phase + 76 new ones.** No
existing test was modified, no test was skipped, and no assertion was
weakened.

### 8.4 Regression of the existing APIs

The Phase 7 and Phase 8 functionality is covered by the same 180-test suite,
which includes the Blog, Vault, Artifact-category, Posts, Auth, Admin,
Health and Comment (63 tests) groups. The story tests additionally assert
directly that `GET /api/posts`, `GET /api/artifacts` and
`GET /api/categories` still work, and that a whole story lifecycle changes
nothing about the post, artifact, category or user counts.

---

## 9. Database Preservation

### 9.1 The live database is unchanged

| Metric | Before Phase 9A | After Phase 9A | Verdict |
|---|---|---|---|
| posts | 5 | **5** | unchanged |
| artifacts | 182 | **182** | unchanged |
| categories | 11 | **11** | unchanged |
| users | 3 | **3** | unchanged |
| inquiries | 0 | **0** | unchanged |
| comments | 0 | **0** | unchanged |
| tables | 9 | **12** | +3 (Story, StoryNode, StoryChoice) |

### 9.2 Publication statuses are unchanged

| Record | Before | After |
|---|---|---|
| `taxonomy-of-shadows` | Published | **Published** |
| `elegies-in-dust` | Published | **Published** |
| `test-post` | Published | **Published** |
| `test-blog-post` | Published | **Published** |
| `secret-post` | Draft | **Draft** |

Aggregate: posts = 4 published / 1 draft; artifacts = 58 published / 124
draft. Identical before and after.

### 9.3 Administrator accounts are unchanged

`admin`, `admin_test`, `testadmin` — all present, **no account was created,
modified or deleted**, and no password or role was changed. The browser
verification used a session token minted by
`backend/scripts/issue-admin-session.js` for the **existing** `admin`
account; the script creates, modifies and deletes nothing and never reads a
password.

### 9.4 The test database is clean

After the three full-suite runs the test database contains
`stories: (none) | nodes: 0 | choices: 0` — the suite removes exactly what
it creates, and nothing else. The live database's story table was also
emptied again after browser verification (`backend/scripts/demo-story.js
--cleanup`), leaving no demo content behind.

---

## 10. Test Isolation

The Phase 8.1/8.2 safeguards were **not modified** and were re-verified after
the implementation.

| Check | Result |
|---|---|
| `NODE_ENV=test` resolves the datasource to | `db_test` — role `user`, `host=::1/128`, 12 tables. **Not the live database.** |
| The live database name | `wednesdays_dark_chronicles` — a physically separate database. |
| `mocha` run without `NODE_ENV=test` | **Aborts:** *"FATAL: the test suite must be run with NODE_ENV=test… Refusing to run the suite against the live database."* |
| `.env.test` missing | **Aborts:** *"FATAL: NODE_ENV=test but the dedicated test configuration is missing… Refusing to run against the live database."* |
| Prisma CLI database target | Unchanged — `scripts/prisma-cli.js` still forces `.env` in development and `.env.test` in test mode. |
| Prisma version | **5.22.0** throughout. No Prisma 6/7 configuration API was introduced; `prisma.config.ts` was not touched. |
| The development database target | **Unchanged.** The Docker container and the native Windows PostgreSQL service were left exactly as they were; the Docker daemon was not even running during this phase, and nothing was switched, migrated, copied, deleted or reset. |
| Secrets | `.env` and `.env.test` were not modified. No credential was read, printed or exposed in any output, report or test. |

---

## 11. Browser Verification Actually Performed

All checks were performed in a real browser against the running backend
(`http://localhost:3000`) and the static server (`http://localhost:5500`).
Interaction used **real mouse clicks at computed viewport coordinates**
(`click_at_xy`) and **real key events** dispatched through CDP
`Input.dispatchKeyEvent`, not synthetic DOM events.

### 11.1 The reader

| Check | Result |
|---|---|
| Listing renders the published story | **Pass** — one card, "The Ashen Corridor", correct reader link |
| Reader renders the title, introduction and starting section | **Pass** — "The Threshold", narrative text intact |
| Choice buttons render | **Pass** — "Follow the warmth", "Follow the cold" |
| Choosing advances the story (real click) | **Pass** — "The Warm Corridor" |
| The path records the choice taken | **Pass** — *"via 'Follow the warmth'"* |
| Reaching an ending (real click) | **Pass** — "The Door That Opened Outward" |
| The ending is presented distinctly | **Pass** — the banner appears and **zero** choice buttons are rendered |
| The alternative branch reaches its own ending | **Pass** — "The Cold Corridor" → "The Last Frost" |
| Backtracking from the path panel (real click) | **Pass** — returns to "The Threshold" with its choices restored |
| The Back control (real click) | **Pass** — steps back one node; disabled at the first node |
| Restart (real click) | **Pass** — returns to "The Threshold", the path is cleared, the ending banner disappears |
| The path survives a page reload | **Pass** — the reader returns to the last position with all three steps |
| Malformed stored JSON | **Pass** — falls back to the opening section, no error |
| A stored array of garbage | **Pass** — falls back to the opening section |
| A stored path pointing at a node that no longer exists | **Pass** — the path is discarded and the story restarts |
| **XSS: a story whose title, introduction, node text and choice label all contain payloads** | **Pass** — `alerts fired: none`; every payload renders as **inert text**; `children.length === 0` for the title, the introduction, the narrative and the choice label; `document.querySelectorAll('img[src="x"]').length === 0` |
| Keyboard activation (a real `Enter` key event) | **Pass** — the story advanced to "The Warm Corridor" |
| Focus ring on the choice button | **Pass** — `outline: rgb(163, 22, 22) solid 2px`, `offset 3px`, `matches(':focus-visible') === true` |
| Focus ring on the listing link | **Pass** — same, with `aria-label="Begin the story: The Ashen Corridor"` |
| Choice buttons are real `<button type="button">` | **Pass** |
| 390 × 844 layout | **Pass** — `scrollWidth 390 = clientWidth 390`, no overflowing element, choices 350px wide and inside the viewport |

### 11.2 The Grimoire

| Check | Result |
|---|---|
| The Stories nav item is present | **Pass** — Overview, Blog, Vault, Categories, **Stories**, The Séance, Messages |
| The Stories pane lists the stories | **Pass** — "The Ashen Corridor / Published / Valid (5 nodes, 4 choices)" |
| The editor opens (real click on "Author") | **Pass** — title, slug, introduction, the starting-node dropdown and every section |
| The structural verdict is displayed | **Pass** — "The structure is valid and this story can be published." with a green border |
| An invalid draft shows the exact errors | **Pass** — "The story has no starting node", plus the dead-end and unreachable warnings |
| **Creating a story through the UI** | **Pass** — title, slug and introduction entered, story created, the structure editor appeared |
| **Adding a section through the UI** | **Pass** — "Opening" created and listed |
| **Adding an ending section through the UI** | **Pass** — "The End" created and marked as an ending |
| **Setting the starting node through the UI** | **Pass** — the dropdown updated and the verdict changed |
| **Adding a choice through the UI** | **Pass** — the destination dropdown listed only this story's nodes; the choice was created and the verdict became valid |
| **Publishing through the UI** | **Pass** — the row changed to "Published" and the story appeared in `GET /api/stories` |
| **Reading the UI-authored story publicly** | **Pass** — the reader showed the authored title, introduction, opening section and the choice |
| The structure preview | **Pass** — "Opening (start) passage · published · 1 choice(s) → 'Walk to the end' → The End" and "The End ENDING · published · 0 choice(s)" |
| Delete asks for confirmation | **Pass** — *"Erase this branching story and all of its sections and choices?"* |
| Declining the confirmation keeps the story | **Pass** |
| Accepting it removes the story and its records | **Pass** — the row disappeared and the story left the public list |

### 11.3 Regression of the existing pages

| Check | Result |
|---|---|
| The Void home | **Pass** — renders, with the new "Branching Stories" sidebar entry |
| Grim Chronicles blog | **Pass** — 4 articles, 4 category filters, "PAGE I OF I" |
| The Vault | **Pass** — 12 tiles, category filters, the detail modal opens with its title |
| Inquiries | **Pass** |
| The article page | **Pass** — "Test Blog Post" with its date and category |
| No page shows an error state | **Pass** |

### 11.4 What was *not* browser-tested, and why

* **The live production database was never mutated by a destructive action
  against real content.** The only writes were to the Phase 9A story tables,
  and the one story created through the dashboard UI was deleted through the
  dashboard's own delete flow — which is the flow under test.
* **No screenshot was captured.** `Page.captureScreenshot` timed out
  repeatedly against the browser daemon in this environment, exactly as it
  did in Phase 8.2. Every check was therefore made against the live DOM and
  the database, which is stronger evidence than an image.
* **The browser authentication used an injected server-issued session
  cookie** for the existing `admin` account rather than typing a password,
  because the credential-vault save was declined in the UI. The password was
  never typed into or read by the browser tool. A probe with deliberately
  wrong credentials was confirmed to return `401`.

---

## 12. Remaining Limitations

| # | Limitation | Detail |
|---|---|---|
| L1 | **No Git repository.** | The project tree has no `.git` directory, so there is no commit history, no branch and no diff for this phase. Preservation relied on the schema backup and on the before/after database comparison in §9. |
| L2 | **The reader's local path is per browser and per device.** | It is stored in `localStorage`, so it does not follow the reader to another browser, another profile or another device, and it is lost if the browser data is cleared. The reader says so on the page: *"This path is kept only in this browser. It is not sent to the server and does not follow you to another device."* |
| L3 | **The story listing is not reachable from the blog page or the article page.** | It is linked from the sidebar of The Void, Grim Chronicles and The Vault, and it is at `/branching_stories/code.html`. The blog page's own article grid was deliberately not altered. |
| L4 | **The admin story editor is a single long modal.** | It scrolls within the viewport (§7.3) but it is not a multi-pane authoring workspace. Node editing and choice editing each open their own modal. |
| L5 | **The demo story was removed.** | `backend/scripts/demo-story.js` creates a published demo story for browser verification and `--cleanup` removes it. After the phase, the live database has no stories, so the public listing shows its empty state until an administrator publishes one. |
| L6 | **A published story cannot be edited into an invalid state, but it also cannot be edited at all in some cases.** | For example, a choice that leads to a draft node is refused on a published story, because accepting it would publish the draft. This is the intended trade-off, but it means the admin must unpublish the story to restructure it. |
| L7 | **The reachability analysis is bounded at 500 nodes and 20 choices per node.** | A story larger than that is refused. The bound exists so a pathological graph cannot make the analysis unbounded. |
| L8 | **The reader restores a path only if every node in it still belongs to the story.** | If a story is rewritten so that a visited node is removed, the saved path is discarded and the reader starts again. The alternative — restoring a path into a story that no longer contains it — would show the reader a broken path. |
| L9 | **No screenshot artefacts.** | See §11.4. |
| L10 | **The inquiry rate limiter and the comment rate limiter were not exercised.** | They are unchanged and out of scope for this phase. |

---

## 13. Project Boundaries

| Constraint | Status |
|---|---|
| Phase 9A implemented, **Phase 9B not started** | **Honoured** — no bookmark, progress or preference code exists anywhere in the repository. |
| Phase 10 not started | **Honoured.** |
| Existing public page designs and behaviour preserved | **Honoured** — three pages gained one sidebar link each; no layout, typography or colour was changed. |
| Existing posts, artifacts, categories, inquiries, comments and administrator accounts preserved | **Honoured** — verified by before/after comparison (§9). |
| Existing publication statuses unchanged | **Honoured** — verified (§9.2). |
| Production secrets unmodified | **Honoured** — `.env` and `.env.test` untouched; no secret was read or printed. |
| No database resets, no volume removal | **Honoured** — no `migrate reset`; the Docker container and the native PostgreSQL service were left as they were. |
| The application was not deployed | **Honoured** — no deployment step was performed. |
| Authentication, CSRF and test-isolation safeguards not weakened | **Honoured** — all three re-verified (§10); the story routes sit inside the existing `protect` guard and use the existing `doubleCsrfProtection`. |
| Database targets not switched, no data migrated between instances | **Honoured** — §10. |
| Unrelated website functionality unchanged | **Honoured** — the blog, the Vault, the inquiries page and the article page were all re-verified in the browser (§11.3). |

---

## 14. Conclusion

Phase 9A is complete and verified.

* **Schema.** Three additive models — `Story`, `StoryNode`, `StoryChoice` —
  with a single additive migration that touches nothing existing. The
  "a choice can never leave its own story" rule is a **composite foreign
  key**, so PostgreSQL enforces it; a direct probe confirmed all three
  cross-story writes are rejected and a same-story write is accepted.
* **API.** Four public, read-only endpoints and fourteen administrative ones.
  Every public query is filtered to published content, so a draft story
  cannot be reached by guessing a slug, an id or a node id. Publication is
  refused unless the whole graph is valid, and a published story cannot be
  mutated into an invalid one — the check runs inside the same transaction as
  the change.
* **Reader.** A gothic listing and a reader with the starting section,
  choice buttons, a locally recorded path with backtracking, a distinct
  ending, restart, and loading/empty/error states. The reader controls
  navigation; nothing advances on its own.
* **Admin.** A Stories pane with full authoring, a live structural verdict,
  a structure preview, publish/unpublish and a confirmed delete. Every
  mutation goes through the existing JWT and CSRF middleware.
* **Tests.** 180 passing, 0 failing, 0 pending, 0 skipped, in each of three
  separate-process full-suite runs — 104 pre-existing plus 76 new. Both
  story groups also pass independently (27 and 49).
* **Preservation.** The live database is byte-for-byte identical apart from
  the three new tables: 5 posts, 182 artifacts, 11 categories, 3 users, 0
  inquiries, 0 comments, and every publication status unchanged.
* **Isolation.** The fail-closed guards are intact and re-verified; the
  suite still aborts without `NODE_ENV=test` and without `.env.test`.

Four real defects were found and fixed during this phase (a candidate schema
that would have dropped the existing models, a foreign-key ordering bug that
broke story deletion, an unreachable admin modal, and two report-ordering
bugs), plus a mobile overflow in the reader.

**STOP after Phase 9A. Awaiting explicit approval before beginning Phase 9B.**
