# Functionality Matrix: Wednesday's Dark Chronicles

| Page / Component | Existing Functionality | Current Status | Required Backend Functionality | API Endpoints Needed | Database Requirements | Priority |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **The Void (Home)** | Static landing, nav links | Frontend-only | Content management for hero text/links | `GET /content/home` | Home page content table | Low |
| **Grim Chronicles (Blog)** | Static post grid, search bar (visual) | Frontend-only | CRUD for blog posts, search logic | `GET /posts`, `GET /posts/:id`, `GET /posts/search?q=` | Posts (Title, Date, Content, Image, Category) | High |
| **The Vault (Portfolio)** | Static artifact grid, category filters | Frontend-only | Content management for artifacts, filtering | `GET /artifacts`, `GET /artifacts?category=` | Artifacts (Name, Category, Image, Description, File) | High |
| **Artifact Modal** | Static detail view | Frontend-only | Fetch specific artifact details | `GET /artifacts/:id` | Linked to Artifacts table | Medium |
| **Inquiries (Contact)** | Visual form, placeholder JS submission | Frontend-only | Form submission handling, email notification | `POST /inquiries` | Inquiries (Name, Intent, Message, Timestamp) | High |
| **Navigation** | Link placeholders (`href="#"`) | Partially functional | Dynamic routing / URL mapping | N/A | N/A | High |
| **Search Bar** | Visual input | Completely missing | Full-text search across blog and vault | `GET /search?q=` | Indexing for Posts and Artifacts | Medium |
| **Footer** | Static links | Frontend-only | Dynamic link management | `GET /site-settings` | Site configuration table | Low |
