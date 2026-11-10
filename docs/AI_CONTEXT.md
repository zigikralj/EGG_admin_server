# AI Quick Context — Ekos Project Tracker Server

> **Purpose:** This file provides AI assistants with fast orientation to the codebase.
> Read this file FIRST when working on this project.

---

## What Is This Project?

A **REST API server** for managing environmental services projects (waste management, permits, reminders) for Ekos Green Group, a Serbian environmental company. Built with **Express 5 + TypeScript + Prisma + PostgreSQL**.

---

## Quick File Map

### Core Boot Files
| File | Purpose | Key Exports |
|---|---|---|
| `src/index.ts` | Entry point. Starts HTTP server on `PORT` (default 3001). Handles graceful shutdown. | — |
| `src/app.ts` | Express app factory. Mounts all middleware and routes. | `createApp()` |
| `src/db.ts` | Prisma + pg Pool setup + Prisma `$extends` audit wrapper (`auditedTransaction`, `ActivityLog` diff capture). | `prisma`, `basePrisma`, `auditedTransaction` |
| `src/context.ts` | `AsyncLocalStorage` request context propagating user/session/route metadata to Prisma extensions. | `requestContext`, `RequestContext` |
| `src/types.ts` | `UserRole` enum, `hasPermission()`, `isRestrictedToOwn()`, `isAdminOrManager()`, `canManageInvoices()` | `UserRole`, `hasPermission`, `isRestrictedToOwn`, `isAdminOrManager`, `canManageInvoices` |
| `src/authUtils.ts` | JWT sign/verify, bcrypt hash/verify, temp password generation | `hashPassword`, `verifyPassword`, `generateToken`, `verifyToken`, `generateTempPassword` |
| `src/constants/` | Centralized API routes (`apiRoutes.ts`), domain constants (`domain.ts`), error codes (`errorCodes.ts`), and permissions (`permissions.ts`) | `API_ROUTES`, `PRISMA_MODEL_TO_API_ROUTE`, `SYSTEM_SETTING_KEYS`, `ERROR_CODES` |

### Middleware (`src/middleware/`)
| File | Purpose | Key Exports |
|---|---|---|
| `auth.ts` | JWT auth resolution (header or `?token=` for SSE), `requireAuth` middleware, in-memory auth cache, force-logout | `requireAuth`, `getAuthUser`, `userForceLogoutMap`, `invalidateUserAuthCache` |
| `errorHandler.ts` | `asyncHandler` wrapper + global error handler (Prisma P2002/P2025) | `asyncHandler`, `errorHandler` |
| `validate.ts` | `sanitizeString()`, `validatePassword()` | `sanitizeString`, `validatePassword` |

### Route Files (`src/routes/`)

Every route file follows the same pattern:
1. Creates `Router()`
2. Applies `router.use(requireAuth)` (except public auth routes)
3. Defines CRUD endpoints wrapped in `asyncHandler`
4. Checks roles inline with `hasPermission(user, 'resource', 'action')` etc.

| File | Mount Path | Purpose |
|---|---|---|
| `auth.routes.ts` | `/api/auth` | Login, register, `/me`. Login/register are public. |
| `roles.routes.ts` | `/api/roles` | Dynamic role CRUD and granular permissions management. Admin only. |
| `users.routes.ts` | `/api/users` | Paginated user CRUD, lightweight `?fields=summary\|mention` directory queries, approve/reject, force-logout. Admin/Manager write. |
| `projects.routes.ts` | `/api/projects` | Paginated project CRUD, SQL-aggregated `/statistics`, note revisions/diffs, `/updates` feed, delta sync. Owner or Admin/Manager write. |
| `clients.routes.ts` | `/api/clients` | Paginated client CRUD with permit linking via `ClientExtraData`, summary mode, delta sync. Admin/Manager write. |
| `invoices.routes.ts` | `/api/invoices` | Paginated invoice CRUD with line items (`InvoiceItem`), parent/child invoices, status transitions, delta sync. Admin/Manager/Accountant write. |
| `services.routes.ts` | `/api/services` | Paginated/cached service type definitions and custom data models (`customDataModel`). Admin/Manager write. |
| `categories.routes.ts` | `/api/categories` | Category CRUD with reference caching. Admin/Manager write. |
| `providedServices.routes.ts` | `/api/provided-services` | Paginated service delivery records, waste disposal SQL statistics (`/statistics/waste` & `/statistics/waste/clients`), delta sync. Admin/Manager write. |
| `reminders.routes.ts` | `/api/reminders` | Paginated reminders/tasks linked to project/client/permit, quick filters (including incomplete/active), delta sync. Owner or Admin/Manager write. |
| `permits.routes.ts` | `/api/permits` | Paginated permit CRUD with waste catalog junction, summary mode, delta sync. Admin/Manager write. |
| `wasteCatalog.routes.ts` | `/api/waste-catalog` | Serbian waste index catalog. Delta sync, reference cache, pagination, favorite toggling, and delete. Admin/Manager write. |
| `history.routes.ts` | `/api/history` | Entity version timeline, diffs by version/date, snapshot inspection, and point-in-time restoration. |
| `chat.routes.ts` | `/api/chat` | Real-time messaging & contextual project chat: SSE `/stream`, `/unread-summary`, direct/group/contextual conversations, sequence-numbered messages, delta sync, @mentions, replies, mute, and Do Not Disturb (DND). |
| `notifications.routes.ts` | `/api/notifications` | User notifications from @mentions and chat. Own notifications only. |
| `systemSettings.routes.ts` | `/api/system-settings` | Global system settings (`waste_disposal_service_id`, etc.) with enriched waste disposal service lookup. Admin write. |
| `companyInfo.routes.ts` | `/api/company-info` | Singleton company record with reference caching. Admin/Manager write. |
| `preferences.routes.ts` | `/api/preferences` | Per-user key-value settings (theme, language, table columns, chat mute/DND). Own preferences only. |
| `activityLog.routes.ts` | `/api/activity-logs` | User session & audit activity logs. Batch ingestion, `/summary`, `/monthly-stats`, lazy diff loading, purge, and `/analytics` endpoint. |

