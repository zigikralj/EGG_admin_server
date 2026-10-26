import { Router } from "express";
import { prisma } from "../db";
import { asyncHandler } from "../middleware/errorHandler";
import { requireAuth } from "../middleware/auth";
import { hasPermission } from "../types";
import { formatPermit } from "./permits.routes";
import { parseSince, fetchDeletedIds, buildDeltaResponse } from "../helpers/deltaSync";

const router = Router();

router.use(requireAuth);

function formatClientPermits(permits: any[], fallbackPermit?: any) {
  const formatted = (permits && permits.length > 0)
    ? permits.map(formatPermit)
    : (fallbackPermit ? [formatPermit(fallbackPermit)] : []);
  const primary = formatted[0] || null;
  return {
    permits: formatted,
    permitId: primary?.id || null,
    permit: primary,
  };
}

import { parsePagination, buildPaginatedResponse } from "../helpers/pagination";

// GET /api/clients
router.get("/", asyncHandler(async (req, res) => {
  const isPaginated = req.query.page !== undefined || req.query.limit !== undefined;
  const sinceDate = parseSince(req.query.since);

  const search = ((req.query.search as string) || "").trim();
  const city = (req.query.city as string) || "";
  const hasPermit = (req.query.hasPermit as string) || "";
  const permitType = ((req.query.permitType as string) || "").trim();

  const where: any = {};
  if (city && city !== "all") {
    where.city = { equals: city, mode: "insensitive" };
  }
  if (hasPermit === "true") {
    where.permits = { some: {} };
  } else if (hasPermit === "false") {
    where.permits = { none: {} };
  }

  if (permitType && permitType !== "all") {
    where.OR = [
      { permits: { some: { permitTypes: { has: permitType } } } },
      { extraData: { permit: { permitTypes: { has: permitType } } } },
    ];
  }

  if (search) {
    const searchConditions = [
      { name: { contains: search, mode: "insensitive" as const } },
      { contactPerson: { contains: search, mode: "insensitive" as const } },
      { email: { contains: search, mode: "insensitive" as const } },
      { phone: { contains: search, mode: "insensitive" as const } },
      { city: { contains: search, mode: "insensitive" as const } },
      { pib: { contains: search, mode: "insensitive" as const } },
      { mb: { contains: search, mode: "insensitive" as const } },
      { address: { contains: search, mode: "insensitive" as const } },
    ];

    if (where.OR) {
      where.AND = [{ OR: where.OR }, { OR: searchConditions }];
      delete where.OR;
    } else {
      where.OR = searchConditions;
    }
  }

  // Summary mode (optimized for autocompletes and dropdowns)
  if (req.query.fields === "summary") {
    if (isPaginated) {
      const pagination = parsePagination(req.query, {
        defaultSortBy: "name",
        defaultSortOrder: "asc",
        maxLimit: 100,
      });

      const [total, summaryClients] = await Promise.all([
        prisma.client.count({ where }),
        prisma.client.findMany({
          where,
          skip: pagination.skip,
          take: pagination.take,
          orderBy: { name: pagination.sortOrder },
          select: { id: true, name: true, city: true },
        }),
      ]);

      res.json(buildPaginatedResponse(summaryClients, total, pagination));
      return;
    }

    const summaryClients = await prisma.client.findMany({
      where,
      orderBy: { name: "asc" },
      select: { id: true, name: true, city: true },
    });
    res.json(summaryClients);
    return;
  }

  const clientInclude = {
    projects: true,
    permits: {
      include: {
        permitWastes: {
          include: { wasteCatalog: true },
        },
      },
    },
    extraData: {
      include: {
        permit: {
          include: {
            permitWastes: {
              include: { wasteCatalog: true },
            },
          },
        },
      },
    },
  };

  // Delta sync or unpaginated request
  if (sinceDate || !isPaginated) {
    if (sinceDate) {
      where.updatedAt = { gt: sinceDate };
    }
    const [clients, deletedIds] = await Promise.all([
      prisma.client.findMany({
        where,
        orderBy: { name: "asc" },
        include: clientInclude,
      }),
      sinceDate ? fetchDeletedIds("Client", sinceDate) : Promise.resolve([]),
    ]);

    const formatted = clients.map((c) => ({
      ...c,
      ...formatClientPermits(c.permits, c.extraData?.permit),
    }));

    res.json(buildDeltaResponse(formatted, deletedIds, sinceDate));
    return;
  }

  // Paginated request
  const pagination = parsePagination(req.query, {
    defaultSortBy: "name",
    defaultSortOrder: "asc",
    maxLimit: 100,
  });

  const validSortFields = ["name", "city", "contactPerson", "email", "phone", "createdAt"];
  const sortField = validSortFields.includes(pagination.sortBy) ? pagination.sortBy : "name";

  const [total, clients] = await Promise.all([
    prisma.client.count({ where }),
    prisma.client.findMany({
      where,
      skip: pagination.skip,
      take: pagination.take,
      orderBy: { [sortField]: pagination.sortOrder },
      include: clientInclude,
    }),
  ]);

  const formatted = clients.map((c) => ({
    ...c,
    ...formatClientPermits(c.permits, c.extraData?.permit),
  }));

  res.json(buildPaginatedResponse(formatted, total, pagination));
}));

