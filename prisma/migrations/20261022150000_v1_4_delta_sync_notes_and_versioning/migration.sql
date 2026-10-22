-- ============================================================================
-- Consolidated Migration: v1.4.0 Delta Sync, Notes Refactoring & Versioning
-- Consolidates unapplied development migrations (Oct 19 - Oct 22, 2026):
--   1. 20261019180740_add_delta_versioning
--   2. 20261019202600_remove_next_sample
--   3. 20261020143127_lazy_loading_notes_preview_and_monthly_stats
--   4. 20261021154500_add_project_note_entity
--   5. 20261021221943_add_updated_at_delta_indexes
-- ============================================================================

-- ============================================================================
-- 1. SCHEMA MODIFICATIONS (Tables & Columns)
-- ============================================================================

-- Drop deprecated column from Project
ALTER TABLE "Project" DROP COLUMN IF EXISTS "nextSample";

-- Add notesPreview column to Project for lightweight list queries
ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "notesPreview" TEXT;

-- Create ActivityLogMonthlyStats table for pre-aggregated analytics
CREATE TABLE IF NOT EXISTS "ActivityLogMonthlyStats" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "yearMonth" TEXT NOT NULL,
    "totalDurationSeconds" INTEGER NOT NULL DEFAULT 0,
    "sessionCount" INTEGER NOT NULL DEFAULT 0,
    "actionCount" INTEGER NOT NULL DEFAULT 0,
    "moduleBreakdown" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ActivityLogMonthlyStats_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ActivityLogMonthlyStats_yearMonth_idx" ON "ActivityLogMonthlyStats"("yearMonth");
CREATE UNIQUE INDEX IF NOT EXISTS "ActivityLogMonthlyStats_userId_yearMonth_key" ON "ActivityLogMonthlyStats"("userId", "yearMonth");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ActivityLogMonthlyStats_userId_fkey'
  ) THEN
    ALTER TABLE "ActivityLogMonthlyStats" ADD CONSTRAINT "ActivityLogMonthlyStats_userId_fkey" 
      FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- Create ProjectNote & ProjectNoteVersion tables
CREATE TABLE IF NOT EXISTS "ProjectNote" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "content" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectNote_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ProjectNoteVersion" (
    "id" BIGSERIAL NOT NULL,
    "noteId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "content" TEXT,
    "patch" TEXT,
    "charDelta" INTEGER NOT NULL DEFAULT 0,
    "authorId" TEXT,
    "authorName" TEXT,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectNoteVersion_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ProjectNote_projectId_key" ON "ProjectNote"("projectId");
CREATE INDEX IF NOT EXISTS "ProjectNote_projectId_idx" ON "ProjectNote"("projectId");
CREATE INDEX IF NOT EXISTS "ProjectNoteVersion_noteId_kind_version_idx" ON "ProjectNoteVersion"("noteId", "kind", "version");
CREATE INDEX IF NOT EXISTS "ProjectNoteVersion_noteId_createdAt_idx" ON "ProjectNoteVersion"("noteId", "createdAt");
CREATE UNIQUE INDEX IF NOT EXISTS "ProjectNoteVersion_noteId_version_key" ON "ProjectNoteVersion"("noteId", "version");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ProjectNote_projectId_fkey') THEN
    ALTER TABLE "ProjectNote" ADD CONSTRAINT "ProjectNote_projectId_fkey" 
      FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ProjectNote_updatedById_fkey') THEN
    ALTER TABLE "ProjectNote" ADD CONSTRAINT "ProjectNote_updatedById_fkey" 
      FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ProjectNoteVersion_noteId_fkey') THEN
    ALTER TABLE "ProjectNoteVersion" ADD CONSTRAINT "ProjectNoteVersion_noteId_fkey" 
      FOREIGN KEY ("noteId") REFERENCES "ProjectNote"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- Delta Sync updatedAt Indexes
CREATE INDEX IF NOT EXISTS "Client_updatedAt_idx" ON "Client"("updatedAt");
CREATE INDEX IF NOT EXISTS "Invoice_updatedAt_idx" ON "Invoice"("updatedAt");
CREATE INDEX IF NOT EXISTS "Permit_updatedAt_idx" ON "Permit"("updatedAt");
CREATE INDEX IF NOT EXISTS "Project_updatedAt_idx" ON "Project"("updatedAt");
CREATE INDEX IF NOT EXISTS "ProvidedService_updatedAt_idx" ON "ProvidedService"("updatedAt");
CREATE INDEX IF NOT EXISTS "Reminder_updatedAt_idx" ON "Reminder"("updatedAt");

