-- Normalize Reminder statuses to canonical lowercase slugs
UPDATE "Reminder"
SET "status" = CASE
  WHEN LOWER(TRIM("status")) IN ('completed', 'završeno', 'завршено', 'done') THEN 'completed'
  WHEN LOWER(TRIM("status")) IN ('in progress', 'in_progress', 'u toku', 'у току') THEN 'in_progress'
  WHEN LOWER(TRIM("status")) IN ('overdue', 'prekoračeno', 'прекорачено', 'kasni', 'касни') THEN 'overdue'
  WHEN LOWER(TRIM("status")) IN ('draft') THEN 'draft'
  ELSE 'pending'
END
WHERE "status" IS NOT NULL;

-- Normalize Invoice statuses to canonical lowercase slugs
UPDATE "Invoice"
SET "status" = CASE
  WHEN LOWER(TRIM("status")) IN ('paid', 'plaćeno', 'плаћено') THEN 'paid'
  WHEN LOWER(TRIM("status")) IN ('sent', 'poslato', 'послато') THEN 'sent'
  WHEN LOWER(TRIM("status")) IN ('overdue', 'prekoračeno', 'kasni') THEN 'overdue'
  WHEN LOWER(TRIM("status")) IN ('cancelled', 'otkazano', 'отказано', 'canceled') THEN 'cancelled'
  ELSE 'draft'
END
WHERE "status" IS NOT NULL;

-- Normalize Invoice invoiceType to canonical lowercase slugs
UPDATE "Invoice"
SET "invoiceType" = CASE
  WHEN LOWER(TRIM("invoiceType")) = 'advance' THEN 'advance'
  WHEN LOWER(TRIM("invoiceType")) = 'final' THEN 'final'
  WHEN LOWER(TRIM("invoiceType")) = 'partial' THEN 'partial'
  ELSE 'standard'
END
WHERE "invoiceType" IS NOT NULL;

-- Normalize ProvidedService statuses to canonical lowercase slugs
UPDATE "ProvidedService"
SET "status" = CASE
  WHEN LOWER(TRIM("status")) IN ('completed', 'završeno', 'завршено') THEN 'completed'
  WHEN LOWER(TRIM("status")) IN ('in progress', 'in_progress', 'u toku', 'у току') THEN 'in_progress'
  WHEN LOWER(TRIM("status")) IN ('cancelled', 'otkazano', 'отказано', 'canceled') THEN 'cancelled'
  ELSE 'planned'
END
WHERE "status" IS NOT NULL;

-- Normalize User status to canonical lowercase slugs
UPDATE "User"
SET "status" = CASE
  WHEN LOWER(TRIM("status")) = 'approved' THEN 'approved'
  WHEN LOWER(TRIM("status")) = 'blocked' THEN 'blocked'
  WHEN LOWER(TRIM("status")) = 'rejected' THEN 'rejected'
  ELSE 'pending'
END
WHERE "status" IS NOT NULL;

-- Migrate auto-generated custom field IDs in Service.customDataModel to canonical custom IDs
UPDATE "Service"
SET "customDataModel" = REPLACE(
  REPLACE(
    REPLACE(
      "customDataModel"::text,
      'field_1788029154873_lroa',
      'kolicina_kg'
    ),
    'field_1788029202955_o1sd',
    'vrsta_otpada'
  ),
  'field_1788107761562_w35o',
  'transport'
)::jsonb
WHERE "customDataModel"::text LIKE '%field_1788029154873_lroa%'
   OR "customDataModel"::text LIKE '%field_1788029202955_o1sd%'
   OR "customDataModel"::text LIKE '%field_1788107761562_w35o%';

-- Migrate customData keys in ProvidedService to canonical custom IDs
UPDATE "ProvidedService"
SET "customData" = ("customData" - 'field_1788029154873_lroa') || jsonb_build_object('kolicina_kg', "customData"->'field_1788029154873_lroa')
WHERE "customData" ? 'field_1788029154873_lroa';

UPDATE "ProvidedService"
SET "customData" = ("customData" - 'field_1788029202955_o1sd') || jsonb_build_object('vrsta_otpada', "customData"->'field_1788029202955_o1sd')
WHERE "customData" ? 'field_1788029202955_o1sd';

UPDATE "ProvidedService"
SET "customData" = ("customData" - 'field_1788107761562_w35o') || jsonb_build_object('transport', "customData"->'field_1788107761562_w35o')
WHERE "customData" ? 'field_1788107761562_w35o';


