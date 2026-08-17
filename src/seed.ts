import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { prisma } from './db';
import { hashPassword } from './authUtils';

const envFile = process.env.DOTENV_CONFIG_PATH || process.env.ENV_FILE || '.env';
if (fs.existsSync(path.resolve(process.cwd(), envFile))) {
  dotenv.config({ path: path.resolve(process.cwd(), envFile) });
} else {
  dotenv.config();
}

function addMonths(dateStr: string, months: number): string {
  const d = new Date(dateStr);
  d.setMonth(d.getMonth() + months);
  return d.toISOString().slice(0, 10);
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function seed(force = false) {
  // 0. Seed Categories
  const initialCategories = [
    { code: 'grp-waste', name: 'Waste Management', description: 'Services related to waste management, disposal, and special streams' },
    { code: 'grp-legal', name: 'Legal / Impact Assessments', description: 'Permits, environmental impact assessments, and legal compliance' },
    { code: 'grp-testing', name: 'Testing & Measurements', description: 'Wastewater, air emissions, noise, soil, and waste laboratory testing' },
    { code: 'grp-advisory', name: 'Advisory Services', description: 'ADR safety advisor, chemicals advisor, and ecological consulting' },
    { code: 'grp-standards', name: 'Standards & Certification', description: 'ISO, FSC, ENplus, HACCP, and pest control certifications' },
  ];

  for (const c of initialCategories) {
    const existing = await prisma.category.findUnique({ where: { code: c.code } });
    if (!existing) {
      await prisma.category.create({ data: c });
    }
  }

  // 1. Seed Services
  const initialServices = [
    { code: 'waste-disposal', name: 'Waste Disposal', group: 'grp-waste', frequency: 0 },
    { code: 'waste-management', name: 'Waste Management', group: 'grp-waste', frequency: 0 },
    { code: 'special-waste-streams', name: 'Special Waste Streams & Eco Tax', group: 'grp-waste', frequency: 0 },
    { code: 'permits', name: 'Waste Management Permits', group: 'grp-legal', frequency: 0 },
    { code: 'environmental-impact', name: 'Environmental Impact Assessment', group: 'grp-legal', frequency: 0 },
    { code: 'wastewater-testing', name: 'Wastewater Testing', group: 'grp-testing', frequency: 3 },
    { code: 'air-emissions', name: 'Air Emissions Testing', group: 'grp-testing', frequency: 6 },
    { code: 'noise-emissions', name: 'Noise Emissions Testing', group: 'grp-testing', frequency: 6 },
    { code: 'soil-testing', name: 'Soil Testing', group: 'grp-testing', frequency: 0 },
    { code: 'waste-testing', name: 'Waste Testing', group: 'grp-testing', frequency: 0 },
    { code: 'adr-adviser', name: 'ADR Safety Adviser', group: 'grp-advisory', frequency: 0 },
    { code: 'chemical-adviser', name: 'Chemicals Adviser', group: 'grp-advisory', frequency: 0 },
    { code: 'iso', name: 'ISO Standards Implementation', group: 'grp-standards', frequency: 0 },
    { code: 'fsc', name: 'FSC Standard', group: 'grp-standards', frequency: 0 },
    { code: 'enplus', name: 'ENplus Certificate', group: 'grp-standards', frequency: 0 },
    { code: 'ddd', name: 'Pest Control Services (SRPS EN 16636)', group: 'grp-standards', frequency: 0 },
    { code: 'haccp', name: 'Food Safety (BRC/IFS/FSSC)', group: 'grp-standards', frequency: 0 },
  ];

  for (const s of initialServices) {
    const existing = await prisma.service.findUnique({ where: { code: s.code } });
    if (!existing) {
      await prisma.service.create({ data: s });
    }
  }

  // 2. Seed Users / Staff
  const defaultPasswordHash = hashPassword('password123');
  const initialUsers = [
    { name: 'Zigi', email: 'zigi@ekosgreen.rs', role: 'Administrator', phone: '+381 36 311 099', password: defaultPasswordHash, isApproved: true, status: 'APPROVED' },
    { name: 'Aleksandar Stanković', email: 'aleksandar@ekosgreen.rs', role: 'Manager', phone: '+381 36 311 100', password: defaultPasswordHash, isApproved: true, status: 'APPROVED' },
    { name: 'Nenad Jovanović', email: 'nenad@ekosgreen.rs', role: 'Manager', phone: '+381 36 311 101', password: defaultPasswordHash, isApproved: true, status: 'APPROVED' },
    { name: 'Marija Petrović', email: 'marija@ekosgreen.rs', role: 'User', phone: '+381 36 311 102', password: defaultPasswordHash, isApproved: true, status: 'APPROVED' },
    { name: 'Petar Marković', email: 'petar@ekosgreen.rs', role: 'User', phone: '+381 36 311 103', password: defaultPasswordHash, isApproved: true, status: 'APPROVED' },
    { name: 'Jovana Nikolić', email: 'jovana@ekosgreen.rs', role: 'User', phone: '+381 36 311 104', password: defaultPasswordHash, isApproved: false, status: 'BLOCKED' },
    { name: 'Marko Simić', email: 'marko@ekosgreen.rs', role: 'User', phone: '+381 36 311 105', password: defaultPasswordHash, isApproved: false, status: 'PENDING' },
  ];

  const createdUsers: Record<string, string> = {};
  for (const u of initialUsers) {
    let existing = await prisma.user.findFirst({ where: { name: u.name } });
    if (!existing) {
      existing = await prisma.user.create({ data: u });
    } else if (force) {
      existing = await prisma.user.update({
        where: { id: existing.id },
        data: { password: u.password, isApproved: u.isApproved, status: u.status, role: u.role, email: u.email, phone: u.phone },
      });
    }
    createdUsers[existing.name] = existing.id;
  }

  // 3. Seed Clients
  const initialClients = [
    { name: 'Grad Kraljevo – Gradska uprava', contactPerson: 'Marko Nikolić', email: 'poverenik@kraljevo.rs', phone: '+381 36 300 300', city: 'Kraljevo' },
    { name: 'EcoRecycling d.o.o.', contactPerson: 'Milan Radić', email: 'office@ekoreciklaza.rs', phone: '+381 11 200 400', city: 'Čačak' },
    { name: 'Fabrika pakovanja "Pak-Sistem"', contactPerson: 'Jelena Vasić', email: 'kontrola@paksistem.rs', phone: '+381 36 400 500', city: 'Kraljevo' },
    { name: 'Metalurgija AD', contactPerson: 'Zoran Popović', email: 'zoran.p@metalurgija.rs', phone: '+381 32 301 200', city: 'Čačak' },
    { name: 'AgroPlod d.o.o.', contactPerson: 'Dragan Ilić', email: 'info@agroplod.rs', phone: '+381 37 410 800', city: 'Kruševac' },
    { name: 'Hemija-Farm Beograd', contactPerson: 'Ivana Lukić', email: 'ivana.lukic@hemijafarm.rs', phone: '+381 11 350 700', city: 'Beograd' },
    { name: 'Energo-Term Kraljevo', contactPerson: 'Goran Simić', email: 'office@energotherm.rs', phone: '+381 36 210 900', city: 'Kraljevo' },
  ];

  const clientMap: Record<string, { id: string; name: string }> = {};
  for (const c of initialClients) {
    let existing = await prisma.client.findFirst({ where: { name: c.name } });
    if (!existing) {
      existing = await prisma.client.create({ data: c });
    }
    clientMap[c.name] = { id: existing.id, name: existing.name };
  }

  if (force) {
    // Delete existing projects and reminders to re-populate cleanly
    await prisma.reminder.deleteMany();
    await prisma.project.deleteMany();
  } else {
    const projectCount = await prisma.project.count();
    if (projectCount > 5) {
      console.log('Projects already populated, skipping creation.');
      return;
    }
  }

  // 4. Seed Projects (Rich dataset across past 12 months & active projects)
  const mockProjects = [
    // --- COMPLETED PROJECTS SPREAD OVER LAST 12 MONTHS ---
    // Month: September 2025
    {
      name: 'Plan upravljanja otpadom – Grad Kraljevo (Godišnji izveštaj)',
      clientKey: 'Grad Kraljevo – Gradska uprava',
      responsible: 'Aleksandar Stanković',
      type: 'waste-management',
      start: '2025-07-01',
      deadline: '2025-09-15',
      progress: 100,
      done: true,
      updatedAt: new Date('2025-09-18T14:30:00Z'),
      createdAt: new Date('2025-07-01T08:00:00Z'),
    },
    {
      name: 'Periodično ispitivanje emisije buke u životnoj sredini',
      clientKey: 'Metalurgija AD',
      responsible: 'Petar Marković',
      type: 'noise-emissions',
      start: '2025-08-10',
      deadline: '2025-09-28',
      progress: 100,
      done: true,
      updatedAt: new Date('2025-09-28T16:00:00Z'),
      createdAt: new Date('2025-08-10T09:00:00Z'),
    },

    // Month: October 2025
    {
      name: 'Godišnji bezbednosni izveštaj ADR savetnika',
      clientKey: 'Hemija-Farm Beograd',
      responsible: 'Marija Petrović',
      type: 'adr-adviser',
      start: '2025-09-01',
      deadline: '2025-10-20',
      progress: 100,
      done: true,
      updatedAt: new Date('2025-10-22T11:00:00Z'),
      createdAt: new Date('2025-09-01T08:00:00Z'),
    },
    {
      name: 'Analiza sastava opasnog industrijskog otpada',
      clientKey: 'EcoRecycling d.o.o.',
      responsible: 'Nenad Jovanović',
      type: 'waste-testing',
      start: '2025-09-15',
      deadline: '2025-10-30',
      progress: 100,
      done: true,
      updatedAt: new Date('2025-10-29T15:30:00Z'),
      createdAt: new Date('2025-09-15T09:30:00Z'),
    },

    // Month: November 2025
    {
      name: 'Ispitivanje otpadnih voda – IV kvartal 2025',
      clientKey: 'Fabrika pakovanja "Pak-Sistem"',
      responsible: 'Nenad Jovanović',
      type: 'wastewater-testing',
      start: '2025-10-01',
      deadline: '2025-11-15',
      progress: 100,
      done: true,
      updatedAt: new Date('2025-11-14T13:00:00Z'),
      createdAt: new Date('2025-10-01T08:00:00Z'),
    },
    {
      name: 'Izrada studije o proceni uticaja na životnu sredinu',
      clientKey: 'Energo-Term Kraljevo',
      responsible: 'Aleksandar Stanković',
      type: 'environmental-impact',
      start: '2025-08-15',
      deadline: '2025-11-30',
      progress: 100,
      done: true,
      updatedAt: new Date('2025-11-28T17:00:00Z'),
      createdAt: new Date('2025-08-15T10:00:00Z'),
    },

    // Month: December 2025
    {
      name: 'Obuka zaposlenih za bezbedno rukovanje hemikalijama',
      clientKey: 'Hemija-Farm Beograd',
      responsible: 'Marija Petrović',
      type: 'chemical-adviser',
      start: '2025-11-10',
      deadline: '2025-12-15',
      progress: 100,
      done: true,
      updatedAt: new Date('2025-12-16T12:00:00Z'),
      createdAt: new Date('2025-11-10T09:00:00Z'),
    },
    {
      name: 'Ispitivanje kvaliteta zemljišta oko deponije',
      clientKey: 'Grad Kraljevo – Gradska uprava',
      responsible: 'Petar Marković',
      type: 'soil-testing',
      start: '2025-11-01',
      deadline: '2025-12-24',
      progress: 100,
      done: true,
      updatedAt: new Date('2025-12-23T16:00:00Z'),
      createdAt: new Date('2025-11-01T08:30:00Z'),
    },

    // Month: January 2026
    {
      name: 'Godišnja obnova dozvole za skladištenje neopasnog otpada',
      clientKey: 'EcoRecycling d.o.o.',
      responsible: 'Aleksandar Stanković',
      type: 'permits',
      start: '2025-11-15',
      deadline: '2026-01-20',
      progress: 100,
      done: true,
      updatedAt: new Date('2026-01-19T14:00:00Z'),
      createdAt: new Date('2025-11-15T08:00:00Z'),
    },
    {
      name: 'Implementacija ISO 14001:2015 sistema zaštite životne sredine',
      clientKey: 'AgroPlod d.o.o.',
      responsible: 'Nenad Jovanović',
      type: 'iso',
      start: '2025-09-01',
      deadline: '2026-01-31',
      progress: 100,
      done: true,
      updatedAt: new Date('2026-01-30T15:00:00Z'),
      createdAt: new Date('2025-09-01T09:00:00Z'),
    },

    // Month: February 2026
    {
      name: 'Ispitivanje emisije gasova iz kotlarnice',
      clientKey: 'Energo-Term Kraljevo',
      responsible: 'Petar Marković',
      type: 'air-emissions',
      start: '2026-01-10',
      deadline: '2026-02-18',
      progress: 100,
      done: true,
      updatedAt: new Date('2026-02-17T11:30:00Z'),
      createdAt: new Date('2026-01-10T08:00:00Z'),
    },
    {
      name: 'Dozvola za tretman inertnog otpada',
      clientKey: 'Metalurgija AD',
      responsible: 'Aleksandar Stanković',
      type: 'permits',
      start: '2025-12-01',
      deadline: '2026-02-25',
      progress: 100,
      done: true,
      updatedAt: new Date('2026-02-24T16:45:00Z'),
      createdAt: new Date('2025-12-01T10:00:00Z'),
    },

    // Month: March 2026
    {
      name: 'Kvartalno uzorkovanje otpadnih voda – I kvartal 2026',
      clientKey: 'Fabrika pakovanja "Pak-Sistem"',
      responsible: 'Nenad Jovanović',
      type: 'wastewater-testing',
      start: '2026-02-01',
      deadline: '2026-03-20',
      progress: 100,
      done: true,
      updatedAt: new Date('2026-03-19T13:15:00Z'),
      createdAt: new Date('2026-02-01T08:00:00Z'),
    },
    {
      name: 'Ažuriranje registra hemikalija i bezbednosnih listova',
      clientKey: 'Hemija-Farm Beograd',
      responsible: 'Marija Petrović',
      type: 'chemical-adviser',
      start: '2026-02-15',
      deadline: '2026-03-30',
      progress: 100,
      done: true,
      updatedAt: new Date('2026-03-28T10:00:00Z'),
      createdAt: new Date('2026-02-15T09:00:00Z'),
    },

    // Month: April 2026
    {
      name: 'Plan prevencije udesa i sanacije zemljišta',
      clientKey: 'EcoRecycling d.o.o.',
      responsible: 'Aleksandar Stanković',
      type: 'environmental-impact',
      start: '2026-02-01',
      deadline: '2026-04-15',
      progress: 100,
      done: true,
      updatedAt: new Date('2026-04-14T15:00:00Z'),
      createdAt: new Date('2026-02-01T08:00:00Z'),
    },
    {
      name: 'Sertifikacija HACCP sistema za prehrambenu industriju',
      clientKey: 'AgroPlod d.o.o.',
      responsible: 'Nenad Jovanović',
      type: 'haccp',
      start: '2026-01-15',
      deadline: '2026-04-28',
      progress: 100,
      done: true,
      updatedAt: new Date('2026-04-27T16:00:00Z'),
      createdAt: new Date('2026-01-15T08:30:00Z'),
    },

    // Month: May 2026
    {
      name: 'Merenje nivoa buke u zoni stambenih objekata',
      clientKey: 'Metalurgija AD',
      responsible: 'Petar Marković',
      type: 'noise-emissions',
      start: '2026-04-01',
      deadline: '2026-05-20',
      progress: 100,
      done: true,
      updatedAt: new Date('2026-05-18T14:30:00Z'),
      createdAt: new Date('2026-04-01T09:00:00Z'),
    },
    {
      name: 'Evidencija posebnih tokova otpada i Eko taksa (Izveštaj SEPA)',
      clientKey: 'Fabrika pakovanja "Pak-Sistem"',
      responsible: 'Marija Petrović',
      type: 'special-waste-streams',
      start: '2026-04-10',
      deadline: '2026-05-30',
      progress: 100,
      done: true,
      updatedAt: new Date('2026-05-29T12:00:00Z'),
      createdAt: new Date('2026-04-10T08:00:00Z'),
    },

    // Month: June 2026
    {
      name: 'Kvartalno ispitivanje otpadnih voda – II kvartal 2026',
      clientKey: 'Fabrika pakovanja "Pak-Sistem"',
      responsible: 'Nenad Jovanović',
      type: 'wastewater-testing',
      start: '2026-05-01',
      deadline: '2026-06-20',
      progress: 100,
      done: true,
      updatedAt: new Date('2026-06-18T11:00:00Z'),
      createdAt: new Date('2026-05-01T08:00:00Z'),
    },
    {
      name: 'Revizija ADR procedura za prevoz opasnih materija',
      clientKey: 'Hemija-Farm Beograd',
      responsible: 'Marija Petrović',
      type: 'adr-adviser',
      start: '2026-05-15',
      deadline: '2026-06-30',
      progress: 100,
      done: true,
      updatedAt: new Date('2026-06-29T17:00:00Z'),
      createdAt: new Date('2026-05-15T09:00:00Z'),
    },
    {
      name: 'Implementacija ENplus standarda za proizvodnju peleta',
      clientKey: 'AgroPlod d.o.o.',
      responsible: 'Aleksandar Stanković',
      type: 'enplus',
      start: '2026-03-01',
      deadline: '2026-06-30',
      progress: 100,
      done: true,
      updatedAt: new Date('2026-06-25T15:30:00Z'),
      createdAt: new Date('2026-03-01T10:00:00Z'),
    },

    // Month: July 2026
    {
      name: 'Merenje emisije praškastih materija i gasova iz postrojenja',
      clientKey: 'Metalurgija AD',
      responsible: 'Petar Marković',
      type: 'air-emissions',
      start: '2026-06-01',
      deadline: '2026-07-22',
      progress: 100,
      done: true,
      updatedAt: new Date('2026-07-20T13:00:00Z'),
      createdAt: new Date('2026-06-01T08:00:00Z'),
    },
    {
      name: 'Plan zbrinjavanja industrijskog mulja i otpadnih emulzija',
      clientKey: 'EcoRecycling d.o.o.',
      responsible: 'Aleksandar Stanković',
      type: 'waste-disposal',
      start: '2026-05-20',
      deadline: '2026-07-31',
      progress: 100,
      done: true,
      updatedAt: new Date('2026-07-29T16:00:00Z'),
      createdAt: new Date('2026-05-20T08:30:00Z'),
    },

    // Month: August 2026
    {
      name: 'Godišnji monitoring kvaliteta podzemnih voda oko rezervoara',
      clientKey: 'Energo-Term Kraljevo',
      responsible: 'Petar Marković',
      type: 'wastewater-testing',
      start: '2026-07-05',
      deadline: '2026-08-10',
      progress: 100,
      done: true,
      updatedAt: new Date('2026-08-08T14:00:00Z'),
      createdAt: new Date('2026-07-05T09:00:00Z'),
    },
    {
      name: 'Sanitarni pregled i deratizacija skladišnih hala (SRPS EN 16636)',
      clientKey: 'Fabrika pakovanja "Pak-Sistem"',
      responsible: 'Marija Petrović',
      type: 'ddd',
      start: '2026-07-15',
      deadline: '2026-08-12',
      progress: 100,
      done: true,
      updatedAt: new Date('2026-08-11T15:30:00Z'),
      createdAt: new Date('2026-07-15T08:00:00Z'),
    },

    // --- ACTIVE PROJECTS IN PROGRESS (CURRENTLY ONGOING) ---
    {
      name: 'Lokalni plan upravljanja otpadom 2026–2031',
      clientKey: 'Grad Kraljevo – Gradska uprava',
      responsible: 'Aleksandar Stanković',
      type: 'waste-management',
      start: '2026-06-01',
      deadline: '2026-10-31',
      progress: 65,
      done: false,
      nextSample: null,
      createdAt: new Date('2026-06-01T08:00:00Z'),
      updatedAt: new Date(),
    },
    {
      name: 'Studija o proceni uticaja postrojenja za reciklažu plastike',
      clientKey: 'EcoRecycling d.o.o.',
      responsible: 'Nenad Jovanović',
      type: 'environmental-impact',
      start: '2026-05-15',
      deadline: '2026-09-30',
      progress: 45,
      done: false,
      nextSample: null,
      createdAt: new Date('2026-05-15T09:00:00Z'),
      updatedAt: new Date(),
    },
    {
      name: 'Kvartalno ispitivanje otpadnih voda – III kvartal 2026',
      clientKey: 'Fabrika pakovanja "Pak-Sistem"',
      responsible: 'Nenad Jovanović',
      type: 'wastewater-testing',
      start: '2026-07-01',
      deadline: '2026-09-15',
      progress: 35,
      done: false,
      nextSample: addMonths(todayStr(), 0),
      createdAt: new Date('2026-07-01T08:00:00Z'),
      updatedAt: new Date(),
    },
    {
      name: 'Kontrola i bezbednosni pregled hemikalija u skladištu',
      clientKey: 'Hemija-Farm Beograd',
      responsible: 'Marija Petrović',
      type: 'chemical-adviser',
      start: '2026-07-10',
      deadline: '2026-10-15',
      progress: 25,
      done: false,
      nextSample: null,
      createdAt: new Date('2026-07-10T09:30:00Z'),
      updatedAt: new Date(),
    },
    {
      name: 'Merenje emisije buke u radnoj okolini i ventilacionim kanalima',
      clientKey: 'Metalurgija AD',
      responsible: 'Petar Marković',
      type: 'noise-emissions',
      start: '2026-08-01',
      deadline: '2026-09-20',
      progress: 15,
      done: false,
      nextSample: addMonths(todayStr(), 1),
      createdAt: new Date('2026-08-01T08:00:00Z'),
      updatedAt: new Date(),
    },
    {
      name: 'Uvođenje FSC standarda za održivo šumarstvo i ambalažu',
      clientKey: 'AgroPlod d.o.o.',
      responsible: 'Aleksandar Stanković',
      type: 'fsc',
      start: '2026-05-01',
      deadline: '2026-11-30',
      progress: 55,
      done: false,
      nextSample: null,
      createdAt: new Date('2026-05-01T10:00:00Z'),
      updatedAt: new Date(),
    },
    {
      name: 'Kontrolno ispitivanje emisije dimnih gasova iz toplane',
      clientKey: 'Energo-Term Kraljevo',
      responsible: 'Petar Marković',
      type: 'air-emissions',
      start: '2026-07-20',
      deadline: '2026-09-10',
      progress: 40,
      done: false,
      nextSample: addMonths(todayStr(), 0),
      createdAt: new Date('2026-07-20T08:00:00Z'),
      updatedAt: new Date(),
    },
    {
      name: 'Izrada godišnje prijave za Nacionalni registar izvora zagađivanja (NRIZ)',
      clientKey: 'Metalurgija AD',
      responsible: 'Marija Petrović',
      type: 'special-waste-streams',
      start: '2026-06-15',
      deadline: '2026-10-01',
      progress: 50,
      done: false,
      nextSample: null,
      createdAt: new Date('2026-06-15T09:00:00Z'),
      updatedAt: new Date(),
    },
  ];

  for (const p of mockProjects) {
    const client = clientMap[p.clientKey] || { id: null, name: p.clientKey };
    const responsibleId = createdUsers[p.responsible] || null;

    const createdProj = await prisma.project.create({
      data: {
        name: p.name,
        clientId: client.id,
        clientName: client.name,
        responsible: p.responsible,
        responsibleId,
        type: p.type,
        start: p.start,
        deadline: p.deadline,
        progress: p.progress,
        done: p.done,
        nextSample: p.nextSample || null,
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
      },
    });

    // If nextSample is present, also create a reminder
    if (p.nextSample) {
      await prisma.reminder.create({
        data: {
          projectId: createdProj.id,
          projectName: createdProj.name,
          clientId: client.id,
          clientName: client.name,
          responsibleId,
          responsible: p.responsible,
          status: 'Pending',
          notes: `Periodično uzorkovanje za ${p.name}`,
          dueDate: p.nextSample,
        },
      });
    }
  }

  // 5. Additional Mock Reminders for a rich reminders table
  const extraReminders = [
    {
      projectName: 'Godišnje merenje emisije buke u životnoj sredini',
      clientKey: 'Metalurgija AD',
      responsible: 'Petar Marković',
      status: 'Pending',
      notes: 'Potrebno pripremiti mernu opremu i kalibrisati akustički kalibrator.',
      dueDate: '2026-08-18',
    },
    {
      projectName: 'Prijava opasnog otpada za III kvartal',
      clientKey: 'EcoRecycling d.o.o.',
      responsible: 'Aleksandar Stanković',
      status: 'In Progress',
      notes: 'Sakupljeni svi vagarski listovi, čeka se potpis direktora.',
      dueDate: '2026-08-20',
    },
    {
      projectName: 'Ispitivanje otpadnih voda - Terensko uzorkovanje',
      clientKey: 'Fabrika pakovanja "Pak-Sistem"',
      responsible: 'Nenad Jovanović',
      status: 'Pending',
      notes: 'Uzorkovanje na izlivnom šahtu br. 2 u 09:00h.',
      dueDate: '2026-08-22',
    },
    {
      projectName: 'Vanredna inspekcija skladišta hemikalija',
      clientKey: 'Hemija-Farm Beograd',
      responsible: 'Marija Petrović',
      status: 'Pending',
      notes: 'Provera bezbednosnih listova (MSDS) i sistema za ventilaciju.',
      dueDate: '2026-08-25',
    },
    {
      projectName: 'Verifikacija ISO 14001:2015 dokumentacije',
      clientKey: 'AgroPlod d.o.o.',
      responsible: 'Nenad Jovanović',
      status: 'Completed',
      notes: 'Interne provere uspešno sprovedene.',
      dueDate: '2026-08-28',
    },
    {
      projectName: 'Merenje kvaliteta vazduha u radnoj zoni',
      clientKey: 'Energo-Term Kraljevo',
      responsible: 'Petar Marković',
      status: 'Pending',
      notes: 'Postavljanje merne stanice u kotlarnici.',
      dueDate: '2026-09-02',
    },
    {
      projectName: 'Godišnji izveštaj ADR savetnika za prevoz opasne robe',
      clientKey: 'Hemija-Farm Beograd',
      responsible: 'Marija Petrović',
      status: 'In Progress',
      notes: 'Obrađeni podaci za prva dva kvartala.',
      dueDate: '2026-09-05',
    },
    {
      projectName: 'Obnova dozvole za tretman otpada',
      clientKey: 'EcoRecycling d.o.o.',
      responsible: 'Aleksandar Stanković',
      status: 'Pending',
      notes: 'Dopuna zahteva dokumentacijom o novom postrojenju.',
      dueDate: '2026-09-10',
    },
    {
      projectName: 'Monitoring podzemnih voda – Bušotina B-1',
      clientKey: 'Grad Kraljevo – Gradska uprava',
      responsible: 'Petar Marković',
      status: 'Pending',
      notes: 'Uzorkovanje sa dubine od 12m na lokaciji deponije.',
      dueDate: '2026-09-12',
    },
    {
      projectName: 'Kontrola ispravnosti sistema za prečišćavanje otpadnih voda',
      clientKey: 'Fabrika pakovanja "Pak-Sistem"',
      responsible: 'Nenad Jovanović',
      status: 'Pending',
      notes: 'Provera pH vrednosti i taložnika.',
      dueDate: '2026-09-15',
    },
    {
      projectName: 'Obuka radnika za postupanje u slučaju udesa',
      clientKey: 'Metalurgija AD',
      responsible: 'Marija Petrović',
      status: 'Pending',
      notes: 'Priprema prezentacije i testova znanja.',
      dueDate: '2026-09-18',
    },
    {
      projectName: 'Analiza teških metala u mulju',
      clientKey: 'EcoRecycling d.o.o.',
      responsible: 'Nenad Jovanović',
      status: 'Pending',
      notes: 'Slanje uzoraka u akreditovanu laboratoriju.',
      dueDate: '2026-09-22',
    },
    {
      projectName: 'Ispitivanje efikasnosti filtera na dimnjaku',
      clientKey: 'Energo-Term Kraljevo',
      responsible: 'Petar Marković',
      status: 'Pending',
      notes: 'Periodična provera praškastih materija.',
      dueDate: '2026-09-25',
    },
    {
      projectName: 'Godišnji audit FSC lanca podrijetla',
      clientKey: 'AgroPlod d.o.o.',
      responsible: 'Aleksandar Stanković',
      status: 'Pending',
      notes: 'Priprema ulazno-izlaznih bilansa drvne mase.',
      dueDate: '2026-09-30',
    },
    {
      projectName: 'Procena opasnosti od udesa i zaštita životne sredine',
      clientKey: 'Grad Kraljevo – Gradska uprava',
      responsible: 'Aleksandar Stanković',
      status: 'Pending',
      notes: 'Sastanak sa komunalnom inspekcijom.',
      dueDate: '2026-10-05',
    },
  ];

  for (const r of extraReminders) {
    const client = clientMap[r.clientKey] || { id: null, name: r.clientKey };
    const responsibleId = createdUsers[r.responsible] || null;

    await prisma.reminder.create({
      data: {
        projectName: r.projectName,
        clientId: client.id,
        clientName: client.name,
        responsibleId,
        responsible: r.responsible,
        status: r.status,
        notes: r.notes,
        dueDate: r.dueDate,
      },
    });
  }

  console.log(`Seed completed successfully with ${mockProjects.length} projects and ${extraReminders.length + 3} reminders.`);
}

if (require.main === module) {
  seed(true)
    .then(() => prisma.$disconnect())
    .catch((e) => {
      console.error(e);
      prisma.$disconnect();
      process.exit(1);
    });
}
