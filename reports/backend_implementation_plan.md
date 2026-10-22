# Backend Implementation Plan: Wednesday's Dark Chronicles

## 1. Recommended Technology Stack
To preserve the existing visual design while adding full functionality, a decoupled **Headless Architecture** is recommended. This ensures that the precise CSS and HTML structure are not compromised by backend template engines.

### Core Stack
- **Backend Framework:** Node.js with **Fastify** or **Express**.
  - *Reasoning:* High performance, excellent for JSON APIs, and aligns with the modern JavaScript nature of the frontend.
- **Database:** **PostgreSQL** (via Prisma ORM).
  - *Reasoning:* Strong relational structure for categorized "Chronicles" and "Artifacts." Prisma provides type-safety and easy migrations.
- **Authentication:** Not required for public users. For an admin panel (to manage posts), **JWT (JSON Web Tokens)** with a simple bcrypt-hashed admin account.
- **API Architecture:** **REST API**.
  - *Reasoning:* Simple to implement, widely supported, and matches the required resource-based endpoints (Posts, Artifacts, Inquiries).
- **File Storage:** **AWS S3** or **Cloudinary**.
  - *Reasoning:* High-contrast, desaturated images are central to the aesthetic; professional hosting ensures fast delivery and optimization.
- **Deployment:** **Vercel** or **Railway**.
  - *Reasoning:* Seamless integration for Node.js backends and static frontend hosting.

## 2. Proposed Data Model
- **Posts Table:** `id`, `title`, `slug`, `content`, `date`, `image_url`, `category`.
- **Artifacts Table:** `id`, `name`, `category`, `description`, `image_url`, `file_url`.
- **Inquiries Table:** `id`, `name`, `intent`, `message`, `created_at`.
- **SiteSettings Table:** `key`, `value` (for footer links, hero text).

## 3. API Endpoint Mapping
| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/api/posts` | Fetch all blog entries |
| `GET` | `/api/posts/:slug` | Fetch single entry detail |
| `GET` | `/api/artifacts` | Fetch all portfolio items (with category filter) |
| `GET` | `/api/artifacts/:id` | Fetch specific artifact for modal |
| `POST` | `/api/inquiries` | Submit contact form |
| `GET` | `/api/search?q=` | Global search across posts and artifacts |

## 4. Implementation Phases

### Phase 1: Foundation (The Skeleton)
- Setup Node.js project and PostgreSQL database.
- Implement Prisma schema and migrations.
- Create basic API structure and health checks.

### Phase 2: Content Integration (The Flesh)
- Build the `GET` endpoints for Posts and Artifacts.
- Convert static HTML pages into a simple Single Page Application (SPA) or use a lightweight router to replace `href="#"` with actual paths.
- Replace hard-coded content in `grim_chronicles` and `the_vault` with `fetch()` calls.

### Phase 3: Interaction & Transmission (The Spirit)
- Implement the `POST /inquiries` endpoint.
- Connect the `inquiries` form to the backend, replacing the `setTimeout` alert with real API calls.
- Implement the Artifact Modal logic to fetch data based on the clicked item.

### Phase 4: Refinement & Polish (The Shroud)
- Implement global search functionality.
- Add an admin interface (simple protected routes) for adding/editing content.
- Performance optimization (caching, image optimization).
- Final deployment and environment configuration.

## 5. Testing Strategy
- **Unit Tests:** Jest for API logic and validation.
- **Integration Tests:** Supertest for endpoint verification.
- **End-to-End (E2E):** Playwright to verify that clicking a "Vault" item opens the correct modal with correct data.
