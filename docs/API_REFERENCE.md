# API Reference

> **Ekos Green Group — Project Tracker API**
> Base URL: `http://localhost:3001/api`

---

## Authentication

All endpoints (except login, register, health, and root) require a JWT Bearer token:

```
Authorization: Bearer <jwt_token>
```

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
List all users (with online status).

**Response 200:** Array of user objects (without password) with `isOnline` and `lastActiveAt`.

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

## Projects (`/api/projects`)

**All routes require auth.**

### `GET /api/projects`
List all projects. Supports `?search=` query parameter (searches name, clientName, responsible).

**Response 200:** Array of project objects (includes `client` relation).

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
  "nextSample": "YYYY-MM-DD (optional)",
  "notes": "string/HTML (optional — supports @mentions)"
}
```

**Response 201:** Created project object.

**Note:** Standard Users are forced as the responsible person.

---

### `PUT /api/projects/:id`
Update a project. Requires ownership or Admin/Manager role.

**Response 200:** Updated project object.

---

### `PATCH /api/projects/:id/toggle-done`
Toggle project done/undone status. Requires ownership or Admin/Manager.

**Response 200:** Updated project object.

---

### `PATCH /api/projects/:id/sample`
Advance `nextSample` date by the service's frequency (in months). Requires ownership or Admin/Manager.

**Response 200:** Updated project object.

---

### `DELETE /api/projects/:id`
Delete a project. Requires ownership or Admin/Manager.

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
  "permitId": "uuid (optional — links to a Permit)"
}
```

**Response 201:** Client object with permit data.

---

### `PUT /api/clients/:id`
Update a client. **Admin/Manager only.**

**Response 200:** Updated client object with permit data.

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
  "wasteCatalogId": "uuid (required — waste catalog entry to link)",
  "wasteCatalogIds": ["uuid"] // alternative array form
}
```

**Response 201:** Formatted permit object.

---

### `PUT /api/permits/:id`
Update a permit. **Admin/Manager only.** Replaces waste catalog associations if `wasteCatalogId` is provided.

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
Dashboard statistics. **No auth required** (note: mounted before auth-protected project routes).

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
- **monitor**: Projects with `nextSample` ≤ 14 days from now

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
