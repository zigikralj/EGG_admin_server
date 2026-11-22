-- AlterTable
ALTER TABLE "Role" ADD COLUMN "level" INTEGER NOT NULL DEFAULT 10;

-- Backfill standard role levels
UPDATE "Role" SET "level" = 100 WHERE "name" = 'Administrator' OR "isSystemAdmin" = true;
UPDATE "Role" SET "level" = 50 WHERE "name" = 'Manager' AND "isSystemAdmin" = false;
UPDATE "Role" SET "level" = 20 WHERE "name" = 'Accountant' AND "isSystemAdmin" = false;
UPDATE "Role" SET "level" = 15 WHERE "name" = 'User' AND "isSystemAdmin" = false;
UPDATE "Role" SET "level" = 10 WHERE "name" = 'Kapd' AND "isSystemAdmin" = false;

-- Normalize NULL permissions
UPDATE "Role"
SET "permissions" = '{}'::jsonb
WHERE "permissions" IS NULL;

-- 1. Backfill tracker_projects and tracker_projects_onlyOwn from projects
UPDATE "Role"
SET "permissions" = jsonb_set("permissions", '{tracker_projects}', "permissions"->'projects', true)
WHERE "isSystemAdmin" = false
  AND NOT ("permissions" ? 'tracker_projects')
  AND ("permissions" ? 'projects')
  AND jsonb_typeof("permissions"->'projects') = 'array';

UPDATE "Role"
SET "permissions" = jsonb_set("permissions", '{tracker_projects_onlyOwn}', "permissions"->'projects_onlyOwn', true)
WHERE "isSystemAdmin" = false
  AND NOT ("permissions" ? 'tracker_projects_onlyOwn')
  AND ("permissions" ? 'projects_onlyOwn')
  AND jsonb_typeof("permissions"->'projects_onlyOwn') = 'boolean';

-- 2. Backfill tracker_updates and tracker_updates_onlyOwn
UPDATE "Role"
SET "permissions" = jsonb_set(
  "permissions",
  '{tracker_updates}',
  CASE
    WHEN (jsonb_typeof("permissions"->'tracker_projects') = 'array' AND ("permissions"->'tracker_projects') ? 'view')
      OR (jsonb_typeof("permissions"->'projects') = 'array' AND ("permissions"->'projects') ? 'view')
    THEN '["view"]'::jsonb
    ELSE '[]'::jsonb
  END,
  true
)
WHERE "isSystemAdmin" = false
  AND NOT ("permissions" ? 'tracker_updates');

UPDATE "Role"
SET "permissions" = jsonb_set(
  "permissions",
  '{tracker_updates_onlyOwn}',
  COALESCE("permissions"->'tracker_projects_onlyOwn', "permissions"->'projects_onlyOwn'),
  true
)
WHERE "isSystemAdmin" = false
  AND NOT ("permissions" ? 'tracker_updates_onlyOwn')
  AND (
    jsonb_typeof("permissions"->'tracker_projects_onlyOwn') = 'boolean'
    OR jsonb_typeof("permissions"->'projects_onlyOwn') = 'boolean'
  );

-- 3. Backfill tracker_reminders and tracker_reminders_onlyOwn from reminders
UPDATE "Role"
SET "permissions" = jsonb_set("permissions", '{tracker_reminders}', "permissions"->'reminders', true)
WHERE "isSystemAdmin" = false
  AND NOT ("permissions" ? 'tracker_reminders')
  AND ("permissions" ? 'reminders')
  AND jsonb_typeof("permissions"->'reminders') = 'array';

UPDATE "Role"
SET "permissions" = jsonb_set("permissions", '{tracker_reminders_onlyOwn}', "permissions"->'reminders_onlyOwn', true)
WHERE "isSystemAdmin" = false
  AND NOT ("permissions" ? 'tracker_reminders_onlyOwn')
  AND ("permissions" ? 'reminders_onlyOwn')
  AND jsonb_typeof("permissions"->'reminders_onlyOwn') = 'boolean';