### Services & Helper Utilities (`src/services/`, `src/helpers/`)
| File | Purpose |
|---|---|
| `src/services/chat/sseHub.ts` | `ChatSSEHub` managing per-user SSE connections, 25s heartbeat keepalives, online user presence broadcasting, and real-time chat/notification event delivery |
| `src/services/projectStatistics.service.ts` | Raw SQL aggregation engine for Project Tracker statistics (status counts, per-user load, category distribution, 12-month completion mountain chart, top clients by paid invoices) |
| `src/services/wasteStatistics.service.ts` | Raw SQL aggregation engine for Waste Disposal statistics (KPIs, dynamic `customDataModel` weight extraction in kg/tons, year-over-year monthly comparison series, and paginated client waste rankings) |
| `src/services/versioning.service.ts` | Entity version resolution, timeline aggregation, field-level diff calculation, and point-in-time entity restoration |
| `src/services/noteDelta.service.ts` | Delta-based note revision tracking, keyframe snapshots ('S') vs diff patches ('D'), character deltas, and note restoration |
| `src/services/activityAnalytics.service.ts` | Activity Analytics aggregation engine (KPIs, timelines, top pages, actions by entity, user usage, heatmap, session duration distribution, transitions, stickiness) |
| `src/helpers/pagination.ts` | Standardized server-side pagination parser (`parsePagination`) and response envelope builder (`buildPaginatedResponse`) |
| `src/helpers/deltaSync.ts` | Delta sync utilities: `parseSince()`, `fetchDeletedIds()` via `EntityVersion` tombstones (`op: 'D'`), `buildDeltaResponse()`, and `purgeOldEntityVersions()` (also purges old soft-deleted `ChatMessage` tombstones) |
| `src/helpers/referenceCache.ts` | In-memory cache with 10m TTL for slowly changing reference data (Services, Categories, CompanyInfo, Roles, WasteCatalog) |
| `src/helpers/analyticsCache.ts` | In-memory 60-second TTL cache for analytics queries with automatic invalidation on activity log deletions |
| `src/helpers/activityLogger.ts` | Non-blocking batched in-memory activity log buffer with auto-flush (5s / 50 items), monthly rollup aggregation, and daily retention purge |
| `src/helpers/dateUtils.ts` | `addMonths()`, `daysUntil()`, `isStale()` — date arithmetic for project scheduling |
| `src/helpers/mentionHelper.ts` | `extractMentionedUserIds()`, `handleProjectNotesMentions()` — parses @mentions from HTML notes and chat messages, creates Notification records |
| `src/helpers/htmlUtils.ts` | `stripHtmlToText()`, `cleanWordHtml()` — server-side HTML sanitization, entity decoding, and plain-text preview extraction |
| `src/helpers/pathUtils.ts` | Canonical route normalization for activity logs and analytics |
| `src/cleanWordNotes.ts` | Standalone maintenance script to sanitize and clean Microsoft Word metadata, XML, and non-breaking spaces from rich text notes |
| `src/purgeLogs.ts` | Command-line and automated maintenance utility to purge expired activity logs and optimize storage |

