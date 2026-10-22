# API Reference

> **Ekos Green Group — Project Tracker API**
> Base URL: `http://localhost:3001/api`

---

## Authentication

All endpoints (except login, register, health, and root) require a JWT Bearer token:

```http
Authorization: Bearer <jwt_token>
```

### Optional Headers

- **`X-User-Id`**: Legacy fallback that trusts the provided user ID without JWT (marked for removal).

---

## System Endpoints

### `GET /health`
Health check. **No auth required.**

**Response 200:**
```json
{
  "status": "ok",
  "version": "1.0.0",
  "uptime": 124.5,
  "timestamp": "2026-09-05T11:43:04.000Z"
}
```

### `GET /`
Root endpoint. **No auth required.**

**Response 200:**
```json
{ "message": "Project Tracker API is running" }
```

---

## Auth (`/api/auth`)

### `POST /api/auth/login`
**Rate limited:** 20 req / 15 min. **No auth required.**

**Body:**
```json
{
  "emailOrName": "string (email or username)",
  "password": "string"
}
```

**Response 200:**
```json
{
  "user": { "id": "uuid", "name": "...", "email": "...", "role": "...", ... },
  "token": "jwt_string",
  "expiresIn": 7200
}
```

**Error Responses:**
| Status | Error Code | When |
|---|---|---|
| 400 | — | Missing emailOrName or password |
| 401 | `INVALID_CREDENTIALS` | Wrong email/password |
| 403 | `PENDING_APPROVAL` | Account pending approval |
| 403 | `ACCOUNT_BLOCKED` | Account is blocked |
| 403 | `ACCOUNT_REJECTED` | Registration was rejected |

---

### `POST /api/auth/register`
**Rate limited:** 20 req / 15 min. **No auth required.**

**Body:**
```json
{
  "name": "string (required)",
  "email": "string (required)",
  "password": "string (required, ≥8 chars, 1 upper, 1 lower, 1 digit, 1 special)",
  "phone": "string (optional)",
  "gender": "string (optional)"
}
```

**Response 201:**
```json
{
  "message": "Registration submitted successfully! Your account is pending manager approval.",
  "user": { ... }
}
```

> **Note:** No token is issued on registration. Account starts as `PENDING`.

---

### `GET /api/auth/me`
**Auth required.**

Returns the current authenticated user (without password).

**Response 200:** User object.
**Response 403:** If account is blocked.

---

## Users (`/api/users`)

**All routes require auth.** Write operations require **Admin/Manager** role.

### `GET /api/users`
List all users.

**Response 200:** Array of user objects (without password).

---

### `POST /api/users`
Create a new user. **Admin/Manager only.**

**Body:**
```json
{
  "name": "string (required)",
  "email": "string (optional)",
  "role": "Administrator | Manager | User | Accountant (default: User)",
  "phone": "string (optional)",
  "password": "string (optional — auto-generates secure temp password if omitted)",
  "gender": "string (optional)"
}
```

**Response 201:** User object. Includes `tempPassword` if auto-generated.

**Constraints:**
- Manager cannot assign Administrator role.
- Name and email must be unique (case-insensitive).

---

### `PUT /api/users/:id`
Update user. **Admin/Manager for others, any user for self.**

**Body:** Any user fields to update. Supports `password` change (with `currentPassword` for self-update).

**Response 200:** Updated user object.

---

### `POST /api/users/:id/approve`
Approve a pending user registration. **Admin/Manager only.**

**Body:** `{ "role": "User" }` (optional, defaults to User)

**Response 200:** Updated user object.

---

### `POST /api/users/:id/reject`
Reject and delete a pending registration. **Admin/Manager only.**

**Response 200:** `{ "message": "Registration rejected and account removed." }`

---

### `POST /api/users/:id/force-logout`
Force a user to log out. **Admin/Manager only.**

**Response 200:** `{ "success": true, "message": "..." }`

---

### `DELETE /api/users/:id`
Delete a user. **Admin/Manager only.** Manager cannot delete Administrators.

**Response 200:** `{ "message": "User deleted successfully" }`

---

## Roles (`/api/roles`)

Dynamic role and permission matrix management.

### `GET /api/roles`
List all roles with user counts.

**Response 200:**
```json
[
  {
    "name": "Manager",
    "description": "Standard management role",
    "isSystemAdmin": false,
    "permissions": {
      "projects": ["view", "create", "edit", "delete"],
      "clients": ["view", "create", "edit"]
    },
    "_count": { "users": 3 },
    "createdAt": "2026-09-19T10:00:00.000Z",
    "updatedAt": "2026-09-19T10:00:00.000Z"
  }
]
```

