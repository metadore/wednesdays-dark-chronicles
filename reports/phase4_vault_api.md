# Phase 4: The Vault API (Revised)

## Endpoints

### Artifacts
- `GET /api/artifacts`: Retrieve a paginated list of **published** artifacts.
  - Query params: `q` (text search over name/description), `category` (category slug), `page`, `limit` (max 50).
  - Response: `{ data: Artifact[], meta: { total, page, limit, totalPages } }`
- `GET /api/artifacts/:slug`: Retrieve a single **published** artifact by its slug.
  - Response: Artifact object including categories.
  - Error: 404 if not found or not published.

## Database Changes
- **Migration**: `20261019094251_add_published_to_artifact`
- Added `published` Boolean field to `Artifact` model with a default value of `false`.
- This ensures that new artifacts are drafts by default and must be explicitly published.

## Files Created or Modified
- `backend/prisma/schema.prisma`: Added `published` field to `Artifact`.
- `backend/src/controllers/artifacts.controller.js`: Updated to filter by `published: true`.
- `backend/tests/api/artifacts.test.js`: Updated to verify that unpublished artifacts are excluded from all public endpoints.
- `backend/package.json`: Updated `test` script to run nested tests (`'tests/**/*.test.js'`).

## Test Results
Executed `npm test` (comprehensive suite).

- **Vault API Tests**: 8/8 passing (including unpublished artifact exclusion)
- **Blog API Tests**: 9/9 passing
- **Health/General Tests**: 4/4 passing
- **Total**: 21 passing (0 failures)

## Schema Limitations & Notes
- All existing artifacts were automatically set to `published: false` by the migration default. If existing seeded data must be public, they will need to be updated via a script or admin panel.
- Text search is implemented as a case-insensitive `contains` query on `name` and `description`.