// POST /api/clients
router.post("/", asyncHandler(async (req, res) => {
  const authUser = req.authUser!;
  if (!hasPermission(authUser, "clients", "create")) {
    res.status(403).json({ error: "Permission denied. You do not have permission to create clients." });
    return;
  }

  const { name, contactPerson, email, phone, city, permitId, permitIds } = req.body;
  if (!name || !name.trim()) {
    res.status(400).json({ error: "Client name is required" });
    return;
  }

  const trimmedName = name.trim();
  const existing = await prisma.client.findFirst({
    where: { name: { equals: trimmedName, mode: "insensitive" } },
  });
  if (existing) {
    res.status(400).json({ error: "A client with this name already exists" });
    return;
  }

  let targetPermitIds: string[] = [];
  if (Array.isArray(permitIds)) {
    targetPermitIds = permitIds.filter(Boolean);
  } else if (permitId) {
    targetPermitIds = [permitId];
  }

  const client = await prisma.client.create({
    data: {
      name: trimmedName,
      contactPerson: contactPerson ? contactPerson.trim() : null,
      email: email ? email.trim() : null,
      phone: phone ? phone.trim() : null,
      city: city ? city.trim() : null,
      permits: targetPermitIds.length > 0 ? {
        connect: targetPermitIds.map(id => ({ id })),
      } : undefined,
      extraData: targetPermitIds[0] ? {
        create: { permitId: targetPermitIds[0] }
      } : undefined,
    },
    include: {
      projects: true,
      permits: {
        include: {
          permitWastes: {
            include: { wasteCatalog: true },
          },
        },
      },
      extraData: {
        include: {
          permit: {
            include: {
              permitWastes: {
                include: { wasteCatalog: true },
              },
            },
          },
        },
      },
    },
  });

  if (targetPermitIds.length > 0) {
    await prisma.clientExtraData.updateMany({
      where: { permitId: { in: targetPermitIds }, clientId: { not: client.id } },
      data: { permitId: null },
    });
  }

  res.status(201).json({
    ...client,
    ...formatClientPermits(client.permits, client.extraData?.permit),
  });
}));

// PUT /api/clients/:id
router.put("/:id", asyncHandler(async (req, res) => {
  const authUser = req.authUser!;
  if (!hasPermission(authUser, "clients", "edit")) {
    res.status(403).json({ error: "Permission denied. You do not have permission to edit clients." });
    return;
  }

  const id = req.params.id as string;
  const { name, contactPerson, email, phone, city, permitId, permitIds } = req.body;

  if (name && name.trim()) {
    const trimmedName = name.trim();
    const existing = await prisma.client.findFirst({
      where: {
        id: { not: id },
        name: { equals: trimmedName, mode: "insensitive" },
      },
    });
    if (existing) {
      res.status(400).json({ error: "A client with this name already exists" });
      return;
    }
  }

  const updated = await prisma.client.update({
    where: { id },
    data: {
      name: name ? name.trim() : undefined,
      contactPerson: contactPerson !== undefined ? (contactPerson ? contactPerson.trim() : null) : undefined,
      email: email !== undefined ? (email ? email.trim() : null) : undefined,
      phone: phone !== undefined ? (phone ? phone.trim() : null) : undefined,
      city: city !== undefined ? (city ? city.trim() : null) : undefined,
    },
    include: {
      projects: true,
      permits: {
        include: {
          permitWastes: {
            include: { wasteCatalog: true },
          },
        },
      },
      extraData: {
        include: {
          permit: {
            include: {
              permitWastes: {
                include: { wasteCatalog: true },
              },
            },
          },
        },
      },
    },
  });

  let targetPermitIds: string[] | null = null;
  if (Array.isArray(permitIds)) {
    targetPermitIds = permitIds.filter(Boolean);
  } else if (permitId !== undefined) {
    targetPermitIds = permitId ? [permitId] : [];
  }

  if (targetPermitIds !== null) {
    await prisma.permit.updateMany({
      where: { clientId: id, id: { notIn: targetPermitIds } },
      data: { clientId: null },
    });
    if (targetPermitIds.length > 0) {
      await prisma.permit.updateMany({
        where: { id: { in: targetPermitIds } },
        data: { clientId: id },
      });
      await prisma.clientExtraData.updateMany({
        where: { permitId: { in: targetPermitIds }, clientId: { not: id } },
        data: { permitId: null },
      });
    }

    const firstPermitId = targetPermitIds[0] || null;
    const extraData = await prisma.clientExtraData.upsert({
      where: { clientId: id },
      create: { clientId: id, permitId: firstPermitId },
      update: { permitId: firstPermitId },
      include: {
        permit: {
          include: {
            permitWastes: {
              include: { wasteCatalog: true },
            },
          },
        },
      },
    });
    updated.extraData = extraData;
  }

  const clientPermits = await prisma.permit.findMany({
    where: { clientId: id },
    include: {
      permitWastes: {
        include: { wasteCatalog: true },
      },
    },
  });

  res.json({
    ...updated,
    ...formatClientPermits(clientPermits, updated.extraData?.permit),
  });
}));

// DELETE /api/clients/:id
router.delete("/:id", asyncHandler(async (req, res) => {
  const authUser = req.authUser!;
  if (!hasPermission(authUser, "clients", "delete")) {
    res.status(403).json({ error: "Permission denied. You do not have permission to delete clients." });
    return;
  }

  const id = req.params.id as string;
  await prisma.client.delete({ where: { id } });
  res.json({ message: "Client deleted successfully" });
}));

export default router;