### `POST /api/roles`
Create a new custom role. Requires `roles` create permission or System Administrator. Only System Administrators can designate a role as `isSystemAdmin: true`.

**Body:**
```json
{
  "name": "string (required)",
  "description": "string (optional)",
  "isSystemAdmin": false,
  "permissions": {
    "projects": ["view", "create", "edit", "delete"],
    "projects_onlyOwn": true
  }
}
```

**Response 201:** Created role object.

### `PUT /api/roles/:name`
Update an existing role. Requires `roles` edit permission or System Administrator.
- Default `Administrator` role cannot have system admin privileges revoked.
- Only one role in the system can be designated as System Administrator.

**Body:**
```json
{
  "description": "string (optional)",
  "isSystemAdmin": false,
  "permissions": { ... }
}
```

**Response 200:** Updated role object.

### `DELETE /api/roles/:name`
Delete a role. Requires `roles` delete permission or System Administrator.
- Cannot delete the default `Administrator` role.
- Cannot delete a role that is currently assigned to users.

**Response 200:** `{ "success": true }`

---

## Projects (`/api/projects`)

**All routes require auth.**

### `GET /api/projects`
List all projects. Supports `?search=`, `?done=true|false`, `?clientId=`, and `?since=` query parameters.
- When `?since=<ISO_TIMESTAMP>` is passed, returns a **Delta Response Envelope** `{ delta: true, items: [...], deletedIds: string[], syncedAt: string }` containing only projects modified since that timestamp plus tombstones of deleted projects.
- Returns lightweight rows containing `notesPreview` (up to 300 plain text characters) instead of full rich-text HTML `notes`.
- Supports pagination via `?page=` and `?limit=`.

**Response 200 (standard):** Array of project objects (includes `client` relation).
**Response 200 (delta):**
```json
{
  "delta": true,
  "items": [ ... ],
  "deletedIds": [ "proj-uuid-1" ],
  "syncedAt": "2026-10-23T01:00:00.000Z"
}
```

---

### `GET /api/projects/updates`
Retrieve aggregated activity stream of recent project updates across the organization.
- **Query parameters:** `?limit=50`, `?offset=0`, `?projectId=` (filter for a specific project)
- Returns chronologically ordered update events derived from audit logs, project changes, note revisions, and task completions.

**Response 200:** Array of update items with author, action, timestamp, target entity, and change summary.

---

### `GET /api/projects/:id`
Get full details of a single project by ID, including complete rich-text HTML `notes`.
- **Query parameters:** `?version=` (optional: reconstruct project snapshot at a specific version)

**Response 200:** Project object.
**Response 404:** `{ "error": "Project not found" }`

---

### `GET /api/projects/:id/note`
Get the current rich-text note content for a project from the `ProjectNote` table.

**Response 200:**
```json
{
  "projectId": "uuid",
  "content": "<p>Project notes HTML...</p>",
  "version": 4,
  "updatedAt": "2026-10-23T01:00:00.000Z"
}
```

---

### `GET /api/projects/:id/note/history`
Get the version history timeline for a project's notes.
- **Query parameters:** `?limit=50`, `?offset=0`

**Response 200:** Array of note versions:
```json
[
  {
    "version": 4,
    "kind": "D",
    "charDelta": 45,
    "authorName": "Nemanja Stanojevic",
    "createdAt": "2026-10-23T00:30:00.000Z"
  },
  {
    "version": 1,
    "kind": "S",
    "charDelta": 210,
    "authorName": "Nemanja Stanojevic",
    "createdAt": "2026-10-21T16:00:00.000Z"
  }
]
```

---

### `GET /api/projects/:id/note/diff`
Get field-level or text diff between two versions or dates for a project note.
- **Query parameters:** `?from=1&to=4` OR `?dateFrom=YYYY-MM-DD&dateTo=YYYY-MM-DD`

**Response 200:**
```json
{
  "fromVersion": 1,
  "toVersion": 4,
  "diff": "--- v1\n+++ v4\n@@ ... @@\n...",
  "addedCount": 5,
  "removedCount": 2
}
```

---

### `GET /api/projects/:id/updates-diff`
Get detailed visual diff of entity state changes for a specific update event.
- **Query parameters:** `?from=<timestamp|version>&to=<timestamp|version>`

**Response 200:** Detailed diff breakdown of modified fields and values.

---