### Import & Migration Scripts (standalone, run via `npm run`)
| File | Command | What it does |
|---|---|---|
| `importClientsCsv.ts` | `npm run db:import-clients` | Upserts clients from `import-export/Client.csv` |
| `importWasteCatalogCsv.ts` | `npm run db:import-waste-catalog` | Upserts waste catalog from `import-export/dozvole_indeksi.csv` |
| `importProvidedServicesFromDump.ts` | `npm run db:import-provided-services` | Imports provided services from database dump / export |
| `migrateWastePricesToInvoices.ts` | `npm run db:migrate-waste-invoices` | Migrates historical waste disposal prices into linked `Invoice` records |
| `seed.ts` | `npm run db:seed` | Seeds initial database data |

### Database Schema
| File | Purpose |
|---|---|
| `prisma/schema.prisma` | **Source of truth** for all database models. **27 models + 1 enum (`ChatType`)**. PostgreSQL. Uses UUID primary keys. |
| `prisma.config.ts` | Prisma config — loads env vars for `DATABASE_URL` |

---

## Key Patterns & Conventions

### HARD RULE: NEVER SERVE OR FETCH UNPAGINATED ENTITY LISTS
> [!CAUTION]
> **STRICT PERFORMANCE & SCALABILITY INVARIANT:**
> All collection endpoints for core business entities (`projects`, `services`, `reminders`, `invoices`, `clients`, `permits`, `provided-services`, `users`) MUST enforce pagination via `page` and `limit` query parameters with maximum caps (e.g. `limit <= 1000`), returning structured paginated responses (`buildPaginatedResponse` / `{ data, pagination }`).
>
> **NEVER** expose or implement unbounded full-table scans (`prisma.model.findMany()` with no `take` or date/ID scope) on core entities. Reference data (categories, company info) with small bounded sets may be cached via `referenceCache.ts`.

### Adding a New Route
1. Create `src/routes/<entity>.routes.ts`
2. Follow the pattern: `Router()` → `router.use(requireAuth)` → `asyncHandler(async (req, res) => {...})`
3. Import and mount in `src/app.ts` under `createApp()`
4. Add model to `prisma/schema.prisma`, run `npx prisma migrate dev --name <name>`

### Adding a New Model or Schema Changes
1. Define / update models in `prisma/schema.prisma` with proper indexes and relations
2. Run migration: `npm run migrate:dev -- --name <name>` (creates migration file in `prisma/migrations/` and updates local DB)
3. **CRITICAL: ALWAYS use migrations (`prisma migrate dev`). NEVER use `prisma db push` on staging/production databases!** Render runs `npx prisma migrate deploy` on startup. If schema changes lack a migration file, Render will not apply them, causing runtime crashes or schema drift.
4. The `prisma` export from `src/db.ts` auto-includes the new model
5. **Squash Iterative Migrations Before Production Deployment**: When developing a new unreleased feature, iterative tweaks often produce multiple migration files (e.g., initial table -> add column -> modify index -> add settings). Before deploying to staging/production, **squash these into a single consolidated migration**. Having multiple migrations for an unreleased feature introduces migration debt, index churn (creating and dropping indexes), and deployment overhead. Once a migration is deployed to production/Neon, it becomes immutable.


### Auth Pattern
```typescript
import { requireAuth } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';
import { hasPermission } from '../types';

const router = Router();
router.use(requireAuth);

router.post('/', asyncHandler(async (req, res) => {
  if (!hasPermission(req.authUser, 'resource_name', 'create')) {
    res.status(403).json({ error: 'Permission denied.' });
    return;
  }
  // ... handler logic
}));
```
**Resource Ownership Restrictions**: Check `isRestrictedToOwn(user, "projects")` when roles define limits on viewing/editing only the user's assigned items.

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
- **Project** — central entity. Links to Client, User (responsible), has Reminders, Invoices, ProvidedServices, ProjectNote. Stores lightweight `notesPreview` for list views (`nextSample` field is deprecated and removed in favor of `Reminder`).
- **ProjectNote** + **ProjectNoteVersion** — delta-compressed project notes with full keyframe snapshots ('S') and unified diff patches ('D').
- **Client** — company clients. Has ClientExtraData for permit linking.
- **Invoice** + **InvoiceItem** — billing. Supports `invoiceType`, parent/child links (`parentInvoiceId`), and line items (`InvoiceItem`).
- **Service** — service type definitions (with frequency in months and dynamic `customDataModel` JSON schema).
- **ProvidedService** — individual service delivery records linked to Service, Client, Project, and Invoice (pricing is stored on the linked `Invoice`).

### Permit/Waste System
- **Permit** — environmental permits with date ranges and `permitTypes`.
- **WasteCatalog** — Serbian waste index (code, description, hazardous flag, `frequent` rank).
- **PermitWaste** — junction table: which waste types a permit covers.
- **ClientExtraData** — links a client to their permit.

