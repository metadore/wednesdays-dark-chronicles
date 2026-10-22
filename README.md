# 🖤 WEDNESDAY'S DARK CHRONICLES 🖤

*THE ARCHIVE IS OPEN. YOU WERE NEVER INVITED.*

```text
             🕯️  "I don't believe in heaven or hell.
    I believe in revenge, dark humor, and immaculate backend architecture." 🕯️
```

## 🖤 00. A NOTE FROM WEDNESDAY ADDAMS

> *"If you found this repository, congratulations. You’ve taken your first step into a trap. Nobody remembers creating the first entry—much like my interest in human emotions, it simply manifested one dark, storm-plagued night.*
>
> *They attempted to close it. The archive resisted.*
>
> *They attempted to delete it. The code resurrected.*
>
> *So we did the only logical thing left: we chained it to an API and gave it a web interface. **Wednesday's Dark Chronicles** is a gothic web experience forged from dark stories, cursed artifacts, branching narratives, and an administrative grimoire hidden behind a locked door. The aesthetic is deliberately morbid. The secrets are lethal.*
>
> *Read on, if you insist. But don't expect a happy ending."*

---

## 🕸️ 01. THE DIRECTORY OF DOOM

| **Location**             | **What Awaits Your Demise**                                                     |
| ------------------------ | ------------------------------------------------------------------------------- |
| 🕸️ **The Void**         | Enter the homepage. Decide whether you possess the courage to continue.         |
| 📜 **Grim Chronicles**   | Explore our curated collection of dark tales, literary poison, and curiosities. |
| 🗝️ **The Vault**        | Uncover our restricted archives of mysterious artifacts and cursed records.     |
| 🩸 **Branching Stories** | Make choices. Suffer the consequences. Walk branching paths to your doom.       |
| 🕯️ **The Reading Room** | Return to your bookmarked progress... if your memory hasn't failed you.         |
| ✉️ **The Confessional**  | Send a message into the abyss. Thing might read it. I probably won't.           |
| ☠️ **The Grimoire**      | The restricted admin interface. Unauthorized entry will be met with execution.  |

```text
                       [ INSERT SVG: gothic-door-icon.svg ]

                       "Not every door is meant to be opened."
```

---

## 🦇 02. THE GOTHIC AESTHETIC

*"This is not another generic pastel dashboard wearing a cheap black coat. Color gives me hives."*

The visual identity of this archive is built around gothic minimalism, dark literary atmosphere, and the distinct sensation of browsing an ancient mausoleum after midnight:

* **Dark, Deliberate Visuals:** A restrained monochrome palette, blood-toned contrast, and atmospheric shadows.
* **Literary Presentation:** Stories and artifacts are treated as ancient discoveries, not disposable content cards.
* **Interactive Exploration:** Bookmark your favorite horrors and save your exact reading progress.
* **Hidden Administrative Grimoire:** Public storytelling and private content management occupy strictly isolated, protected realms.
* **Atmosphere Without Clutter:** Unsettling by design, yet surgically precise to navigate.

---

## 📖 03. WHAT LIVES INSIDE THE CRYPT

### 🕯️ The Public Archive

* **Homepage & Navigation:** Minimal, dark, and lingering with dreadful anticipation.
* **Story Listing & Categorization:** Filterable dark literature with full search and pagination.
* **Artifact Vault:** Interactive artifact modal views with historical, eerie documentation.
* **Branching Narratives:** Interactive decision trees where every choice carries a price.
* **Comments & Replies:** Reader reactions, held in moderation quarantine prior to public display.
* **Bookmarks & Progress:** Reader state persistence through localized storage engines.

```text
                       [ INSERT SVG: skull-divider-icon.svg ]
```

### ☠️ The Grimoire (Administrative Interface)

Behind administrative authentication lies a hidden nerve center. Its capabilities include:

* **Administrative Authentication:** JWT-based protection with strictly guarded session tokens.
* **Dashboard Overview:** System health, incoming reader feedback, and content analytics.
* **Content Management:** Full CRUD operations for Chronicles, Artifacts, and Categories.
* **Comment Moderation:** Purge unwanted noise before it taints the archive public display.
* **Branching Story Builder:** Administer narrative nodes and complex decision branches.

---

## 🗝️ 04. THE MACHINERY BEHIND THE MONSTER

*"The archive may look haunted by Victorian ghosts, but its infrastructure relies on ruthless engineering."*