-- ============================================================================
-- 2. DATA BACKFILL (Executed before audit triggers exist to prevent trigger churn)
-- ============================================================================

DO $$
DECLARE
  r RECORD;
  new_note_id TEXT;
  has_notes_col BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'Project' AND column_name = 'notes'
  ) INTO has_notes_col;

  IF has_notes_col THEN
    -- Migrate existing Project.notes into ProjectNote and baseline ProjectNoteVersion
    FOR r IN SELECT id, notes, "createdAt", "updatedAt" FROM "Project" WHERE notes IS NOT NULL AND notes != '' LOOP
      new_note_id := gen_random_uuid()::text;
      
      INSERT INTO "ProjectNote" ("id", "projectId", "content", "version", "createdAt", "updatedAt")
      VALUES (new_note_id, r.id, r.notes, 1, r."createdAt", r."updatedAt")
      ON CONFLICT ("projectId") DO NOTHING;
      
      INSERT INTO "ProjectNoteVersion" ("noteId", "version", "kind", "content", "charDelta", "authorName", "reason", "createdAt")
      VALUES (new_note_id, 1, 'S', r.notes, LENGTH(r.notes), 'System Migration', 'Baseline migration', r."updatedAt");
    END LOOP;

    -- Backfill notesPreview on Project
    UPDATE "Project"
    SET "notesPreview" = LEFT(TRIM(regexp_replace(COALESCE("notes", ''), '<[^>]+>', ' ', 'g')), 300)
    WHERE "notesPreview" IS NULL;

    -- Drop legacy notes column from Project
    ALTER TABLE "Project" DROP COLUMN "notes";
  END IF;
END $$;

-- ============================================================================
-- 3. AUDIT & VERSIONING INFRASTRUCTURE (ChangeSet, EntityVersion, Immutability)
-- ============================================================================

CREATE TABLE IF NOT EXISTS "ChangeSet" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "userName" TEXT,
    "sessionId" TEXT,
    "requestId" TEXT,
    "method" TEXT,
    "route" TEXT,
    "source" TEXT NOT NULL DEFAULT 'api',
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChangeSet_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "EntityVersion" (
    "id" BIGSERIAL NOT NULL,
    "changeSetId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "op" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "changedFields" TEXT[],
    "parentType" TEXT,
    "parentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EntityVersion_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ChangeSet_createdAt_idx" ON "ChangeSet"("createdAt");
CREATE INDEX IF NOT EXISTS "ChangeSet_userId_createdAt_idx" ON "ChangeSet"("userId", "createdAt");
CREATE INDEX IF NOT EXISTS "EntityVersion_entityType_entityId_createdAt_idx" ON "EntityVersion"("entityType", "entityId", "createdAt");
CREATE INDEX IF NOT EXISTS "EntityVersion_parentType_parentId_createdAt_idx" ON "EntityVersion"("parentType", "parentId", "createdAt");
CREATE INDEX IF NOT EXISTS "EntityVersion_changeSetId_idx" ON "EntityVersion"("changeSetId");
CREATE UNIQUE INDEX IF NOT EXISTS "EntityVersion_entityType_entityId_version_key" ON "EntityVersion"("entityType", "entityId", "version");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'EntityVersion_changeSetId_fkey') THEN
    ALTER TABLE "EntityVersion" ADD CONSTRAINT "EntityVersion_changeSetId_fkey" 
      FOREIGN KEY ("changeSetId") REFERENCES "ChangeSet"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- Enable LZ4 storage compression if available
DO $$
BEGIN
  ALTER TABLE "EntityVersion" ALTER COLUMN "data" SET COMPRESSION lz4;
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

-- Create audit schema & immutability trigger function
CREATE SCHEMA IF NOT EXISTS audit;

