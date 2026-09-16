import { Router } from "express";
import { prisma } from "../db";
import { asyncHandler } from "../middleware/errorHandler";
import { requireAuth } from "../middleware/auth";
import { isAdminOrManager } from "../types";

const router = Router();

router.use(requireAuth);

export function formatPermit(p: any) {
  const client = p.client || p.clientExtraData?.[0]?.client || null;
  const clientsList = client ? [client] : (p.clientExtraData || []).map((ed: any) => ed.client).filter(Boolean);
  const wasteCatalogs = (p.permitWastes || []).map((pw: any) => pw.wasteCatalog).filter(Boolean);
  const wasteCatalogIds = (p.permitWastes || []).map((pw: any) => pw.wasteCatalogId);
  const wasteCatalog = wasteCatalogs[0] || null;
  const wasteCatalogId = wasteCatalogIds[0] || null;
  const indexNumber = wasteCatalog?.code || "";

  return {
    ...p,
    client,
    clients: clientsList,
    clientName: client?.name || clientsList[0]?.name || null,
    clientId: p.clientId || client?.id || clientsList[0]?.id || null,
    wasteCatalog,
    wasteCatalogId,
    wasteCatalogs,
    wasteCatalogIds,
    permitTypes: Array.isArray(p.permitTypes) ? p.permitTypes : [],
    indexNumber,
  };
}

// GET /api/permits
router.get("/", asyncHandler(async (req, res) => {
  const search = ((req.query.search as string) || "").trim();
  const where = search ? {
    OR: [
      { permitNumber: { contains: search, mode: "insensitive" as const } },
      { notes: { contains: search, mode: "insensitive" as const } },
      { permitTypes: { hasSome: [search] } },
      { client: { name: { contains: search, mode: "insensitive" as const } } },
      { clientExtraData: { some: { client: { name: { contains: search, mode: "insensitive" as const } } } } },
      {
        permitWastes: {
          some: {
            wasteCatalog: {
              OR: [
                { code: { contains: search, mode: "insensitive" as const } },
                { description: { contains: search, mode: "insensitive" as const } },
              ],
            },
          },
        },
      },
    ],
  } : {};

  const permits = await prisma.permit.findMany({
    where,
    orderBy: { createdAt: "desc" },
    include: {
      client: true,
      reminders: true,
      clientExtraData: {
        include: { client: true },
      },
      permitWastes: {
        include: { wasteCatalog: true },
      },
    },
  });

  res.json(permits.map(formatPermit));
}));

// GET /api/permits/:id
router.get("/:id", asyncHandler(async (req, res) => {
  const id = req.params.id as string;
  const permit = await prisma.permit.findUnique({
    where: { id },
    include: {
      client: true,
      reminders: true,
      clientExtraData: {
        include: { client: true },
      },
      permitWastes: {
        include: { wasteCatalog: true },
      },
    },
  });

  if (!permit) {
    res.status(404).json({ error: "Permit not found" });
    return;
  }

  res.json(formatPermit(permit));
}));

// POST /api/permits
router.post("/", asyncHandler(async (req, res) => {
  if (!isAdminOrManager(req.authUser!.role)) {
    res.status(403).json({ error: "Permission denied. Only Administrators and Managers can create permits." });
    return;
  }

  const { permitNumber, startDate, endDate, notes, wasteCatalogId, wasteCatalogIds, permitTypes, clientId } = req.body;
  let targetWcIds: string[] = [];
  if (Array.isArray(wasteCatalogIds) && wasteCatalogIds.length > 0) {
    targetWcIds = wasteCatalogIds;
  } else if (wasteCatalogId) {
    targetWcIds = [wasteCatalogId];
  }

  if (!permitNumber || !permitNumber.trim()) {
    res.status(400).json({ error: "Permit number is required." });
    return;
  }

  if (targetWcIds.length === 0) {
    res.status(400).json({ error: "At least one waste catalog index number is required." });
    return;
  }

  if (!clientId || !String(clientId).trim()) {
    res.status(400).json({ error: "Client is required." });
    return;
  }

  const normalizedPermitTypes = Array.isArray(permitTypes)
    ? permitTypes.map((t: any) => String(t).trim()).filter(Boolean)
    : [];
  if (normalizedPermitTypes.length === 0) {
    res.status(400).json({ error: "At least one permit type is required." });
    return;
  }

  const permit = await prisma.permit.create({
    data: {
      permitNumber: permitNumber.trim(),
      startDate: startDate || null,
      endDate: endDate || null,
      notes: notes ? notes.trim() : null,
      permitTypes: normalizedPermitTypes,
      clientId: clientId.trim(),
      permitWastes: {
        create: targetWcIds.map(id => ({ wasteCatalogId: id })),
      },
    },
    include: {
      client: true,
      reminders: true,
      clientExtraData: {
        include: { client: true },
      },
      permitWastes: {
        include: { wasteCatalog: true },
      },
    },
  });

  // Keep legacy ClientExtraData in sync for fallback
  await prisma.clientExtraData.upsert({
    where: { clientId: clientId.trim() },
    create: { clientId: clientId.trim(), permitId: permit.id },
    update: { permitId: permit.id },
  });

  res.status(201).json(formatPermit(permit));
}));