### `POST /api/projects/:id/note/restore/:v`
Restore a project's note to a specific historical version number `:v`.
Creates a new revision record maintaining full audit history.

**Response 200:** `{ "success": true, "version": 5, "content": "..." }`

---

### `POST /api/projects`
Create a project.

**Body:**
```json
{
  "name": "string (required)",
  "clientId": "uuid (optional)",
  "clientName": "string (required if no clientId)",
  "type": "string (required — service code)",
  "responsible": "string (optional — defaults to current user)",
  "start": "YYYY-MM-DD (optional)",
  "deadline": "YYYY-MM-DD (optional)",
  "progress": "0-100 (optional, default 0)",
  "done": "boolean (optional)",
  "notes": "string/HTML (optional — supports @mentions)"
}
```

**Response 201:** Created project object.

**Note:** Standard Users are forced as the responsible person.

---

### `PUT /api/projects/:id`
Update a project. Requires ownership or Admin/Manager role.
Automatically tracks note revisions and delta history when the `notes` field is modified.

**Response 200:** Updated project object.

---

### `PATCH /api/projects/:id/toggle-done`
Toggle project done/undone status. Requires ownership or Admin/Manager.

**Response 200:** Updated project object.

---

### `DELETE /api/projects/:id`
Delete a project. Requires ownership or Admin/Manager. Creates an `EntityVersion` tombstone (`op: 'D'`) to notify delta sync clients.

**Response 200:** `{ "message": "Project deleted successfully" }`

---

## Clients (`/api/clients`)

**All routes require auth.** Write operations require **Admin/Manager** role.

### `GET /api/clients`
List all clients with their projects and permit data.

**Response 200:** Array of client objects (includes `projects`, `permitId`, `permit`).

---

### `POST /api/clients`
Create a client. **Admin/Manager only.**

**Body:**
```json
{
  "name": "string (required, unique case-insensitive)",
  "contactPerson": "string (optional)",
  "email": "string (optional)",
  "phone": "string (optional)",
  "city": "string (optional)",
  "permitId": "uuid (optional — links a single Permit)",
  "permitIds": ["uuid"] // optional — links multiple Permits
}
```

**Response 201:** Client object with `permits` array, `permitId`, and `permit`.

---

### `PUT /api/clients/:id`
Update a client. **Admin/Manager only.** Supports updating `permitId` or `permitIds`.

**Response 200:** Updated client object with `permits` array, `permitId`, and `permit`.

---

### `DELETE /api/clients/:id`
Delete a client. **Admin/Manager only.**

**Response 200:** `{ "message": "Client deleted successfully" }`

---

## Invoices (`/api/invoices`)

**All routes require auth.** Write operations require **Admin/Manager/Accountant** role.

### `GET /api/invoices`
List invoices. Supports query parameters: `?search=`, `?status=`, `?clientId=`, `?projectId=`.

**Response 200:** Array of invoice objects (includes `client`, `project`, `items`).

---

### `GET /api/invoices/:id`
Get single invoice with details.

**Response 200:** Invoice object.

---

### `POST /api/invoices`
Create an invoice.

**Body:**
```json
{
  "invoiceNumber": "string (required, unique)",
  "dateCreated": "YYYY-MM-DD (optional, defaults to today)",
  "dueDate": "YYYY-MM-DD (optional)",
  "paymentDate": "YYYY-MM-DD (optional)",
  "clientId": "uuid (optional)",
  "clientName": "string (optional)",
  "projectId": "uuid (optional)",
  "projectName": "string (optional)",
  "status": "Draft | Sent | Paid | Cancelled (default: Draft)",
  "notes": "string (optional)",
  "currency": "string (default: RSD)",
  "items": [
    {
      "description": "string",
      "quantity": "number (default: 1)",
      "unitPrice": "number (default: 0)",
      "currency": "string (optional)"
    }
  ]
}
```

**Response 201:** Invoice object with computed `totalAmount`.

---

### `PUT /api/invoices/:id`
Update an invoice. Replaces all items if `items` array is provided.

**Response 200:** Updated invoice object.

---

### `PATCH /api/invoices/:id/status`
Update invoice status. Auto-sets `paymentDate` to today when status is `Paid`.

**Body:** `{ "status": "Paid", "paymentDate": "YYYY-MM-DD" }`

**Response 200:** Updated invoice object.

---

### `DELETE /api/invoices/:id`
Delete an invoice.

**Response 200:** `{ "message": "Invoice deleted successfully" }`

---

## Services (`/api/services`)

