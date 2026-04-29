# Insighta Labs+

Secure, multi-interface Profile Intelligence Platform built for Stage 3 of the Insighta Labs backend engineering track.

---

## Stack

| Layer | Tech |
|-------|------|
| Backend | Node.js · Express · Prisma · MySQL |
| CLI | Node.js · Commander · Chalk · ora |
| Web portal | React · Vite · React Router |
| Auth | GitHub OAuth · JWT · HTTP-only cookies |
| Database | MySQL 8 + Prisma ORM |

---

## Repositories

```
insighta-backend/   REST API, auth, RBAC, database
insighta-cli/       Global CLI tool (insighta)
insighta-web/       React web portal
```

---

## File Structure

```
insighta-backend/
├── prisma/
│   ├── schema.prisma             # Users, RefreshTokens, Profiles
│   ├── seed.js                   # Seeds 2026 profiles with UUID v7
│   └── seed_profiles.json        # Real seed data — 2026 profiles, 65 countries
├── src/
│   ├── config/
│   │   └── prisma.js             # Prisma client singleton
│   ├── middleware/
│   │   ├── requireAuth.js        # JWT validation → attaches req.user
│   │   ├── apiVersion.js         # Rejects missing X-API-Version: 1
│   │   ├── rateLimiter.js        # Isolated MemoryStore limiters (dev/prod aware)
│   │   └── logger.js             # Request logger + global error handler
│   ├── routes/
│   │   ├── auth.js               # /auth/github · /callback · /refresh · /logout
│   │   └── profiles.js           # /api/profiles CRUD + search + export
│   ├── services/
│   │   ├── authService.js        # Token generation, rotation, GitHub exchange
│   │   └── profileService.js     # Calls genderize / agify / nationalize APIs
│   ├── utils/
│   │   ├── queryBuilder.js       # Builds Prisma where + orderBy from query params
│   │   └── pagination.js         # HATEOAS pagination links
│   └── index.js                  # Express app entry point
├── .env.example
├── .github/workflows/ci.yml
└── package.json

insighta-cli/
├── bin/
│   └── insighta.js               # Global binary entry point
├── src/
│   ├── commands/
│   │   ├── auth.js               # login (local callback server), logout, whoami
│   │   └── profiles.js           # list, get, search, create, export
│   └── utils/
│       ├── api.js                # Token storage, auto-refresh, authenticated fetch
│       └── display.js            # cli-table3 table rendering + pagination display
├── .github/workflows/ci.yml
└── package.json

insighta-web/
├── src/
│   ├── pages/
│   │   ├── Login.jsx             # GitHub OAuth entry
│   │   ├── Dashboard.jsx         # Metrics overview
│   │   ├── ProfileList.jsx       # Filterable, paginated profiles table
│   │   ├── ProfileDetail.jsx     # Single profile view
│   │   ├── Search.jsx            # Natural language search
│   │   └── Account.jsx           # User info + logout
│   ├── components/layout/
│   │   ├── Layout.jsx            # Sidebar + nav shell
│   │   └── Layout.module.css
│   ├── context/
│   │   └── AuthContext.jsx       # useAuth() — session state + refetchUser
│   ├── lib/
│   │   └── api.js                # Fetch wrapper, silent refresh, ApiError
│   ├── App.jsx                   # Router + ProtectedRoute
│   ├── main.jsx
│   └── index.css
├── index.html
├── vite.config.js                # Dev proxy → :4000, Set-Cookie rewrite
├── .github/workflows/ci.yml
└── package.json
```

---

## 1. Backend Setup

### Prerequisites
- Node.js 18+
- MySQL 8 running locally
- GitHub OAuth App

### Create the database
```sql
CREATE DATABASE insighta_labs;
```