### User, Notification & Real-Time Chat System
- **User** — roles: Administrator, Manager, User, Accountant (or custom dynamic `Role`).
- **Role** — dynamic role definitions with `isSystemAdmin` flag and JSON `permissions` matrix.
- **UserPreference** — KV store per user (unique `userId+key`), including UI settings, table preferences, `chat_mute_map`, and `chat_dnd_until`.
- **Notification** — @mention and chat notifications.
- **ChatConversation** — conversations of type `DIRECT`, `GROUP`, or `CONTEXTUAL` (e.g. `contextType: "PROJECT"`, `contextId: projectId`), tracking `messageSeq` and denormalized last-message preview.
- **ChatParticipant** — links users to conversations with `lastReadSeq`, `lastReadAt`, `isManuallyUnread`, and `isArchived`.
- **ChatMessage** — sequential (`seq`) messages within a conversation supporting reply threading (`replyToId`), edits (`isEdited`), and soft-delete tombstones (`isDeleted`).

### Audit, Analytics & Versioning
- **ChangeSet** — transaction-level container grouping entity version changes by request, user, route, and method.
- **EntityVersion** — field-level delta and snapshot tracking for entity modifications and deletion tombstones (`op: 'I'|'U'|'D'|'B'`).
- **ActivityLog** — user audit and navigation logs (Administrator only).
- **ActivityLogMonthlyStats** — monthly rolled-up session and duration metrics per user and module.
- **SystemSetting** — global key-value application settings (e.g. `waste_disposal_service_id`, `activity_logging_enabled`, `activity_log_retention_days`).
- **Category** — project categories.
- **CompanyInfo** — singleton with company legal details.
- **Reminder** — tasks linked to projects/clients/permits/users.

---

## Common Commands

```bash
# Development
npm run dev                    # Start dev server (hot-reload)
npm run dev:local              # Start with .env.localhost
npm run build                  # Build for production (prisma generate && tsc)

# Automated Testing (Vitest + Supertest with Deep Mocked Prisma)
npm test                       # Start vitest in watch mode
npm run test:run               # Run all server unit & route tests once
npm run test:coverage          # Run all tests and generate v8 coverage report

# Database
npm run migrate:dev -- --name <name>   # Create and apply new migration locally
npm run migrate:deploy                  # Apply pending migrations
npm run migrate:deploy:neon             # Apply pending migrations to Neon database
npm run migrate:status                  # Check migration status
npm run migrate:status:neon             # Check migration status on Neon
npm run db:seed                         # Seed database
# Note: NEVER use db:push on staging/production — always use migrations!

# Import & Maintenance Scripts
npm run db:import-clients              # Import clients from CSV
npm run db:import-waste-catalog        # Import waste catalog from CSV
npm run db:import-provided-services    # Import provided services from dump
npm run db:migrate-waste-invoices      # Migrate waste disposal prices to invoices
npm run db:clean-word-notes            # Clean Word metadata from project notes
npm run db:purge-logs                  # Purge expired activity logs and entity versions
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
2. **JWT Bearer authentication** — All protected endpoints require `Authorization: Bearer <jwt_token>`. Blocked or unapproved accounts are rejected immediately in `requireAuth`.
3. **Waste catalog auto-seeds** — The `GET /api/waste-catalog` endpoint auto-seeds ~50 entries on first call if table is empty.
5. **Invoice items are replaced** — `PUT /api/invoices/:id` with `items` array deletes all existing items and re-creates them (inside a transaction).
6. **Force logout is in-memory** — `userForceLogoutMap` is process-local. Resets on server restart. For multi-instance deployments, a shared store (e.g. Redis) is needed.
7. **Password never returned** — All user endpoints destructure out the `password` field before responding.
8. **Manager < Administrator** — Managers cannot create, modify, or delete Administrator accounts, nor assign the Administrator role.
9. **ALWAYS use migrations, NEVER db push** — Render runs `npx prisma migrate deploy` on deployment. Every schema change must have a corresponding migration file in `prisma/migrations/`. Using `db push` skips migration tracking, causes schema drift, and breaks deployments.
10. **Squash Pre-Production Migrations** — Always consolidate micro-migrations created during feature development into a single clean migration before deploying to staging/production. Do not ship intermediate iterations (e.g. creating a table, adding a column, dropping/re-creating indexes) if they all belong to the same initial feature release.
11. **HARD RULE: No Hardcoded Names for Service Identification** — NEVER use hardcoded service names or string aliases (e.g., `'Zbrinjavanje otpada'`, `'Waste Disposal'`, `'Odlaganje otpada'`, etc.) to search, identify, or auto-fallback to services in backend routes, database queries, or server logic. The Waste Disposal service is configured exclusively by the Administrator in the UI and persisted to `SystemSetting` (`waste_disposal_service_id`). If not configured, it must remain unconfigured without guessing.

