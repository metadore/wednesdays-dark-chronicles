# Project Audit: Wednesday's Dark Chronicles

## 1. Frontend Framework & Technology Stack
- **Language:** HTML5, CSS3, JavaScript (Vanilla).
- **Styling:** Tailwind CSS (via CDN script `https://cdn.tailwindcss.com`).
- **Typography:** 
  - Serif: Libre Caslon Text (Headlines).
  - Sans: Inter (Body).
  - Mono: Geist (Labels/Technical).
- **Icons:** Material Symbols Outlined.
- **Design System:** Custom "Gothic Minimalist" (monochrome gloom, high contrast, 0px border radius, hard shadows).

## 2. Project Folder Structure
```
stitch_wednesday_s_dark_chronicles/
├── grim_chronicles/
│   ├── code.html
│   └── screen.png
├── home_the_void/
│   ├── code.html
│   └── screen.png
├── inquiries/
│   ├── code.html
│   └── screen.png
├── obsidian_ink/
│   └── DESIGN.md
├── the_vault/
│   ├── code.html
│   └── screen.png
└── the_vault_artifact_modal_view/
    ├── code.html
    └── screen.png
```

## 3. Pages, Components, & Navigation
- **Pages:**
  - `home_the_void` (Landing/Main portal).
  - `grim_chronicles` (Blog/Journal feed).
  - `the_vault` (Portfolio/Archive).
  - `inquiries` (Contact/Transmission page).
- **Navigation:** 
  - Desktop: Fixed left-hand sidebar.
  - Mobile: Top app bar and bottom navigation bar.
- **Components:**
  - Grain Overlay (atmospheric texture).
  - Hard-shadow cards.
  - Custom modal for artifacts (in `the_vault_artifact_modal_view`).
  - Minimalist contact form.

## 4. Interactive Elements & User Flows
- **Interactions:**
  - Mouse-over scale and hard-shadow effects on article cards.
  - Modal transitions for viewing artifacts.
  - Form submission animation (placeholder `DISSOLVING...` state).
- **User Flows:**
  - Home -> Blog/Vault/Contact.
  - Vault -> Artifact Modal view.
  - Contact -> Submit Inquiry.

## 5. API Calls & Backend Services
- **Current State:** None.
- All interactivity is currently handled by client-side JavaScript or static HTML links.

## 6. Database & Models
- **Current State:** None.
- Data (blog posts, portfolio items) is hard-coded in HTML.

## 7. Authentication & Authorization
- **Current State:** None.

## 8. Environment Variables & Configuration
- **Current State:** None.
- Configuration is embedded in Tailwind `tailwind.config` script blocks within each HTML file.

## 9. Dependencies & Package Manager
- **Dependencies:** External CDNs (Tailwind, Google Fonts).
- **Package Manager:** None (no `package.json` or `requirements.txt`).

## 10. Missing Functionality & Incomplete Implementations
- **Dynamic Content:** Blog posts, portfolio items, and archives are static.
- **Form Handling:** The `inquiries` form uses a `setTimeout` alert; it does not transmit data to a server.
- **Routing:** Navigation links are currently placeholders (`href="#"`).
- **Search:** The search input is purely visual.
- **State Management:** No persistent state or user session.

## 11. Security & Deployment Concerns
- **Frontend:** Use of CDN scripts for Tailwind is fine for prototyping but should be bundled for production.
- **Security:** No backend currently exists, so no server-side vulnerabilities, but the lack of input validation on the frontend form is noted.
- **Deployment:** Currently a set of disconnected HTML files. Needs a proper routing structure (SPA or SSR).

## 12. Recommended Backend Architecture
- **Architecture:** Headless API (REST or GraphQL).
- **Reasoning:** The design is highly specific and needs to be preserved. A decoupled backend allows for content updates (posts, artifacts) without touching the sensitive CSS/HTML layout.
- **CMS:** A lightweight CMS or simple database to manage "Chronicles" (Blog) and "Vault" (Portfolio) entries.