### Create a GitHub OAuth App
1. Go to [github.com/settings/developers](https://github.com/settings/developers) → **New OAuth App**
2. **Homepage URL**: `http://localhost:4000`
3. **Authorization callback URL**: `http://localhost:4000/auth/github/callback`
4. Copy the **Client ID** and **Client Secret**

### Install and configure
```bash
cd insighta-backend
npm install
cp .env.example .env
```

Edit `.env` and fill in every value:

```env
DATABASE_URL="mysql://root:password@localhost:3306/insighta_labs"

PORT=4000
NODE_ENV=development

# Generate with: node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
JWT_SECRET="your_64_byte_hex_string"
ACCESS_TOKEN_EXPIRY="3m"
REFRESH_TOKEN_EXPIRY_MS=300000

GITHUB_CLIENT_ID="your_github_client_id"
GITHUB_CLIENT_SECRET="your_github_client_secret"
GITHUB_CALLBACK_URL="http://localhost:4000/auth/github/callback"

FRONTEND_URL="http://localhost:5173"

# Generate separately from JWT_SECRET
COOKIE_SECRET="another_64_byte_hex_string"
```

### Database setup
```bash
npm run db:generate    # generate Prisma client
npm run db:migrate     # create all tables
npm run db:seed        # insert 2026 profiles (safe to re-run — upserts on name)
```

### Start
```bash
npm run dev     # nodemon — auto-restarts on file changes
npm start       # production
```

Verify:
```bash
curl http://localhost:4000/health
# {"status":"ok"}
```

---

## 2. CLI Setup

### Prerequisites
- Backend running at `http://localhost:4000`

### Install
```bash
cd insighta-cli
npm install
npm link    # registers `insighta` as a global command
```

### Point at a deployed backend (optional)
```bash
export INSIGHTA_API_URL="https://your-backend.com"
# Add to ~/.zshrc or ~/.bashrc to make permanent
```

### Commands

#### Auth
```bash
insighta login       # opens GitHub in browser, stores tokens at ~/.insighta/credentials.json
insighta whoami      # print current user and role
insighta logout      # revoke session server-side and clear local credentials
```

#### Profiles
```bash
# List with filters
insighta profiles list
insighta profiles list --gender male
insighta profiles list --country NG
insighta profiles list --age-group adult
insighta profiles list --min-age 25 --max-age 40
insighta profiles list --sort-by age --order desc
insighta profiles list --page 2 --limit 20

# Get by ID
insighta profiles get <id>

# Natural language search
insighta profiles search "young females from ghana"
insighta profiles search "senior males in the US"

# Create (admin only)
insighta profiles create --name "Harriet Tubman"

# Export CSV to current directory
insighta profiles export --format csv
insighta profiles export --format csv --gender female --country NG
```

### How CLI auth works
1. `insighta login` starts a local HTTP server on a random port
2. Opens `http://localhost:4000/auth/github?cli=1&cli_port=<port>` in the browser
3. GitHub redirects back to the backend callback
4. Backend issues tokens and redirects to the local server with them as query params
5. CLI stores tokens at `~/.insighta/credentials.json`

Tokens auto-refresh silently. If the refresh token also expires, the CLI prompts you to run `insighta login` again.

---

## 3. Web Portal Setup

### Prerequisites
- Backend running at `http://localhost:4000`

### Install and run
```bash
cd insighta-web
npm install
npm run dev     # → http://localhost:5173
```

All `/auth` and `/api` requests are proxied to `localhost:4000` via Vite's dev proxy — no CORS issues, cookies work correctly.

### Pages

| Route | Description | Auth |
|-------|-------------|------|
| `/login` | GitHub OAuth login | Public |
| `/dashboard` | Metrics — total profiles, by gender, by country | Required |
| `/profiles` | Filterable, paginated profiles table | Required |
| `/profiles/:id` | Profile detail view | Required |
| `/search` | Natural language search | Required |
| `/account` | Current user info + sign out | Required |

### How web auth works
- After GitHub login, the backend sets two HTTP-only cookies: `access_token` and `refresh_token`
- The Vite proxy rewrites `Set-Cookie` headers so cookies are scoped to `localhost:5173`
- Every API request sends `credentials: 'include'` to attach the cookies automatically
- On 401 (expired access token), the client silently calls `/auth/refresh` to rotate tokens, then retries
- If the refresh token is also expired, the user is redirected to `/login`

---

## API Reference

### Auth endpoints

| Method | Path | Rate limit | Description |
|--------|------|------------|-------------|
| `GET` | `/auth/github` | 500/min dev · 60/min prod | Redirect to GitHub OAuth |
| `GET` | `/auth/github/callback` | 500/min dev · 60/min prod | Handle OAuth callback, set cookies |
| `GET` | `/auth/me` | 500/min dev · 60/min prod | Return current user from token |
| `POST` | `/auth/refresh` | 100/min dev · 10/min prod | Rotate refresh token → new pair |
| `POST` | `/auth/logout` | 100/min dev · 10/min prod | Revoke refresh token server-side |

### Profile endpoints

All `/api/*` requests require:
- `Authorization: Bearer <token>` (CLI) **or** `access_token` cookie (web)
- `X-API-Version: 1` header

| Method | Path | Role | Description |
|--------|------|------|-------------|
| `GET` | `/api/profiles` | analyst+ | List profiles with filters, sort, pagination |
| `GET` | `/api/profiles/search?q=` | analyst+ | Natural language search |
| `GET` | `/api/profiles/export?format=csv` | analyst+ | Download filtered CSV |
| `GET` | `/api/profiles/:id` | analyst+ | Get single profile |
| `POST` | `/api/profiles` | admin only | Create profile via external APIs |
| `DELETE` | `/api/profiles/:id` | admin only | Delete profile |

### Query params

| Param | Example | Notes |
|-------|---------|-------|
| `gender` | `male` \| `female` | |
| `age_group` | `child` \| `teenager` \| `adult` \| `senior` | |
| `country_id` | `NG` \| `US` \| `GB` | ISO 3166-1 alpha-2 |
| `min_age` | `25` | Inclusive |
| `max_age` | `40` | Inclusive |
| `sort_by` | `age` \| `name` \| `created_at` \| `gender` \| `country_id` | Default: `created_at` |
| `order` | `asc` \| `desc` | Default: `desc` |
| `page` | `1` | Default: `1` |
| `limit` | `20` | Default: `10` · Max: `100` |

### Paginated response shape

```json
{
  "status": "success",
  "page": 1,
  "limit": 10,
  "total": 2026,
  "total_pages": 203,
  "links": {
    "self": "/api/profiles?page=1&limit=10",
    "next": "/api/profiles?page=2&limit=10",
    "prev": null
  },
  "data": []
}
```

### Error response shape

```json
{
  "status": "error",
  "message": "Description of what went wrong"
}
```

---

## Token Lifecycle

| Token | Format | Expiry | Where stored |
|-------|--------|--------|--------------|
| Access token | Signed JWT (`sub`, `role`, `is_active`) | 3 minutes | `Authorization` header (CLI) · `access_token` cookie (web) |
| Refresh token | Opaque random string | 5 minutes | SHA-256 hash in `refresh_tokens` table |

- **Refresh**: old token revoked immediately, new pair issued (rotation)
- **Logout**: refresh token revoked server-side, cookies cleared
- **Disabled account** (`is_active = false`): all requests return `403`

---

## Roles

| Role | Read / Search / Export | Create | Delete |
|------|----------------------|--------|--------|
| `admin` | ✅ | ✅ | ✅ |
| `analyst` | ✅ | ❌ | ❌ |

All new GitHub OAuth users are assigned `analyst` by default.

**To promote a user to admin:**
```sql
UPDATE users SET role = 'admin' WHERE username = 'your_github_username';
```

---

## Database Schema

```
users
  id                VARCHAR(36)    UUID v7 — generated in app code (not Prisma default)
  github_id         VARCHAR(64)    Unique
  username          VARCHAR(128)
  email             VARCHAR(256)   Nullable
  avatar_url        VARCHAR(512)   Nullable
  role              ENUM           admin | analyst  (default: analyst)
  is_active         BOOLEAN        false → 403 on all requests
  last_login_at     TIMESTAMP      Updated on every login
  created_at        TIMESTAMP

refresh_tokens
  id                VARCHAR(36)    UUID v4
  user_id           VARCHAR(36)    FK → users.id (cascade delete)
  token_hash        VARCHAR(256)   SHA-256 of raw token — never store raw
  expires_at        TIMESTAMP
  revoked           BOOLEAN
  created_at        TIMESTAMP

profiles
  id                VARCHAR(36)    UUID v7 — generated in app code
  name              VARCHAR(256)   Unique
  gender            VARCHAR(16)
  gender_probability FLOAT
  age               INT
  age_group         VARCHAR(16)    child | teenager | adult | senior
  country_id        VARCHAR(2)     ISO 3166-1 alpha-2
  country_name      VARCHAR(128)
  country_probability FLOAT
  created_at        TIMESTAMP

Indexes on profiles:
  - gender
  - age_group
  - country_id
  - age
  - (gender, country_id)     ← compound: most common filter combination
  - (country_id, age)        ← compound: age-range queries scoped to country
```

---

## Rate Limits

| Limiter | Endpoints | Development | Production |
|---------|-----------|-------------|------------|
| `authRateLimiter` | `/auth/refresh` · `/auth/logout` | 100 req/min | 10 req/min |
| `rateLimiter` | everything else | 500 req/min | 60 req/min |

Each limiter has its own isolated `MemoryStore` with namespaced keys (`auth_` / `general_`) to prevent counter bleed between limiters.

---

## CI/CD

Each repo has `.github/workflows/ci.yml` that runs on every PR to `main`.

| Repo | Steps |
|------|-------|
| Backend | install → generate Prisma → migrate (test DB) → lint → test |
| CLI | install → lint → `insighta --version` |
| Web | install → lint → `vite build` |

---

## Known Fixes Applied During Development

| Issue | Fix |
|-------|-----|
| `fast-csv` named import error | Switched to `import fastCsv from 'fast-csv'` (CommonJS default) |
| `ipKeyGenerator` not exported by `express-rate-limit` v7 | Replaced with manual `normalizeIp()` helper |
| `errorHandler` import pointed to non-existent file | Both `requestLogger` and `errorHandler` live in `logger.js` |
| `uuidv7` wrong export name | Changed `{ v7 as uuidv7 }` to `{ uuidv7 }` |
| `sameSite: 'strict'` blocked OAuth redirect cookies | Changed to `sameSite: 'lax'` |
| `/auth/me` getting 429 from auth rate limiter | Moved to standalone route with general rate limiter |
| `/auth/github` getting 429 | Strict limiter now only covers `/auth/refresh` and `/auth/logout` |
| Rate limiters sharing counters | Each limiter given its own `new MemoryStore()` instance |
| Cross-origin cookies not persisting | Vite proxy rewrites `Set-Cookie` headers to strip domain and secure |
| Silent refresh causing page reload loop | Throw `ApiError` instead of `window.location.href` redirect |

---

## Commit Convention

```
feat(auth): add github oauth flow
feat(cli): add profiles export command
fix(api): correct fast-csv commonjs import
fix(middleware): use isolated MemoryStore per rate limiter
fix(auth): change sameSite from strict to lax for oauth
fix(web): throw ApiError instead of redirecting on refresh failure
chore(db): add compound indexes to profiles table
chore(seed): switch to real seed_profiles.json
```

Scopes: `auth` · `api` · `cli` · `web` · `db` · `middleware` · `seed`