**All routes require auth.** Write operations require **Admin/Manager** role.

### `GET /api/services`
List all service types.

**Response 200:** Array of service objects.

---

### `POST /api/services`
Create a service type. **Admin/Manager only.**

**Body:**
```json
{
  "code": "string (required, unique — formatted to lowercase-kebab)",
  "name": "string (required, unique case-insensitive)",
  "group": "string (default: 'grp-legal')",
  "frequency": "number (months between samples, default: 0)",
  "description": "string (optional)",
  "customDataModel": "JSON (optional — defines custom form fields)"
}
```

**Response 201:** Service object.

---

### `PUT /api/services/:id`
Update a service. **Admin/Manager only.**

**Response 200:** Updated service object.

---

### `DELETE /api/services/:id`
Delete a service. **Admin/Manager only.**

**Response 200:** `{ "message": "Service deleted successfully" }`

---

## Categories (`/api/categories`)

**All routes require auth.** Write operations require **Admin/Manager** role.

### `GET /api/categories`
List all categories.

### `POST /api/categories`
Create category. Body: `{ code, name, description }`.

### `PUT /api/categories/:id`
Update category.

### `DELETE /api/categories/:id`
Delete category. Returns 204 No Content.

---

## Provided Services (`/api/provided-services`)

**All routes require auth.** Write operations require **Admin/Manager** role.

### `GET /api/provided-services`
List provided services. Supports: `?search=`, `?status=`, `?clientId=`, `?projectId=`, `?serviceId=`, `?invoiceId=`.

**Response 200:** Array with included `service`, `client`, `project`, `invoice` relations.

---

### `GET /api/provided-services/:id`
Get single provided service with all relations.

---

### `POST /api/provided-services`
Create a provided service record. **Admin/Manager only.**

**Body:**
```json
{
  "serviceId": "uuid (required)",
  "clientId": "uuid (required)",
  "projectId": "uuid (optional)",
  "invoiceId": "uuid (optional)",
  "status": "Planned | In Progress | Completed (default: Planned)",
  "location": "string (optional)",
  "scheduledDate": "YYYY-MM-DD (optional)",
  "completionDate": "YYYY-MM-DD (optional)",
  "price": "number (default: 0)",
  "currency": "string (default: RSD)",
  "notes": "string (optional)",
  "customData": "JSON (optional)"
}
```

**Response 201:** Provided service object.

---

### `PUT /api/provided-services/:id`
Update a provided service. **Admin/Manager only.** Validates referenced entities exist.

---

### `DELETE /api/provided-services/:id`
Delete a provided service. **Admin/Manager only.**

---

## Reminders (`/api/reminders`)

**All routes require auth.**

### `GET /api/reminders`
List all reminders. Supports `?search=`.

**Response 200:** Array with `project`, `client`, `responsibleUser`, `permit` relations.

---

### `POST /api/reminders`
Create a reminder.

**Body:**
```json
{
  "title": "string (required, or projectName)",
  "projectId": "uuid (optional)",
  "projectName": "string (optional)",
  "clientId": "uuid (optional)",
  "clientName": "string (optional)",
  "responsibleId": "uuid (optional)",
  "responsible": "string (optional)",
  "status": "Pending | In Progress | Completed (default: Pending)",
  "notes": "string (optional)",
  "dueDate": "YYYY-MM-DD (optional)",
  "permitId": "uuid (optional)",
  "permitNumber": "string (optional)"
}
```

**Response 201:** Reminder object.

---

### `PUT /api/reminders/:id`
Update a reminder. Requires ownership or Admin/Manager role.

---

### `PATCH /api/reminders/:id/status`
Update reminder status. Requires ownership or Admin/Manager.

**Body:** `{ "status": "Completed" }`

---

### `DELETE /api/reminders/:id`
Delete a reminder. Requires ownership or Admin/Manager.

---

## Permits (`/api/permits`)

**All routes require auth.** Write operations require **Admin/Manager** role.

### `GET /api/permits`
List all permits with associated data. Supports `?search=` (searches permit number, notes, client name, waste catalog code/description).

**Response 200:** Array of formatted permit objects including:
- `clients` — array of linked clients
- `clientName`, `clientId` — first linked client
- `wasteCatalogs` — array of linked waste catalog entries
- `wasteCatalogIds` — array of waste catalog IDs
- `indexNumber` — first waste catalog code
- `permitTypes` — array of permit type strings (e.g. ["Sakupljanje", "Transport"])

---

### `GET /api/permits/:id`
Get single permit with all relations.

---

