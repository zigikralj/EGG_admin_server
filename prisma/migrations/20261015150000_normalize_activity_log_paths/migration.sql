-- Normalize historical activity log paths
UPDATE "ActivityLog" SET "path" = '/api/categories' WHERE "path" = '/api/categorys';
UPDATE "ActivityLog" SET "path" = '/api/provided-services' WHERE "path" = '/api/providedservices';
UPDATE "ActivityLog" SET "path" = '/api/invoices' WHERE "path" IN ('/api/invoiceitems', '/api/invoice-items');