CREATE OR REPLACE FUNCTION audit.prevent_tampering()
RETURNS TRIGGER AS $$
BEGIN
  IF current_setting('audit.allow_cleanup', true) = 'true' THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    ELSE
      RAISE EXCEPTION 'Audit records cannot be modified';
    END IF;
  END IF;
  RAISE EXCEPTION 'Audit records are immutable and cannot be modified or deleted directly';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS check_entity_version_immutable ON "EntityVersion";
CREATE TRIGGER check_entity_version_immutable
BEFORE UPDATE OR DELETE ON "EntityVersion"
FOR EACH ROW EXECUTE FUNCTION audit.prevent_tampering();

DROP TRIGGER IF EXISTS check_changeset_immutable ON "ChangeSet";
CREATE TRIGGER check_changeset_immutable
BEFORE UPDATE OR DELETE ON "ChangeSet"
FOR EACH ROW EXECUTE FUNCTION audit.prevent_tampering();

-- ============================================================================
-- 4. CLEAN BASELINE SNAPSHOTS (Captured on finalized clean schema)
-- ============================================================================

DO $$
DECLARE
  cs_id TEXT := gen_random_uuid()::text;
  has_data BOOLEAN := false;
  already_baselined BOOLEAN := false;
BEGIN
  SELECT EXISTS (SELECT 1 FROM "EntityVersion" LIMIT 1) INTO already_baselined;

  IF NOT already_baselined THEN
    IF EXISTS (SELECT 1 FROM "Project" LIMIT 1) OR
       EXISTS (SELECT 1 FROM "Client" LIMIT 1) OR
       EXISTS (SELECT 1 FROM "User" LIMIT 1) THEN
      has_data := true;
    END IF;

    IF has_data THEN
      INSERT INTO "ChangeSet" ("id", "source", "reason", "createdAt")
      VALUES (cs_id, 'system', 'Initial baseline snapshot', clock_timestamp())
      ON CONFLICT DO NOTHING;

      -- Baseline for Project
      INSERT INTO "EntityVersion" ("changeSetId", "entityType", "entityId", "version", "op", "kind", "data", "changedFields", "createdAt")
      SELECT cs_id, 'Project', id, 1, 'B', 'S', to_jsonb(p), ARRAY(SELECT jsonb_object_keys(to_jsonb(p))), clock_timestamp()
      FROM "Project" p;

      -- Baseline for Client
      INSERT INTO "EntityVersion" ("changeSetId", "entityType", "entityId", "version", "op", "kind", "data", "changedFields", "createdAt")
      SELECT cs_id, 'Client', id, 1, 'B', 'S', to_jsonb(c), ARRAY(SELECT jsonb_object_keys(to_jsonb(c))), clock_timestamp()
      FROM "Client" c;

      -- Baseline for User (redacting password)
      INSERT INTO "EntityVersion" ("changeSetId", "entityType", "entityId", "version", "op", "kind", "data", "changedFields", "createdAt")
      SELECT cs_id, 'User', id, 1, 'B', 'S', 
        jsonb_set(to_jsonb(u), '{password}', '"[redacted]"'::jsonb), 
        ARRAY(SELECT jsonb_object_keys(to_jsonb(u))), clock_timestamp()
      FROM "User" u;

      -- Baseline for Category
      INSERT INTO "EntityVersion" ("changeSetId", "entityType", "entityId", "version", "op", "kind", "data", "changedFields", "createdAt")
      SELECT cs_id, 'Category', id, 1, 'B', 'S', to_jsonb(c), ARRAY(SELECT jsonb_object_keys(to_jsonb(c))), clock_timestamp()
      FROM "Category" c;

      -- Baseline for Service
      INSERT INTO "EntityVersion" ("changeSetId", "entityType", "entityId", "version", "op", "kind", "data", "changedFields", "createdAt")
      SELECT cs_id, 'Service', id, 1, 'B', 'S', to_jsonb(s), ARRAY(SELECT jsonb_object_keys(to_jsonb(s))), clock_timestamp()
      FROM "Service" s;

      -- Baseline for Invoice
      INSERT INTO "EntityVersion" ("changeSetId", "entityType", "entityId", "version", "op", "kind", "data", "changedFields", "createdAt")
      SELECT cs_id, 'Invoice', id, 1, 'B', 'S', to_jsonb(i), ARRAY(SELECT jsonb_object_keys(to_jsonb(i))), clock_timestamp()
      FROM "Invoice" i;

      -- Baseline for InvoiceItem (with parent)
      INSERT INTO "EntityVersion" ("changeSetId", "entityType", "entityId", "version", "op", "kind", "data", "changedFields", "parentType", "parentId", "createdAt")
      SELECT cs_id, 'InvoiceItem', id, 1, 'B', 'S', to_jsonb(ii), ARRAY(SELECT jsonb_object_keys(to_jsonb(ii))), 'Invoice', ii."invoiceId", clock_timestamp()
      FROM "InvoiceItem" ii;

      -- Baseline for ProvidedService (with parent)
      INSERT INTO "EntityVersion" ("changeSetId", "entityType", "entityId", "version", "op", "kind", "data", "changedFields", "parentType", "parentId", "createdAt")
      SELECT cs_id, 'ProvidedService', id, 1, 'B', 'S', to_jsonb(ps), ARRAY(SELECT jsonb_object_keys(to_jsonb(ps))),
        CASE WHEN ps."projectId" IS NOT NULL THEN 'Project' WHEN ps."invoiceId" IS NOT NULL THEN 'Invoice' ELSE 'Client' END,
        COALESCE(ps."projectId", ps."invoiceId", ps."clientId"),
        clock_timestamp()
      FROM "ProvidedService" ps;

      -- Baseline for Reminder (with parent)
      INSERT INTO "EntityVersion" ("changeSetId", "entityType", "entityId", "version", "op", "kind", "data", "changedFields", "parentType", "parentId", "createdAt")
      SELECT cs_id, 'Reminder', id, 1, 'B', 'S', to_jsonb(r), ARRAY(SELECT jsonb_object_keys(to_jsonb(r))),
        CASE WHEN r."projectId" IS NOT NULL THEN 'Project' WHEN r."clientId" IS NOT NULL THEN 'Client' WHEN r."permitId" IS NOT NULL THEN 'Permit' ELSE NULL END,
        COALESCE(r."projectId", r."clientId", r."permitId"),
        clock_timestamp()
      FROM "Reminder" r;

      -- Baseline for Permit
      INSERT INTO "EntityVersion" ("changeSetId", "entityType", "entityId", "version", "op", "kind", "data", "changedFields", "createdAt")
      SELECT cs_id, 'Permit', id, 1, 'B', 'S', to_jsonb(p), ARRAY(SELECT jsonb_object_keys(to_jsonb(p))), clock_timestamp()
      FROM "Permit" p;

      -- Baseline for PermitWaste (with parent)
      INSERT INTO "EntityVersion" ("changeSetId", "entityType", "entityId", "version", "op", "kind", "data", "changedFields", "parentType", "parentId", "createdAt")
      SELECT cs_id, 'PermitWaste', id, 1, 'B', 'S', to_jsonb(pw), ARRAY(SELECT jsonb_object_keys(to_jsonb(pw))), 'Permit', pw."permitId", clock_timestamp()
      FROM "PermitWaste" pw;

      -- Baseline for WasteCatalog
      INSERT INTO "EntityVersion" ("changeSetId", "entityType", "entityId", "version", "op", "kind", "data", "changedFields", "createdAt")
      SELECT cs_id, 'WasteCatalog', id, 1, 'B', 'S', to_jsonb(wc), ARRAY(SELECT jsonb_object_keys(to_jsonb(wc))), clock_timestamp()
      FROM "WasteCatalog" wc;

      -- Baseline for CompanyInfo
      INSERT INTO "EntityVersion" ("changeSetId", "entityType", "entityId", "version", "op", "kind", "data", "changedFields", "createdAt")
      SELECT cs_id, 'CompanyInfo', id, 1, 'B', 'S', to_jsonb(ci), ARRAY(SELECT jsonb_object_keys(to_jsonb(ci))), clock_timestamp()
      FROM "CompanyInfo" ci;

      -- Baseline for ClientExtraData (with parent)
      INSERT INTO "EntityVersion" ("changeSetId", "entityType", "entityId", "version", "op", "kind", "data", "changedFields", "parentType", "parentId", "createdAt")
      SELECT cs_id, 'ClientExtraData', id, 1, 'B', 'S', to_jsonb(ced), ARRAY(SELECT jsonb_object_keys(to_jsonb(ced))), 'Client', ced."clientId", clock_timestamp()
      FROM "ClientExtraData" ced;
    END IF;
  END IF;
