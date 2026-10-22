# Phase 3: Public Blog API

## Endpoints

### Posts
- `GET /api/posts`: Retrieve a paginated list of published posts.
  - Query params: `q` (text search), `category` (category slug), `page`, `limit` (max 50).
- `GET /api/posts/:slug`: Retrieve a single published post by its slug.

### Categories
- `GET /api/categories`: Retrieve categories that are linked to at least one published post.

## Files Changed
- `backend/src/controllers/posts.controller.js`: Updated `getPosts`, added `getPostBySlug`.
- `backend/src/controllers/categories.controller.js`: Created.
- `backend/src/routes/posts.routes.js`: Added `/:slug` route.
- `backend/src/routes/categories.routes.js`: Created.
- `backend/src/app.js`: Registered category routes.
- `backend/tests/api/blog.test.js`: Created comprehensive suite for all new functionality.

## Test Results
Ran `npx mocha tests/api/blog.test.js --exit` and `npm test`.
- Total new tests passed: 9/9
- Existing tests passed: 2/2

Verified:
- Search functionality (title, content, excerpt).
- Category filtering using Prisma relationships.
- Pagination validation and max limit (50).
- Slug-based retrieval with 404s for unknown/unpublished posts.
- Category listing filtered by published post presence.

## Unresolved Issues
None.