### `POST /api/permits`
Create a permit. **Admin/Manager only.**

**Body:**
```json
{
  "permitNumber": "string (required)",
  "startDate": "YYYY-MM-DD (optional)",
  "endDate": "YYYY-MM-DD (optional)",
  "notes": "string (optional)",
  "clientId": "uuid (required — client to associate permit with)",
  "permitTypes": ["string (required: at least one: 'Sakupljanje' | 'Transport' | 'Skladistenje' | 'Tretman' | 'Odlaganje')"],
  "wasteCatalogId": "uuid (required if wasteCatalogIds omitted — waste catalog entry to link)",
  "wasteCatalogIds": ["uuid"] // alternative array form
}
```

**Response 201:** Formatted permit object.

---

### `PUT /api/permits/:id`
Update a permit. **Admin/Manager only.** Supports updating `clientId`, `permitTypes`, and replaces waste catalog associations if `wasteCatalogId` or `wasteCatalogIds` is provided.

---

### `DELETE /api/permits/:id`
Delete a permit. **Admin/Manager only.**

---

## Waste Catalog (`/api/waste-catalog`)

**All routes require auth.**

### `GET /api/waste-catalog`
List waste catalog entries. Auto-seeds default entries if table is empty.

**Query parameters:**
- `?search=` — filter by code or description
- `?page=` & `?limit=` — enable pagination (default: all results)
- `?limit=all` — explicitly return all results

**Response (unpaginated) 200:** Array of waste catalog items (sorted by `frequent` rank, then `code`).

**Response (paginated) 200:**
```json
{
  "items": [...],
  "total": 150,
  "page": 1,
  "limit": 20,
  "hasMore": true
}
```

---

### `GET /api/waste-catalog/:id`
Get single waste catalog entry.

---

### `POST /api/waste-catalog`
Create or upsert a waste catalog entry. **Admin/Manager only.**

**Body:**
```json
{
  "code": "string (required, e.g. '15 01 01')",
  "description": "string (required)",
  "hazardListMark": "string (optional, e.g. 'Y46')",
  "isHazardous": "boolean (default: false)",
  "frequent": "number | null (optional — sorting rank for favorites)"
}
```

**Response 201:** Waste catalog item.

---

### `PATCH /api/waste-catalog/:id/frequent`
Toggle or set the "frequent" rank for a waste catalog entry.

**Body:** `{ "frequent": 1 }` or `{ "frequent": null }` or `{ "frequent": true/false }` or omit for toggle.

---

### `DELETE /api/waste-catalog/:id`
Delete a waste catalog entry. **Admin/Manager only.**
Creates an `EntityVersion` tombstone (`op: 'D'`) to notify delta sync clients and invalidates the in-memory reference cache.

**Response 200:** `{ "message": "Waste catalog item deleted successfully" }`

---

## Notifications (`/api/notifications`)

**All routes require auth.** Users can only manage their own notifications.

### `GET /api/notifications`
List current user's notifications (latest 50).

**Response 200:**
```json
{
  "notifications": [...],
  "unreadCount": 5
}
```

---

### `PATCH /api/notifications/mark-all-read`
Mark all notifications as read.

**Response 200:** `{ "success": true, "count": 3 }`

---

### `PATCH /api/notifications/:id/read`
Mark a single notification as read.

---

### `DELETE /api/notifications/clear-all`
Delete all notifications for the current user.

---

### `DELETE /api/notifications/:id`
Delete a single notification.

---

## Company Info (`/api/company-info`)

**All routes require auth.** Update requires **Admin/Manager** role.

### `GET /api/company-info`
Get company information (auto-creates with defaults if not found).

**Response 200:** CompanyInfo object.

---

### `PUT /api/company-info`
Update company information. **Admin/Manager only.**

**Body:** Any CompanyInfo fields (`name`, `legalName`, `registrationNumber`, `municipality`, `city`, `streetAddress`, `postalCode`, `postOffice`, `email`, `taxId`, `activityCode`, `bankAccounts`).

---

## Preferences (`/api/preferences`)

**All routes require auth.** Users manage their own preferences only.

### `GET /api/preferences`
Get all preferences for the current user.

**Response 200:** Key-value object (values are auto-parsed from JSON).

---

### `PUT /api/preferences/:key`
Set a preference value.

**Body:** `{ "value": any }`

---

## Stats (`/api/projects/stats`)

### `GET /api/projects/stats`
Dashboard statistics. **Optional auth**: If an authenticated user has `isRestrictedToOwn` limits for projects, the statistics returned will be restricted only to projects owned by that user or simulated role.