| **Component**        | **Technology**                         |
| -------------------- | -------------------------------------- |
| **Frontend**         | HTML5, CSS3, JavaScript (ES6+)         |
| **Styling**          | Tailwind CSS                           |
| **Backend**          | Node.js, Express.js                    |
| **Database**         | PostgreSQL                             |
| **ORM**              | Prisma                                 |
| **Auth**             | JWT (HTTP-Only Cookies)                |
| **Protection**       | CSRF Token Controls, Helmet Middleware |
| **Testing**          | Mocha & Chai                           |
| **Containerization** | Docker Compose                         |

```text
                       [ INSERT SVG: raven-crest-icon.svg ]
```

---

## 🩸 05. MAP OF THE MAUSOLEUM

```text
wednesdays-dark-chronicles/
│
├── backend/
│   ├── prisma/                 # Database schema & migrations
│   ├── scripts/                # Administrative setup & utility tools
│   ├── src/
│   │   ├── controllers/        # Express request handling logic
│   │   ├── lib/                # Shared utilities & cryptographic helpers
│   │   ├── middleware/         # Security, CSRF, and JWT verification
│   │   ├── routes/             # Protected and public API routes
│   │   └── app.js              # Express app bootstrap
│   ├── tests/                  # Automated unit, security, and integration tests
│   ├── package.json
│   └── .env.example            # Environment configuration blueprint
│
├── bookmarks/                  # Reading bookmark interface
├── branching_stories/          # Interactive narrative mechanics
├── grim_chronicles/            # Story reader and listing pages
├── home_the_void/              # Homepage experience
├── inquiries/                  # Confessional contact form
├── public/
│   └── admin/                  # The Grimoire (Admin Interface)
├── the_vault/                  # Artifact archive view
├── obsidian_ink/               # Design systems & architectural documentation
├── reports/                    # Security, audit, and deployment logs
├── reader-config.js            # Reading preferences configuration
├── docker-compose.yml          # Local database containerization
└── README.md                   # You are suffering here.
```

---

## 🕯️ 06. AWAKENING THE ARCHIVE LOCALLY

*"I usually prefer torture, but setting up this environment is fairly straightforward."*

### Prerequisites

* Node.js (v18+ recommended)
* Git
* PostgreSQL local instance or Docker Desktop

### Step 1: Clone the Repository

```bash
git clone https://github.com/metadore/wednesdays-dark-chronicles.git
cd wednesdays-dark-chronicles
```

### Step 2: Configure the Backend Environment

```bash
cd backend
npm install
```

Copy the example environment template:

**PowerShell**

```powershell
# On Windows (PowerShell)
Copy-Item .env.example .env

# On Linux / macOS
cp .env.example .env
```

Open `.env` and configure your database credentials.

> ⚠️ **Warning from Wednesday:** *Never commit your real `.env` file to version control. I will know, and Thing will find you.*

### Step 3: Spawn PostgreSQL Container

If using Docker Compose:

```powershell
$env:DB_PASSWORD = "your_secret_password"
docker compose up -d db
```

### Step 4: Run Database Migrations

```bash
npx prisma migrate deploy
```

*(Optional) Seed the database with ancient tales:*

```bash
npx prisma db seed
```

### Step 5: Summon the Server

```bash
npm run dev
```

The backend API will wake at: `http://localhost:3000/api`

### Step 6: Serve the Frontend

Launch a local static server (e.g., Live Server in VS Code) from the project root. Expected origin: `http://127.0.0.1:5500/`

```text
                       [ INSERT SVG: poison-bottle-icon.svg ]
```

---

## ☠️ 07. THE GRIMOIRE: ADMIN ACCESS

The administrative sanctum is hidden at: `/public/admin/index.html`

> *"Before trying to force your way in, ensure an admin account has been provisioned via our CLI setup script. Administrative credentials are kept secret. If you publish keys, tokens, or passwords publicly, Lurch will handle your offboarding."*

---

## 🕯️ 08. THE TEST CHAMBER

Run the automated test suite to ensure nothing has broken:

```bash
cd backend
npm test
```

> ⚠️ *Never execute destructive test runs against live production databases unless you enjoy watching data vanish into thin air.*

```text
                       [ INSERT SVG: tombstone-footer-icon.svg ]
```

---

## 🦇 09. THE ARCHIVIST'S FINAL WARNING

1. **No Credentials in Version Control:** Keep private keys, tokens, and secrets out of Git.
2. **Review Deployment Directives:** Consult `reports/DEPLOYMENT.md` before publishing publicly.
3. **Respect Security Boundaries:** If you find a security hole, report it responsibly—don't make me hunt you down.

```text
             🕯️  "The archive remains open. You may leave whenever you like...
                          if you can find the exit." 🕯️
```
