# Changelog

All notable changes to the backend server project will be documented in this file.

## [v1.3.0] - 2026-10-18

- feat: add comprehensive activity analytics engine (`activityAnalytics.service.ts`) with KPI computation, trend deltas, timeline aggregations, and transition mapping.
- feat: add in-memory 60-second TTL analytics cache (`analyticsCache.ts`) with automated invalidation upon activity log purge or deletion.
- feat: add composite database index `[type, timestamp]` on `ActivityLog` model for accelerated multi-metric analytics queries.
- refactor: centralize API routes and Prisma model-to-route mappings in `src/constants/apiRoutes.ts`.
- refactor: implement automated short-session purging (`purgeShortLifecycleSessions`) for bounce and abandoned sessions.

## [v1.2.0] - 2026-10-07

- feat: user activity tracking architecture (`ActivityLog` database model).
- feat: asynchronous buffered in-memory log ingestion (`enqueueActivityLog`, `flushActivityLogs`) with automated retention policy.
- feat: administrative audit log management endpoints (`GET /api/activity-logs`, `GET /status`, `PATCH /status`, `clear-all`, `bulk-delete`).
- feat: dynamic system settings configuration (`SystemSetting` model).

## [v1.1.0] - 2026-09-19

- feat: dynamic roles & permissions management subsystem (`Role` model, `/api/roles` routes).
- feat: resource-level ownership scoping (`isRestrictedToOwn`) and granular action validations (View, Create, Edit, Delete).
- refactor: decouple authorization middleware from static role enums to dynamic database-driven permission matrices.

## [v1.0.0] - 2026-09-02

- Initial baseline release with health monitoring endpoint, Prisma PostgreSQL schema, and PR-driven release workflows.