**Response 200:**
```json
{
  "active": 15,
  "done": 42,
  "stale": 3,
  "monitor": 5,
  "clientsCount": 28,
  "usersCount": 8,
  "servicesCount": 12,
  "categoriesCount": 6,
  "invoicesCount": 34,
  "providedServicesCount": 67
}
```

Definitions:
- **active**: Projects where `done = false`
- **done**: Projects where `done = true`
- **stale**: Active projects with `start` date >2 months ago
- **monitor**: Pending reminders with `dueDate` ≤ 14 days from now

---

## Activity Logs (`/api/activity-logs`)

Audit and user activity logging. Client events and database mutations are buffered asynchronously and flushed in batches. **Viewing, deleting, and configuring activity logs is restricted to Administrators only.**

### `GET /api/activity-logs/status`
Check whether activity logging is globally active or paused.
- **Auth:** Any authenticated user.
- **Response 200:** `{ "enabled": boolean }`

### `PATCH /api/activity-logs/status`
Toggle activity logging globally. **Administrator only.**
- **Body:** `{ "enabled": boolean }`
- **Response 200:** `{ "enabled": boolean }`

### `GET /api/activity-logs`
List activity logs. **Administrator only.** By default excludes the heavy `details` field.
- **Query params:**
  - `userId` (optional): Filter by specific user UUID.
  - `sessionId` (optional): Filter by specific session ID.
  - `from` (optional): ISO date string (`YYYY-MM-DDTHH:mm:ss.sssZ`). Only returns logs at or after this timestamp.
  - `before` (optional): ISO date string (`YYYY-MM-DDTHH:mm:ss.sssZ`). Cursor for pagination.
  - `beforeId` (optional): UUID of the last item on the previous page for composite tie-breaking cursor.
  - `limit` (optional): Number of records (default 50, max 250).
  - `includeDetails` (optional): `'true'` to include the JSON diff `details` field.

### `GET /api/activity-logs/summary`
Postgres-aggregated summary of activity logs for KPI cards and per-user activity headers without transferring raw log rows. **Administrator only.**
Results are cached in-memory with a 30-second TTL.

- **Query params:**
  - `from` (required/recommended): ISO date string (e.g. start of today, 7 days ago, or 30 days ago).
- **Response 200:**
  ```json
  {
    "kpiStats": {
      "totalUsers": 5,
      "activeToday": 3,
      "totalSessions": 34,
      "totalTrackedSeconds": 43200,
      "topModule": "/data-management/projects",
      "topModulePercent": 41
    },
    "userSummaries": [
      {
        "userId": "usr_123",
        "userName": "Petar Petrović",
        "totalDurationSeconds": 15400,
        "totalSessionsCount": 12,
        "totalActivitiesCount": 180,
        "lastActive": "2026-10-20T13:45:00.000Z",
        "hasActiveSession": true,
        "topModules": [
          { "path": "/data-management/projects", "seconds": 9240, "percentage": 60 }
        ]
      }
    ]
  }
  ```

---

### `GET /api/activity-logs/monthly-stats`
Fetch pre-aggregated historical monthly rollup statistics from `ActivityLogMonthlyStats` (zero raw log rows transferred). **Administrator only.**

- **Query params:**
  - `userId` (optional): Filter to a specific user UUID.
  - `fromYearMonth` (optional): e.g. `'2025-01'`.
  - `toYearMonth` (optional): e.g. `'2026-10'`.
- **Response 200:** Array of monthly rollup objects including `moduleBreakdown`, `totalDurationSeconds`, `sessionCount`, and `actionCount`.

---

### `GET /api/activity-logs/:id`
Fetch a single activity log including its full `details` (lazy loaded for diff views). **Administrator only.**

### `POST /api/activity-logs`
Ingest client activity events (e.g. `PAGE_VIEW`, `LOGIN`, `LOGOUT`).
- Accepts a single event object or an array of event objects (batched).
- Identity is derived from the authenticated user token.
- Returns `202 Accepted` immediately; events are ignored if logging is deactivated, otherwise persisted asynchronously.

### `GET /api/activity-logs/analytics`
Compute comprehensive activity and usage analytics. **Administrator only.**
Results are cached in-memory with a 60-second TTL (invalidated immediately on log deletion).