END $$;

-- ============================================================================
-- 5. AUDIT CAPTURE TRIGGER FUNCTION & TRIGGERS
-- ============================================================================

CREATE OR REPLACE FUNCTION audit.capture()
RETURNS TRIGGER AS $$
DECLARE
  entity_id TEXT;
  old_json JSONB;
  new_json JSONB;
  delta_json JSONB := '{}'::jsonb;
  payload_data JSONB;
  changed_fields TEXT[] := ARRAY[]::TEXT[];
  key_name TEXT;
  cs_id TEXT;
  op_type TEXT;
  kind_type TEXT;
  next_version INT;
  parent_type TEXT := NULL;
  parent_id TEXT := NULL;
  src TEXT;
BEGIN
  -- Maintenance bypass check
  IF current_setting('audit.disabled', true) = 'true' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;

  -- 1. Determine entity id and op type
  IF TG_OP = 'DELETE' THEN
    entity_id := OLD.id::text;
    op_type := 'D';
  ELSIF TG_OP = 'INSERT' THEN
    entity_id := NEW.id::text;
    op_type := 'I';
  ELSE
    entity_id := NEW.id::text;
    op_type := 'U';
  END IF;

  -- 2. Build JSON representations and handle redactions / diffs
  IF TG_OP = 'INSERT' THEN
    new_json := to_jsonb(NEW);
    FOR key_name IN SELECT jsonb_object_keys(new_json) LOOP
      IF key_name ILIKE '%password%' OR key_name ILIKE '%token%' OR key_name ILIKE '%secret%' THEN
        new_json := jsonb_set(new_json, ARRAY[key_name], '"[redacted]"'::jsonb);
      END IF;
      changed_fields := array_append(changed_fields, key_name);
    END LOOP;
    payload_data := new_json;

  ELSIF TG_OP = 'DELETE' THEN
    old_json := to_jsonb(OLD);
    FOR key_name IN SELECT jsonb_object_keys(old_json) LOOP
      IF key_name ILIKE '%password%' OR key_name ILIKE '%token%' OR key_name ILIKE '%secret%' THEN
        old_json := jsonb_set(old_json, ARRAY[key_name], '"[redacted]"'::jsonb);
      END IF;
      changed_fields := array_append(changed_fields, key_name);
    END LOOP;
    payload_data := old_json;

  ELSIF TG_OP = 'UPDATE' THEN
    old_json := to_jsonb(OLD);
    new_json := to_jsonb(NEW);

    FOR key_name IN SELECT jsonb_object_keys(new_json) LOOP
      -- Ignore updatedAt changes alone
      IF key_name = 'updatedAt' THEN
        CONTINUE;
      END IF;

      IF (old_json -> key_name) IS DISTINCT FROM (new_json -> key_name) THEN
        IF key_name ILIKE '%password%' OR key_name ILIKE '%token%' OR key_name ILIKE '%secret%' THEN
          delta_json := delta_json || jsonb_build_object(key_name, '[redacted]');
        ELSE
          delta_json := delta_json || jsonb_build_object(key_name, new_json -> key_name);
        END IF;
        changed_fields := array_append(changed_fields, key_name);
      END IF;
    END LOOP;

    -- If no tracked fields changed (e.g. only updatedAt changed), skip version generation
    IF cardinality(changed_fields) = 0 THEN
      RETURN NEW;
    END IF;

    -- Redact sensitive fields in full new_json as well in case this is a keyframe
    FOR key_name IN SELECT jsonb_object_keys(new_json) LOOP
      IF key_name ILIKE '%password%' OR key_name ILIKE '%token%' OR key_name ILIKE '%secret%' THEN
        new_json := jsonb_set(new_json, ARRAY[key_name], '"[redacted]"'::jsonb);
      END IF;
    END LOOP;
  END IF;

  -- 3. Calculate next version number
  SELECT COALESCE(MAX(version), 0) + 1 INTO next_version
  FROM "EntityVersion"
  WHERE "entityType" = TG_TABLE_NAME AND "entityId" = entity_id;

  -- 4. Determine snapshot vs delta kind
  IF op_type = 'D' THEN
    kind_type := 'S';
  ELSIF next_version = 1 OR next_version % 20 = 0 THEN
    kind_type := 'S';
    payload_data := new_json;
  ELSE
    kind_type := 'D';
    payload_data := delta_json;
  END IF;

  -- 5. Determine parent linking
  IF TG_TABLE_NAME = 'InvoiceItem' THEN
    parent_type := 'Invoice';
    IF TG_OP = 'DELETE' THEN parent_id := OLD."invoiceId"; ELSE parent_id := NEW."invoiceId"; END IF;
  ELSIF TG_TABLE_NAME = 'PermitWaste' THEN
    parent_type := 'Permit';
    IF TG_OP = 'DELETE' THEN parent_id := OLD."permitId"; ELSE parent_id := NEW."permitId"; END IF;
  ELSIF TG_TABLE_NAME = 'ClientExtraData' THEN
    parent_type := 'Client';
    IF TG_OP = 'DELETE' THEN parent_id := OLD."clientId"; ELSE parent_id := NEW."clientId"; END IF;
  ELSIF TG_TABLE_NAME = 'ProvidedService' THEN
    IF TG_OP = 'DELETE' THEN
      IF OLD."projectId" IS NOT NULL THEN parent_type := 'Project'; parent_id := OLD."projectId";
      ELSIF OLD."invoiceId" IS NOT NULL THEN parent_type := 'Invoice'; parent_id := OLD."invoiceId";
      ELSE parent_type := 'Client'; parent_id := OLD."clientId";
      END IF;
    ELSE
      IF NEW."projectId" IS NOT NULL THEN parent_type := 'Project'; parent_id := NEW."projectId";
      ELSIF NEW."invoiceId" IS NOT NULL THEN parent_type := 'Invoice'; parent_id := NEW."invoiceId";
      ELSE parent_type := 'Client'; parent_id := NEW."clientId";
      END IF;
    END IF;
  ELSIF TG_TABLE_NAME = 'Reminder' THEN
    IF TG_OP = 'DELETE' THEN
      IF OLD."projectId" IS NOT NULL THEN parent_type := 'Project'; parent_id := OLD."projectId";
      ELSIF OLD."clientId" IS NOT NULL THEN parent_type := 'Client'; parent_id := OLD."clientId";
      ELSIF OLD."permitId" IS NOT NULL THEN parent_type := 'Permit'; parent_id := OLD."permitId";
      END IF;
    ELSE
      IF NEW."projectId" IS NOT NULL THEN parent_type := 'Project'; parent_id := NEW."projectId";
      ELSIF NEW."clientId" IS NOT NULL THEN parent_type := 'Client'; parent_id := NEW."clientId";
      ELSIF NEW."permitId" IS NOT NULL THEN parent_type := 'Permit'; parent_id := NEW."permitId";
      END IF;
    END IF;
  END IF;

  -- 6. Resolve or create ChangeSet for current transaction
  cs_id := nullif(current_setting('audit.changeset_id', true), '');
  IF cs_id IS NULL THEN
    cs_id := gen_random_uuid()::text;
    src := coalesce(
      nullif(current_setting('audit.source', true), ''),
      case when nullif(current_setting('audit.user_id', true), '') is not null then 'api' else 'system' end
    );

    INSERT INTO "ChangeSet" (
      "id",
      "userId",
      "userName",
      "sessionId",
      "requestId",
      "method",
      "route",
      "source",
      "reason",
      "createdAt"
    ) VALUES (
      cs_id,
      nullif(current_setting('audit.user_id', true), ''),
      nullif(current_setting('audit.user_name', true), ''),
      nullif(current_setting('audit.session_id', true), ''),
      nullif(current_setting('audit.request_id', true), ''),
      nullif(current_setting('audit.method', true), ''),
      nullif(current_setting('audit.route', true), ''),
      src,
      nullif(current_setting('audit.reason', true), ''),
      clock_timestamp()
    );

    PERFORM set_config('audit.changeset_id', cs_id, true);
  END IF;

  -- 7. Insert version record
  INSERT INTO "EntityVersion" (
    "changeSetId",
    "entityType",
    "entityId",
    "version",
    "op",
    "kind",
    "data",
    "changedFields",
    "parentType",
    "parentId",
    "createdAt"
  ) VALUES (
    cs_id,
    TG_TABLE_NAME,
    entity_id,
    next_version,
    op_type,
    kind_type,
    payload_data,
    changed_fields,
    parent_type,
    parent_id,
    clock_timestamp()
  );

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  ELSE
    RETURN NEW;
  END IF;
