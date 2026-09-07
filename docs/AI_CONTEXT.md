# AI Quick Context — Ekos Project Tracker Server

> **Purpose:** This file provides AI assistants with fast orientation to the codebase.
> Read this file FIRST when working on this project.

---

## What Is This Project?

A **REST API server** for managing environmental services projects (waste management, permits, sampling schedules) for Ekos Green Group, a Serbian environmental company. Built with **Express 5 + TypeScript + Prisma + PostgreSQL**.

---

## Quick File Map

### Core Boot Files
| File | Purpose | Key Exports |
|---|---|---|
| `src/index.ts` | Entry point. Starts HTTP server on `PORT` (default 3001). Handles graceful shutdown. | — |
| `src/app.ts` | Express app factory. Mounts all middleware and routes. | `createApp()` |
| `src/db.ts` | Prisma + pg Pool setup. Single source of database connection. | `prisma` |
| `src/types.ts` | `UserRole` enum, `isAdminOrManager()`, `canManageInvoices()` | `UserRole`, `isAdminOrManager`, `canManageInvoices` |
| `src/authUtils.ts` | JWT sign/verify, bcrypt hash/verify, temp password generation | `hashPassword`, `verifyPassword`, `generateToken`, `verifyToken`, `generateTempPassword` |

### Middleware (`src/middleware/`)
| File | Purpose | Key Exports |
|---|---|---|
| `auth.ts` | JWT auth resolution, `requireAuth` middleware, online-status tracking, force-logout, impersonation | `requireAuth`, `getAuthUser`, `userActivityMap`, `userForceLogoutMap` |
| `errorHandler.ts` | `asyncHandler` wrapper + global error handler (Prisma P2002/P2025) | `asyncHandler`, `errorHandler` |
| `validate.ts` | `sanitizeString()`, `validatePassword()` | `sanitizeString`, `validatePassword` |

### Route Files (`src/routes/`)

Every route file follows the same pattern:
1. Creates `Router()`
2. Applies `router.use(requireAuth)` (except auth routes)
3. Defines CRUD endpoints wrapped in `asyncHandler`
4. Checks roles inline with `isAdminOrManager` etc.

| File | Mount Path | Purpose |
|---|---|---|
| `auth.routes.ts` | `/api/auth` | Login, register, /me. Login/register are public. |
| `users.routes.ts` | `/api/users` | User CRUD, approve/reject, force-logout. Admin/Manager write. |
| `projects.routes.ts` | `/api/projects` | Project CRUD, toggle-done, sample-advance. Owner or Admin/Manager write. |
| `clients.routes.ts` | `/api/clients` | Client CRUD with permit linking via `ClientExtraData`. Admin/Manager write. |
| `invoices.routes.ts` | `/api/invoices` | Invoice CRUD with line items (`InvoiceItem`). Admin/Manager/Accountant write. |
| `services.routes.ts` | `/api/services` | Service type definitions. Admin/Manager write. |
| `categories.routes.ts` | `/api/categories` | Category CRUD. Admin/Manager write. |
| `providedServices.routes.ts` | `/api/provided-services` | Service delivery records. Validates FK references. Admin/Manager write. |
| `reminders.routes.ts` | `/api/reminders` | Reminders/tasks linked to project/client/permit. Owner or Admin/Manager write. |
| `permits.routes.ts` | `/api/permits` | Permit CRUD with waste catalog junction. Admin/Manager write. |
| `wasteCatalog.routes.ts` | `/api/waste-catalog` | Serbian waste index catalog. Auto-seeds. Supports pagination. Admin/Manager write. |
| `notifications.routes.ts` | `/api/notifications` | User notifications from @mentions. Own notifications only. |
| `companyInfo.routes.ts` | `/api/company-info` | Singleton company record. Admin/Manager write. |
| `preferences.routes.ts` | `/api/preferences` | Per-user key-value settings. Own preferences only. |
| `stats.routes.ts` | `/api/projects/stats` | Dashboard aggregate counts. No auth. |

### Helper Utilities (`src/helpers/`)
| File | Purpose |
|---|---|
| `dateUtils.ts` | `addMonths()`, `daysUntil()`, `isStale()` — date arithmetic for project scheduling |
| `mentionHelper.ts` | `extractMentionedUserIds()`, `handleProjectNotesMentions()` — parses @mentions from HTML notes, creates Notification records |
| `prismaErrors.ts` | `handlePrismaError()` — legacy inline Prisma error handler (mostly superseded by global errorHandler) |

### Import Scripts (standalone, run via `npm run`)
| File | Command | What it does |
|---|---|---|
| `importClientsCsv.ts` | `npm run db:import-clients` | Upserts clients from `import-export/Client.csv` |
| `importWasteCatalogCsv.ts` | `npm run db:import-waste-catalog` | Upserts waste catalog from `import-export/dozvole_indeksi.csv` |
| `importWasteDisposalExcel.ts` | `npm run db:import-waste` | Imports waste disposal data from Excel |
| `seed.ts` | `npm run db:seed` | Seeds initial database data |