- **Query params:**
  - `from` (optional): ISO date string start range (default: 30 days ago).
  - `to` (optional): ISO date string end range (default: current time).
  - `tz` (optional): Valid IANA timezone string (e.g. `'Europe/Belgrade'`, default: `'UTC'`).
  - `granularity` (optional): `'day' | 'week' | 'month'` (auto-calculated if omitted: ≤45d = day, ≤180d = week, >180d = month).
  - `userIds` (optional): Comma-separated user UUIDs to filter by.
  - `roles` (optional): Comma-separated role names to filter by.
  - `excludeAdminPages` (optional): `'false'` to include administrative routes (default: `'true'`).
  - `compare` (optional): `'false'` to skip prior-period trend comparisons (default: `'true'`).

- **Response 200:**
  ```json
  {
    "kpis": {
      "totalEvents": 4820,
      "eventsDeltaPercent": 14.2,
      "activeUsers": 12,
      "activeUsersDeltaPercent": 0,
      "totalSessions": 340,
      "sessionsDeltaPercent": 8.5,
      "totalDurationHours": 182.4,
      "durationDeltaPercent": 5.1,
      "avgDailyDurationMinutes": 45.6,
      "topPage": "/data-management/projects",
      "stickinessRatio": 0.42
    },
    "timeline": [
      { "period": "2026-10-12", "events": 140, "sessions": 15, "durationMinutes": 120, "activeUsers": 8 }
    ],
    "topPages": [
      { "path": "/data-management/projects", "views": 1250, "uniqueUsers": 11, "avgDurationSeconds": 48.2, "percentage": 28.5 }
    ],
    "actionsByEntity": [
      { "entity": "Project", "creates": 25, "edits": 84, "deletes": 2, "total": 111 }
    ],
    "userUsage": [
      { "userId": "uuid", "userName": "Jovan Jovanović", "role": "Manager", "totalSessions": 42, "totalEvents": 580, "totalDurationMinutes": 310, "topPage": "/data-management/projects" }
    ],
    "userPageBreakdown": [...],
    "heatmap": [
      { "dayOfWeek": 1, "hour": 9, "count": 48 }
    ],
    "sessionDurationDistribution": [
      { "bucket": "<1m", "count": 22 },
      { "bucket": "1-5m", "count": 85 },
      { "bucket": "5-15m", "count": 120 },
      { "bucket": "15-30m", "count": 64 },
      { "bucket": "30-60m", "count": 35 },
      { "bucket": ">60m", "count": 14 }
    ],
    "transitions": [
      { "from": "/data-management/projects", "to": "/data-management/invoices", "count": 84 }
    ],
    "featureAdoption": [...],
    "editedFields": [...]
  }
  ```

### `DELETE /api/activity-logs/clear-all`
Deletes all activity logs. **Administrator only.** Invalidates analytics cache.

### `POST /api/activity-logs/bulk-delete`
Deletes specific activity logs by IDs. Body: `{ ids: string[] }`. **Administrator only.** Invalidates analytics cache.

### `DELETE /api/activity-logs/session/:sessionId`
Deletes all activity logs for a specific session. **Administrator only.** Invalidates analytics cache.

### `DELETE /api/activity-logs/:id`
Deletes an individual activity log. **Administrator only.** Invalidates analytics cache.

---

## History & Data Versioning (`/api/history`)

**All routes require auth.** Requires `history` `view` permission (or Administrator). Restore actions require `history` `restore` permission.

### `GET /api/history/:entityType/:id`
Retrieve the complete historical version timeline for a specific entity.
- **Path parameters:**
  - `entityType` — supported entities: `Project`, `Invoice`, `Client`, `Permit`, `Reminder`, `ProvidedService`, etc. (case-insensitive)
  - `id` — UUID of the entity
- **Query parameters:**
  - `?limit=50` (default 50)
  - `?offset=0`
  - `?includeChildren=true|false` (e.g. include `InvoiceItem` versions when querying `Invoice`)

**Response 200:**
```json
{
  "entityType": "Project",
  "entityId": "uuid",
  "currentVersion": 5,
  "versions": [
    {
      "version": 5,
      "op": "U",
      "kind": "D",
      "changedFields": ["progress", "deadline"],
      "createdAt": "2026-10-22T21:00:00.000Z",
      "changeSet": {
        "id": "cs-uuid",
        "userName": "Nemanja Stanojevic",
        "route": "/api/projects/uuid",
        "method": "PUT"
      }
    }
  ]
}
```

---

### `GET /api/history/:entityType/:id/diff`
Compute field-by-field differences between two versions or two point-in-time timestamps.
- **Query parameters:**
  - `?from=1&to=5` (version numbers), OR
  - `?dateFrom=2026-10-20&dateTo=2026-10-22` (ISO dates, automatically resolves corresponding version numbers)