END;
$$ LANGUAGE plpgsql;

-- Attach Audit Triggers to all 14 Tracked Tables
DROP TRIGGER IF EXISTS audit_project_trigger ON "Project";
CREATE TRIGGER audit_project_trigger AFTER INSERT OR UPDATE OR DELETE ON "Project" FOR EACH ROW EXECUTE FUNCTION audit.capture();

DROP TRIGGER IF EXISTS audit_client_trigger ON "Client";
CREATE TRIGGER audit_client_trigger AFTER INSERT OR UPDATE OR DELETE ON "Client" FOR EACH ROW EXECUTE FUNCTION audit.capture();

DROP TRIGGER IF EXISTS audit_client_extra_data_trigger ON "ClientExtraData";
CREATE TRIGGER audit_client_extra_data_trigger AFTER INSERT OR UPDATE OR DELETE ON "ClientExtraData" FOR EACH ROW EXECUTE FUNCTION audit.capture();

DROP TRIGGER IF EXISTS audit_service_trigger ON "Service";
CREATE TRIGGER audit_service_trigger AFTER INSERT OR UPDATE OR DELETE ON "Service" FOR EACH ROW EXECUTE FUNCTION audit.capture();

DROP TRIGGER IF EXISTS audit_category_trigger ON "Category";
CREATE TRIGGER audit_category_trigger AFTER INSERT OR UPDATE OR DELETE ON "Category" FOR EACH ROW EXECUTE FUNCTION audit.capture();

