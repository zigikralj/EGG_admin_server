-- AlterTable
ALTER TABLE "Invoice" ALTER COLUMN "invoiceType" SET DEFAULT 'Standard';

-- CreateTable
CREATE TABLE "Role" (
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isSystemAdmin" BOOLEAN NOT NULL DEFAULT false,
    "permissions" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Role_pkey" PRIMARY KEY ("name")
);


-- Seed Default Roles
INSERT INTO "Role" ("name", "description", "isSystemAdmin", "permissions", "createdAt", "updatedAt") VALUES
('Administrator', 'System Administrator', true, '{}', NOW(), NOW()),
('Manager', 'Manager Role', false, '{"projects":["view","create","edit","delete"],"clients":["view","create","edit","delete"],"permits":["view","create","edit","delete"],"users":["view"],"services":["view","create","edit","delete"],"providedServices":["view","create","edit","delete"],"categories":["view","create","edit","delete"],"reminders":["view","create","edit","delete"],"invoices":["view","create","edit","delete"]}', NOW(), NOW()),
('User', 'Regular User', false, '{"projects":["view"],"clients":["view"],"permits":["view"],"users":[],"services":["view"],"providedServices":["view","create","edit"],"categories":["view"],"reminders":["view","create","edit"],"invoices":["view"]}', NOW(), NOW()),
('Accountant', 'Accountant', false, '{"projects":["view"],"clients":["view"],"permits":["view"],"users":[],"services":["view"],"providedServices":["view"],"categories":["view"],"reminders":["view"],"invoices":["view","create","edit","delete"]}', NOW(), NOW());

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_role_fkey" FOREIGN KEY ("role") REFERENCES "Role"("name") ON DELETE RESTRICT ON UPDATE CASCADE;