**Response 200:**
```json
{
  "entityType": "Project",
  "entityId": "uuid",
  "fromVersion": 1,
  "toVersion": 5,
  "changes": [
    {
      "field": "progress",
      "oldValue": 20,
      "newValue": 85
    },
    {
      "field": "deadline",
      "oldValue": "2026-11-01",
      "newValue": "2026-11-15"
    }
  ],
  "dateFrom": "2026-10-20",
  "dateTo": "2026-10-22"
}
```

---

### `GET /api/history/:entityType/:id/versions/:v`
Reconstruct the complete state snapshot of an entity at a specific version `:v`.

**Response 200:** Reconstructed entity state object at version `:v`.
**Response 404:** `{ "error": "Version 3 not found for Project uuid" }`

---

### `GET /api/history/changesets/:id`
Inspect a transaction-level ChangeSet grouping all entity mutations across a single HTTP request or migration.

**Response 200:** ChangeSet details with child `versions` list.

---

### `POST /api/history/:entityType/:id/restore/:v`
Restore an entity to its state at version `:v`. Requires `history` `restore` permission.
Creates a new revision record maintaining continuous non-destructive history.

**Response 200:**
```json
{
  "success": true,
  "restoredVersion": 4,
  "newVersion": 6,
  "entity": { ... }
}
```

---

## Delta Synchronization (`?since=`)

All primary entity collection endpoints support incremental synchronization via the `?since=` query parameter:
- `/api/projects?since=<ISO_TIMESTAMP>`
- `/api/clients?since=<ISO_TIMESTAMP>`
- `/api/invoices?since=<ISO_TIMESTAMP>`
- `/api/permits?since=<ISO_TIMESTAMP>`
- `/api/reminders?since=<ISO_TIMESTAMP>`
- `/api/provided-services?since=<ISO_TIMESTAMP>`
- `/api/waste-catalog?since=<ISO_TIMESTAMP>`

### Delta Response Envelope
When `?since=` is supplied with a valid timestamp within 30 days (`MAX_DELTA_AGE_DAYS`), the API responds with a Delta Envelope:
```json
{
  "delta": true,
  "items": [ ... ],
  "deletedIds": [ "deleted-uuid-1", "deleted-uuid-2" ],
  "syncedAt": "2026-10-23T01:15:00.000Z"
}
```
- **`items`**: Entities updated or created since `since`.
- **`deletedIds`**: IDs of entities deleted since `since` (retrieved from `EntityVersion` audit records where `op = 'D'`).
- **`syncedAt`**: Current server timestamp to record for the subsequent delta sync request.
- **Retention fallback**: If the provided `since` timestamp is older than 30 days, the server safely falls back to a full fresh snapshot (`delta: false`) to prevent missing tombstones.

---

## Network Optimization & In-Memory Caching

1. **HTTP Response Compression**:
   - Gzip and Deflate compression middleware (`compression`) active across all API routes with a threshold of 1024 bytes.
2. **In-Memory Reference Data Caching (`referenceCache.ts`)**:
   - Slowly changing reference records (`/api/services`, `/api/categories`, `/api/company-info`, `/api/roles`, `/api/waste-catalog`) are cached in server memory with a 10-minute default TTL (`DEFAULT_REFERENCE_TTL_MS = 600000`).
   - Mutations (`POST`, `PUT`, `DELETE`, `PATCH`) automatically invalidate the respective cache key or prefix.
3. **User Auth & Role Caching (`auth.ts`)**:
   - User authentication and role entities are cached in-memory with a 60-second TTL to eliminate redundant database queries on rapid concurrent requests.
   - Force logout or role updates immediately invalidate the user auth cache.
4. **Analytics Aggregation Caching (`analyticsCache.ts`)**:
   - High-computation analytics queries (`/api/activity-logs/analytics`) are cached with a 60-second TTL and automatically invalidated upon any activity log deletion or purge.

---

## Common Error Responses

| Status | Meaning |
|---|---|
| 400 | Bad request — missing required fields, validation failure, duplicate record |
| 401 | Unauthorized — missing or invalid JWT |
| 403 | Forbidden — insufficient role permissions |
| 404 | Not found — resource doesn't exist, or route not found |
| 500 | Internal server error |

**Prisma-specific errors (handled globally):**
- **P2002** (Unique constraint violation) → 400 with field name
- **P2025** (Record not found during update/delete) → 404