-- 4. Backfill tracker_invoices from invoices
UPDATE "Role"
SET "permissions" = jsonb_set("permissions", '{tracker_invoices}', "permissions"->'invoices', true)
WHERE "isSystemAdmin" = false
  AND NOT ("permissions" ? 'tracker_invoices')
  AND ("permissions" ? 'invoices')
  AND jsonb_typeof("permissions"->'invoices') = 'array';

-- 5. Backfill wasteDisposal from providedServices
UPDATE "Role"
SET "permissions" = jsonb_set("permissions", '{wasteDisposal}', "permissions"->'providedServices', true)
WHERE "isSystemAdmin" = false
  AND NOT ("permissions" ? 'wasteDisposal')
  AND ("permissions" ? 'providedServices')
  AND jsonb_typeof("permissions"->'providedServices') = 'array';

-- 6. Backfill chat (delete from projects.delete, moderate from projects.edit)
UPDATE "Role"
SET "permissions" = jsonb_set(
  "permissions",
  '{chat}',
  CASE
    WHEN jsonb_typeof("permissions"->'projects') = 'array'
     AND ("permissions"->'projects') ? 'delete'
     AND ("permissions"->'projects') ? 'edit'
    THEN '["delete","moderate"]'::jsonb
    WHEN jsonb_typeof("permissions"->'projects') = 'array'
     AND ("permissions"->'projects') ? 'delete'
    THEN '["delete"]'::jsonb
    WHEN jsonb_typeof("permissions"->'projects') = 'array'
     AND ("permissions"->'projects') ? 'edit'
    THEN '["moderate"]'::jsonb
    ELSE '[]'::jsonb
  END,
  true
)
WHERE "isSystemAdmin" = false
  AND NOT ("permissions" ? 'chat');

-- 7. Backfill activityAnalytics where activityLogs includes view
UPDATE "Role"
SET "permissions" = jsonb_set("permissions", '{activityAnalytics}', '["view"]'::jsonb, true)
WHERE "isSystemAdmin" = false
  AND NOT ("permissions" ? 'activityAnalytics')
  AND jsonb_typeof("permissions"->'activityLogs') = 'array'
  AND ("permissions"->'activityLogs') ? 'view';

-- 8. Backfill systemSettings where roles includes edit
UPDATE "Role"
SET "permissions" = jsonb_set("permissions", '{systemSettings}', '["view","edit"]'::jsonb, true)
WHERE "isSystemAdmin" = false
  AND NOT ("permissions" ? 'systemSettings')
  AND jsonb_typeof("permissions"->'roles') = 'array'
  AND ("permissions"->'roles') ? 'edit';

-- 9. Backfill apps when missing
UPDATE "Role"
SET "permissions" = jsonb_set(
  "permissions",
  '{apps}',
  CASE
    WHEN EXISTS (
      SELECT 1
      FROM jsonb_each("permissions") AS kv(k, v)
      WHERE k IN ('projects','clients','permits','users','services','providedServices','categories','reminders','invoices','companyInfo','history')
        AND jsonb_typeof(v) = 'array'
        AND jsonb_array_length(v) > 0
    )
    THEN '["project-tracker","data-management"]'::jsonb
    ELSE '["project-tracker"]'::jsonb
  END,
  true
)
WHERE "isSystemAdmin" = false
  AND NOT ("permissions" ? 'apps');

-- 10. Append 'system' to permissions->'apps' when role holds any system resource permission
UPDATE "Role"
SET "permissions" = jsonb_set(
  "permissions",
  '{apps}',
  COALESCE("permissions"->'apps', '[]'::jsonb) || '["system"]'::jsonb,
  true
)
WHERE "isSystemAdmin" = false
  AND jsonb_typeof("permissions"->'apps') = 'array'
  AND NOT (("permissions"->'apps') ? 'system')
  AND EXISTS (
    SELECT 1
    FROM jsonb_each("permissions") AS kv(k, v)
    WHERE k IN ('roles','activityLogs','activityAnalytics','systemSettings')
      AND jsonb_typeof(v) = 'array'
      AND jsonb_array_length(v) > 0
  );