DROP TRIGGER IF EXISTS audit_reminder_trigger ON "Reminder";
CREATE TRIGGER audit_reminder_trigger AFTER INSERT OR UPDATE OR DELETE ON "Reminder" FOR EACH ROW EXECUTE FUNCTION audit.capture();

DROP TRIGGER IF EXISTS audit_invoice_trigger ON "Invoice";
CREATE TRIGGER audit_invoice_trigger AFTER INSERT OR UPDATE OR DELETE ON "Invoice" FOR EACH ROW EXECUTE FUNCTION audit.capture();

DROP TRIGGER IF EXISTS audit_invoice_item_trigger ON "InvoiceItem";
CREATE TRIGGER audit_invoice_item_trigger AFTER INSERT OR UPDATE OR DELETE ON "InvoiceItem" FOR EACH ROW EXECUTE FUNCTION audit.capture();

DROP TRIGGER IF EXISTS audit_provided_service_trigger ON "ProvidedService";
CREATE TRIGGER audit_provided_service_trigger AFTER INSERT OR UPDATE OR DELETE ON "ProvidedService" FOR EACH ROW EXECUTE FUNCTION audit.capture();

DROP TRIGGER IF EXISTS audit_permit_trigger ON "Permit";
CREATE TRIGGER audit_permit_trigger AFTER INSERT OR UPDATE OR DELETE ON "Permit" FOR EACH ROW EXECUTE FUNCTION audit.capture();

DROP TRIGGER IF EXISTS audit_permit_waste_trigger ON "PermitWaste";
CREATE TRIGGER audit_permit_waste_trigger AFTER INSERT OR UPDATE OR DELETE ON "PermitWaste" FOR EACH ROW EXECUTE FUNCTION audit.capture();

DROP TRIGGER IF EXISTS audit_waste_catalog_trigger ON "WasteCatalog";
CREATE TRIGGER audit_waste_catalog_trigger AFTER INSERT OR UPDATE OR DELETE ON "WasteCatalog" FOR EACH ROW EXECUTE FUNCTION audit.capture();

DROP TRIGGER IF EXISTS audit_company_info_trigger ON "CompanyInfo";
CREATE TRIGGER audit_company_info_trigger AFTER INSERT OR UPDATE OR DELETE ON "CompanyInfo" FOR EACH ROW EXECUTE FUNCTION audit.capture();

DROP TRIGGER IF EXISTS audit_user_trigger ON "User";
CREATE TRIGGER audit_user_trigger AFTER INSERT OR UPDATE OR DELETE ON "User" FOR EACH ROW EXECUTE FUNCTION audit.capture();