// PUT /api/permits/:id
router.put("/:id", asyncHandler(async (req, res) => {
  if (!isAdminOrManager(req.authUser!.role)) {
    res.status(403).json({ error: "Permission denied. Only Administrators and Managers can edit permits." });
    return;
  }

  const id = req.params.id as string;
  const { permitNumber, startDate, endDate, notes, wasteCatalogId, wasteCatalogIds, permitTypes, clientId } = req.body;

  const existing = await prisma.permit.findUnique({ where: { id } });
  if (!existing) {
    res.status(404).json({ error: "Permit not found" });
    return;
  }

  if (clientId !== undefined && (!clientId || !String(clientId).trim())) {
    res.status(400).json({ error: "Client is required." });
    return;
  }

  let normalizedPermitTypes: string[] | undefined = undefined;
  if (permitTypes !== undefined) {
    normalizedPermitTypes = Array.isArray(permitTypes)
      ? permitTypes.map((t: any) => String(t).trim()).filter(Boolean)
      : [];
    if (normalizedPermitTypes.length === 0) {
      res.status(400).json({ error: "At least one permit type is required." });
      return;
    }
  }

  let targetWcIds: string[] | undefined = undefined;
  if (Array.isArray(wasteCatalogIds)) {
    targetWcIds = wasteCatalogIds;
  } else if (wasteCatalogId !== undefined) {
    targetWcIds = wasteCatalogId ? [wasteCatalogId] : [];
  }

  if (targetWcIds !== undefined) {
    await prisma.permitWaste.deleteMany({
      where: { permitId: id },
    });

    if (targetWcIds.length > 0) {
      await prisma.permitWaste.createMany({
        data: targetWcIds.map(wId => ({
          permitId: id,
          wasteCatalogId: wId,
        })),
      });
    }
  }

  const targetClientId = clientId !== undefined ? (clientId ? String(clientId).trim() : null) : existing.clientId;

  const updated = await prisma.permit.update({
    where: { id },
    data: {
      permitNumber: permitNumber !== undefined ? permitNumber.trim() : existing.permitNumber,
      startDate: startDate !== undefined ? startDate : existing.startDate,
      endDate: endDate !== undefined ? endDate : existing.endDate,
      notes: notes !== undefined ? (notes ? notes.trim() : null) : existing.notes,
      permitTypes: normalizedPermitTypes !== undefined ? normalizedPermitTypes : existing.permitTypes,
      clientId: targetClientId,
    },
    include: {
      client: true,
      reminders: true,
      clientExtraData: {
        include: { client: true },
      },
      permitWastes: {
        include: { wasteCatalog: true },
      },
    },
  });

  // Sync clientExtraData if client changed
  if (clientId !== undefined && targetClientId !== existing.clientId) {
    if (targetClientId) {
      await prisma.clientExtraData.upsert({
        where: { clientId: targetClientId },
        create: { clientId: targetClientId, permitId: id },
        update: { permitId: id },
      });
    }
    if (existing.clientId) {
      const remainingPermit = await prisma.permit.findFirst({
        where: { clientId: existing.clientId, id: { not: id } },
      });
      await prisma.clientExtraData.upsert({
        where: { clientId: existing.clientId },
        create: { clientId: existing.clientId, permitId: remainingPermit?.id || null },
        update: { permitId: remainingPermit?.id || null },
      });
    }
  }

  res.json(formatPermit(updated));
}));

// DELETE /api/permits/:id
router.delete("/:id", asyncHandler(async (req, res) => {
  if (!isAdminOrManager(req.authUser!.role)) {
    res.status(403).json({ error: "Permission denied. Only Administrators and Managers can delete permits." });
    return;
  }

  const id = req.params.id as string;
  const existing = await prisma.permit.findUnique({ where: { id } });
  if (!existing) {
    res.status(404).json({ error: "Permit not found" });
    return;
  }

  await prisma.permit.delete({ where: { id } });

  // Update clientExtraData fallback if needed
  if (existing.clientId) {
    const nextPermit = await prisma.permit.findFirst({
      where: { clientId: existing.clientId },
    });
    await prisma.clientExtraData.updateMany({
      where: { clientId: existing.clientId },
      data: { permitId: nextPermit ? nextPermit.id : null },
    });
  }

  res.json({ message: "Permit deleted successfully" });
}));

export default router;