### Database Schema
| File | Purpose |
|---|---|
| `prisma/schema.prisma` | **Source of truth** for all database models. 16 models. PostgreSQL. Uses UUID primary keys. |
| `prisma.config.ts` | Prisma config — loads env vars for `DATABASE_URL` |

---

## Key Patterns & Conventions

### Adding a New Route
1. Create `src/routes/<entity>.routes.ts`
2. Follow the pattern: `Router()` → `router.use(requireAuth)` → `asyncHandler(async (req, res) => {...})`
3. Import and mount in `src/app.ts` under `createApp()`
4. Add model to `prisma/schema.prisma`, run `npx prisma migrate dev --name <name>`

### Adding a New Model
1. Define in `prisma/schema.prisma` with proper indexes and relations
2. Run migration: `npm run migrate:dev -- --name <name>`
3. The `prisma` export from `src/db.ts` auto-includes the new model

### Auth Pattern
```typescript
import { requireAuth } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';
import { isAdminOrManager } from '../types';

const router = Router();
router.use(requireAuth);

router.post('/', asyncHandler(async (req, res) => {
  if (!isAdminOrManager(req.authUser!.role)) {
    res.status(403).json({ error: 'Permission denied.' });
    return;
  }
  // ... handler logic
}));
```

### Search Pattern
Most GET list endpoints support `?search=` with Prisma `contains`:
```typescript
const search = ((req.query.search as string) || '').trim();
const where = search ? {
  OR: [
    { name: { contains: search, mode: 'insensitive' as const } },
    // ...more fields
  ]
} : {};
```

### Error Handling Pattern
- Wrap handlers in `asyncHandler()` — forwards rejections to error middleware
- Global `errorHandler` catches Prisma P2002 (→400) and P2025 (→404)
- Inline validation returns `res.status(400).json({ error: '...' })` and `return`

---

## Database Schema Quick Reference

> See [`DATA_RELATIONSHIP_MODEL.md`](DATA_RELATIONSHIP_MODEL.md) for full ERD, field constraints, cascade rules, and domain walkthroughs.

### Core Business Entities
- **Project** — central entity. Links to Client, User (responsible), has Reminders, Invoices, ProvidedServices
- **Client** — company clients. Has ClientExtraData for permit linking
- **Invoice** + **InvoiceItem** — billing. Invoice has line items
- **Service** — service type definitions (with frequency for sampling)
- **ProvidedService** — individual service delivery records

### Permit/Waste System
- **Permit** — environmental permits with date ranges
- **WasteCatalog** — Serbian waste index (code, description, hazardous flag)
- **PermitWaste** — junction table: which waste types a permit covers
- **ClientExtraData** — links a client to their permit

### User System
- **User** — roles: Administrator, Manager, User, Accountant
- **UserPreference** — KV store per user (unique userId+key)
- **Notification** — @mention notifications

### Other
- **Category** — project categories
- **CompanyInfo** — singleton with company legal details
- **Reminder** — tasks linked to projects/clients/permits/users

---

## Common Commands

```bash
# Development
npm run dev                    # Start dev server (hot-reload)
npm run dev:local              # Start with .env.localhost
npm run build                  # Build for production

# Database
npm run migrate:dev -- --name <name>   # Create new migration
npm run migrate:deploy                  # Apply migrations
npm run db:push                         # Push schema without migration
npm run db:seed                         # Seed database

# Import data
npm run db:import-clients              # Import clients from CSV
npm run db:import-waste-catalog        # Import waste catalog from CSV
npm run db:import-waste                # Import waste disposal from Excel

# Release
npm run release:patch          # Bump patch version
npm run release:minor          # Bump minor version
npm run release:major          # Bump major version
```

---

## Environment Variables

| Variable | Required | Default | Notes |
|---|---|---|---|
| `DATABASE_URL` | **Yes** | — | PostgreSQL connection string |
| `JWT_SECRET` | Production | dev fallback | Signing key for JWT tokens |
| `PORT` | No | `3001` | Server port |
| `DB_POOL_MAX` | No | `10` | Connection pool size |
| `JWT_EXPIRES_IN` | No | `9h` | Token expiry |

---

## Gotchas & Important Notes

1. **Dates are strings** — stored as `String` type (ISO `YYYY-MM-DD`), not Prisma `DateTime`. Only `createdAt`/`updatedAt` are actual timestamps.
2. **X-User-Id fallback** — The auth middleware has a legacy fallback that trusts `X-User-Id` header without JWT. Marked for removal in "Phase 3". Security risk.
3. **Stats route has no auth** — `GET /api/projects/stats` is mounted before the auth-protected project routes, so it's publicly accessible.
4. **Waste catalog auto-seeds** — The `GET /api/waste-catalog` endpoint auto-seeds ~50 entries on first call if table is empty.
5. **Invoice items are replaced** — `PUT /api/invoices/:id` with `items` array deletes all existing items and re-creates them (inside a transaction).
6. **Online status is in-memory** — `userActivityMap` is process-local. Resets on server restart. Not suitable for multi-instance deployments.
7. **Password never returned** — All user endpoints destructure out the `password` field before responding.
8. **Manager < Administrator** — Managers cannot create, modify, or delete Administrator accounts, nor assign the Administrator role.
