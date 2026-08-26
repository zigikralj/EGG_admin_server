import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { prisma } from './db';
import { hashPassword } from './authUtils';
import { UserRole } from './types';

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
  console.log(`🌱 Starting database seed (force=${force})...`);

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
    { name: 'Zigi', email: 'zigi@ekosgreen.rs', role: UserRole.ADMINISTRATOR, phone: '+381 36 311 099', password: defaultPasswordHash, isApproved: true, status: 'APPROVED' },
    { name: 'Aleksandar Stanković', email: 'aleksandar@ekosgreen.rs', role: UserRole.MANAGER, phone: '+381 36 311 100', password: defaultPasswordHash, isApproved: true, status: 'APPROVED' },
    { name: 'Nenad Jovanović', email: 'nenad@ekosgreen.rs', role: UserRole.MANAGER, phone: '+381 36 311 101', password: defaultPasswordHash, isApproved: true, status: 'APPROVED' },
    { name: 'Marija Petrović', email: 'marija@ekosgreen.rs', role: UserRole.USER, phone: '+381 36 311 102', password: defaultPasswordHash, isApproved: true, status: 'APPROVED' },
    { name: 'Petar Marković', email: 'petar@ekosgreen.rs', role: UserRole.USER, phone: '+381 36 311 103', password: defaultPasswordHash, isApproved: true, status: 'APPROVED' },
    { name: 'Katarina Popović', email: 'katarina@ekosgreen.rs', role: UserRole.ACCOUNTANT, phone: '+381 36 311 106', password: defaultPasswordHash, isApproved: true, status: 'APPROVED' },
    { name: 'Jovana Nikolić', email: 'jovana@ekosgreen.rs', role: UserRole.USER, phone: '+381 36 311 104', password: defaultPasswordHash, isApproved: false, status: 'BLOCKED' },
    { name: 'Marko Simić', email: 'marko@ekosgreen.rs', role: UserRole.USER, phone: '+381 36 311 105', password: defaultPasswordHash, isApproved: false, status: 'PENDING' },
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

  // 3. Seed Clients (at least 14 distinct clients across Serbia)
  const initialClients = [
    { name: 'Grad Kraljevo – Gradska uprava', contactPerson: 'Marko Nikolić', email: 'poverenik@kraljevo.rs', phone: '+381 36 300 300', city: 'Kraljevo' },
    { name: 'EcoRecycling d.o.o.', contactPerson: 'Milan Radić', email: 'office@ekoreciklaza.rs', phone: '+381 11 200 400', city: 'Čačak' },
    { name: 'Fabrika pakovanja "Pak-Sistem"', contactPerson: 'Jelena Vasić', email: 'kontrola@paksistem.rs', phone: '+381 36 400 500', city: 'Kraljevo' },
    { name: 'Metalurgija AD', contactPerson: 'Zoran Popović', email: 'zoran.p@metalurgija.rs', phone: '+381 32 301 200', city: 'Čačak' },
    { name: 'AgroPlod d.o.o.', contactPerson: 'Dragan Ilić', email: 'info@agroplod.rs', phone: '+381 37 410 800', city: 'Kruševac' },
    { name: 'Hemija-Farm Beograd', contactPerson: 'Ivana Lukić', email: 'ivana.lukic@hemijafarm.rs', phone: '+381 11 350 700', city: 'Beograd' },
    { name: 'Energo-Term Kraljevo', contactPerson: 'Goran Simić', email: 'office@energotherm.rs', phone: '+381 36 210 900', city: 'Kraljevo' },
    { name: 'Auto-Delovi Šumadija d.o.o.', contactPerson: 'Dejan Petrović', email: 'nabavka@sumadija-autodelovi.rs', phone: '+381 34 330 110', city: 'Kragujevac' },
    { name: 'Drvo-Stil Pro d.o.o.', contactPerson: 'Milica Stojanović', email: 'proizvodnja@drvo-stil.rs', phone: '+381 31 520 880', city: 'Užice' },
    { name: 'Termo-Elektronik Niš', contactPerson: 'Vladimir Kostić', email: 'vladimir@termo-el-nis.rs', phone: '+381 18 450 620', city: 'Niš' },
    { name: 'Mlekara Moravica d.o.o.', contactPerson: 'Sanja Đorđević', email: 'laboratorija@mlekara-moravica.rs', phone: '+381 36 820 440', city: 'Kraljevo' },
    { name: 'Tehno-Plast d.o.o.', contactPerson: 'Bojan Mitrović', email: 'info@tehnoplast-vb.rs', phone: '+381 36 612 300', city: 'Vrnjačka Banja' },
    { name: 'Balkan Petroleum Services', contactPerson: 'Nikola Radovanović', email: 'safety@balkanpetroleum.rs', phone: '+381 11 789 550', city: 'Beograd' },
    { name: 'Vojvodina Agrar d.o.o.', contactPerson: 'Stefan Lazarević', email: 'agro.kontrola@vojvodina-agrar.rs', phone: '+381 21 690 120', city: 'Novi Sad' },
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
    // Delete existing items, invoices, reminders, and projects to re-populate cleanly
    await prisma.reminder.deleteMany();
    await prisma.invoiceItem.deleteMany();
    await prisma.invoice.deleteMany();
    await prisma.project.deleteMany();
  }

  const projectMap: Record<string, string> = {};

  const projectCount = await prisma.project.count();
  if (force || projectCount <= 5) {
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
      {
        name: 'Merenje emisije u vazduh iz lakirnice',
        clientKey: 'Auto-Delovi Šumadija d.o.o.',
        responsible: 'Petar Marković',
        type: 'air-emissions',
        start: '2026-02-10',
        deadline: '2026-03-25',
        progress: 100,
        done: true,
        updatedAt: new Date('2026-03-24T14:00:00Z'),
        createdAt: new Date('2026-02-10T08:00:00Z'),
      },
      {
        name: 'Elaborat o zaštiti od požara i eksplozija',
        clientKey: 'Termo-Elektronik Niš',
        responsible: 'Aleksandar Stanković',
        type: 'environmental-impact',
        start: '2026-02-01',
        deadline: '2026-03-28',
        progress: 100,
        done: true,
        updatedAt: new Date('2026-03-27T16:00:00Z'),
        createdAt: new Date('2026-02-01T09:00:00Z'),
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
      {
        name: 'FSC sertifikacija lanca nadzora drveta',
        clientKey: 'Drvo-Stil Pro d.o.o.',
        responsible: 'Aleksandar Stanković',
        type: 'fsc',
        start: '2026-03-15',
        deadline: '2026-05-25',
        progress: 100,
        done: true,
        updatedAt: new Date('2026-05-24T15:00:00Z'),
        createdAt: new Date('2026-03-15T08:30:00Z'),
      },
      {
        name: 'Analiza otpadnih voda i mulja iz separatora',
        clientKey: 'Mlekara Moravica d.o.o.',
        responsible: 'Nenad Jovanović',
        type: 'wastewater-testing',
        start: '2026-04-15',
        deadline: '2026-05-28',
        progress: 100,
        done: true,
        updatedAt: new Date('2026-05-27T11:00:00Z'),
        createdAt: new Date('2026-04-15T09:00:00Z'),
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
      {
        name: 'Dozvola za skladištenje i tretman plastičnog otpada',
        clientKey: 'Tehno-Plast d.o.o.',
        responsible: 'Aleksandar Stanković',
        type: 'permits',
        start: '2026-04-01',
        deadline: '2026-06-25',
        progress: 100,
        done: true,
        updatedAt: new Date('2026-06-24T14:30:00Z'),
        createdAt: new Date('2026-04-01T08:00:00Z'),
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
      {
        name: 'ADR bezbednosni konsalting i kontrola rezervoara za derivate',
        clientKey: 'Balkan Petroleum Services',
        responsible: 'Marija Petrović',
        type: 'adr-adviser',
        start: '2026-05-10',
        deadline: '2026-07-15',
        progress: 100,
        done: true,
        updatedAt: new Date('2026-07-14T12:00:00Z'),
        createdAt: new Date('2026-05-10T09:00:00Z'),
      },
      {
        name: 'Procena uticaja na životnu sredinu za silosne kapacitete',
        clientKey: 'Vojvodina Agrar d.o.o.',
        responsible: 'Aleksandar Stanković',
        type: 'environmental-impact',
        start: '2026-05-01',
        deadline: '2026-07-25',
        progress: 100,
        done: true,
        updatedAt: new Date('2026-07-24T15:00:00Z'),
        createdAt: new Date('2026-05-01T08:00:00Z'),
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
      {
        name: 'Plan upravljanja tehnološkim otpadom',
        clientKey: 'Auto-Delovi Šumadija d.o.o.',
        responsible: 'Aleksandar Stanković',
        type: 'waste-management',
        start: '2026-07-01',
        deadline: '2026-10-15',
        progress: 30,
        done: false,
        nextSample: null,
        createdAt: new Date('2026-07-01T08:30:00Z'),
        updatedAt: new Date(),
      },
      {
        name: 'Ispitivanje otpadnih voda iz galvanizacije',
        clientKey: 'Termo-Elektronik Niš',
        responsible: 'Nenad Jovanović',
        type: 'wastewater-testing',
        start: '2026-08-01',
        deadline: '2026-09-25',
        progress: 20,
        done: false,
        nextSample: addMonths(todayStr(), 1),
        createdAt: new Date('2026-08-01T09:00:00Z'),
        updatedAt: new Date(),
      },
      {
        name: 'HACCP interna provera i sanitarna inspekcija',
        clientKey: 'Mlekara Moravica d.o.o.',
        responsible: 'Marija Petrović',
        type: 'haccp',
        start: '2026-08-05',
        deadline: '2026-10-10',
        progress: 10,
        done: false,
        nextSample: null,
        createdAt: new Date('2026-08-05T08:00:00Z'),
        updatedAt: new Date(),
      },
      {
        name: 'Plan zaštite od akcidentnih izlivanja nafte',
        clientKey: 'Balkan Petroleum Services',
        responsible: 'Aleksandar Stanković',
        type: 'environmental-impact',
        start: '2026-07-15',
        deadline: '2026-10-30',
        progress: 40,
        done: false,
        nextSample: null,
        createdAt: new Date('2026-07-15T09:00:00Z'),
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

      projectMap[createdProj.name] = createdProj.id;

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
  } else {
    // Populate projectMap from database
    const existingProjects = await prisma.project.findMany();
    for (const p of existingProjects) {
      projectMap[p.name] = p.id;
    }
  }

  // 6. Seed Invoices (Extensive dataset across 14 distinct clients with diverse statuses, amounts, items)
  const invoiceCount = await prisma.invoice.count();
  if (force || invoiceCount === 0) {
    const mockInvoices = [
      // --- CLIENT 1: Grad Kraljevo – Gradska uprava ---
      {
        invoiceNumber: '2025/084',
        dateCreated: '2025-09-10',
        dueDate: '2025-10-10',
        paymentDate: '2025-09-25',
        clientKey: 'Grad Kraljevo – Gradska uprava',
        projectName: 'Plan upravljanja otpadom – Grad Kraljevo (Godišnji izveštaj)',
        status: 'Paid',
        notes: 'Uplata izvršena u celosti preko trezora.',
        currency: 'RSD',
        totalAmount: 420000,
        createdAt: new Date('2025-09-10T10:00:00Z'),
        items: [
          { description: 'Izrada godišnjeg izveštaja o upravljanju otpadom', quantity: 1, unitPrice: 300000, currency: 'RSD' },
          { description: 'Terenska verifikacija divljih deponija i GIS mapiranje', quantity: 1, unitPrice: 120000, currency: 'RSD' },
        ],
      },
      {
        invoiceNumber: '2025/118',
        dateCreated: '2025-12-15',
        dueDate: '2026-01-15',
        paymentDate: '2025-12-28',
        clientKey: 'Grad Kraljevo – Gradska uprava',
        projectName: 'Ispitivanje kvaliteta zemljišta oko deponije',
        status: 'Paid',
        notes: 'Uplaćeno na osnovu overene situacije.',
        currency: 'RSD',
        totalAmount: 180000,
        createdAt: new Date('2025-12-15T11:30:00Z'),
        items: [
          { description: 'Laboratorijska analiza teških metala u uzorcima zemljišta', quantity: 6, unitPrice: 30000, currency: 'RSD' },
        ],
      },
      {
        invoiceNumber: '2026/052',
        dateCreated: '2026-06-10',
        dueDate: '2026-07-10',
        paymentDate: '2026-06-25',
        clientKey: 'Grad Kraljevo – Gradska uprava',
        projectName: 'Lokalni plan upravljanja otpadom 2026–2031',
        status: 'Paid',
        notes: 'I privremena situacija po ugovoru br. 404-12/2026.',
        currency: 'RSD',
        totalAmount: 350000,
        createdAt: new Date('2026-06-10T09:00:00Z'),
        items: [
          { description: 'Lokalni plan upravljanja otpadom 2026–2031 (Prva faza - analiza stanja)', quantity: 1, unitPrice: 350000, currency: 'RSD' },
        ],
      },
      {
        invoiceNumber: '2026/091',
        dateCreated: '2026-08-15',
        dueDate: '2026-09-15',
        paymentDate: null,
        clientKey: 'Grad Kraljevo – Gradska uprava',
        projectName: 'Lokalni plan upravljanja otpadom 2026–2031',
        status: 'Sent',
        notes: 'II privremena situacija dostavljena pisarnici.',
        currency: 'RSD',
        totalAmount: 350000,
        createdAt: new Date('2026-08-15T10:30:00Z'),
        items: [
          { description: 'Lokalni plan upravljanja otpadom 2026–2031 (Druga faza - ciljevi i mere)', quantity: 1, unitPrice: 350000, currency: 'RSD' },
        ],
      },

      // --- CLIENT 2: EcoRecycling d.o.o. ---
      {
        invoiceNumber: '2025/095',
        dateCreated: '2025-10-25',
        dueDate: '2025-11-25',
        paymentDate: '2025-11-10',
        clientKey: 'EcoRecycling d.o.o.',
        projectName: 'Analiza sastava opasnog industrijskog otpada',
        status: 'Paid',
        notes: 'Elektronska faktura prihvaćena na SEF-u.',
        currency: 'RSD',
        totalAmount: 240000,
        createdAt: new Date('2025-10-25T14:00:00Z'),
        items: [
          { description: 'Fizičko-hemijska analiza uzoraka opasnog otpada', quantity: 2, unitPrice: 120000, currency: 'RSD' },
        ],
      },
      {
        invoiceNumber: '2026/011',
        dateCreated: '2026-01-15',
        dueDate: '2026-02-15',
        paymentDate: '2026-02-02',
        clientKey: 'EcoRecycling d.o.o.',
        projectName: 'Godišnja obnova dozvole za skladištenje neopasnog otpada',
        status: 'Paid',
        notes: 'Plaćeno virmanom.',
        currency: 'RSD',
        totalAmount: 310000,
        createdAt: new Date('2026-01-15T09:15:00Z'),
        items: [
          { description: 'Izrada tehničke dokumentacije za obnovu dozvole skladišta', quantity: 1, unitPrice: 260000, currency: 'RSD' },
          { description: 'Republičke administrativne takse i troškovi obrade', quantity: 1, unitPrice: 50000, currency: 'RSD' },
        ],
      },
      {
        invoiceNumber: '2026/067',
        dateCreated: '2026-07-20',
        dueDate: '2026-08-20',
        paymentDate: '2026-08-05',
        clientKey: 'EcoRecycling d.o.o.',
        projectName: 'Plan zbrinjavanja industrijskog mulja i otpadnih emulzija',
        status: 'Paid',
        notes: 'Plaćeno pre dospeća.',
        currency: 'RSD',
        totalAmount: 195000,
        createdAt: new Date('2026-07-20T11:00:00Z'),
        items: [
          { description: 'Operativni plan zbrinjavanja tehnološkog mulja', quantity: 1, unitPrice: 195000, currency: 'RSD' },
        ],
      },
      {
        invoiceNumber: '2026/089',
        dateCreated: '2026-08-10',
        dueDate: '2026-08-24',
        paymentDate: null,
        clientKey: 'EcoRecycling d.o.o.',
        projectName: 'Studija o proceni uticaja postrojenja za reciklažu plastike',
        status: 'Overdue',
        notes: 'Poslata opomena pred utuženje.',
        currency: 'RSD',
        totalAmount: 280000,
        createdAt: new Date('2026-08-10T12:00:00Z'),
        items: [
          { description: 'Izrada nacrta Studije o proceni uticaja postrojenja za reciklažu', quantity: 1, unitPrice: 280000, currency: 'RSD' },
        ],
      },

      // --- CLIENT 3: Fabrika pakovanja "Pak-Sistem" ---
      {
        invoiceNumber: '2025/106',
        dateCreated: '2025-11-10',
        dueDate: '2025-12-10',
        paymentDate: '2025-11-20',
        clientKey: 'Fabrika pakovanja "Pak-Sistem"',
        projectName: 'Ispitivanje otpadnih voda – IV kvartal 2025',
        status: 'Paid',
        notes: 'Redovno kvartalno plaćanje.',
        currency: 'RSD',
        totalAmount: 95000,
        createdAt: new Date('2025-11-10T08:45:00Z'),
        items: [
          { description: 'Uzorkovanje i laboratorijsko ispitivanje otpadnih voda (IV kvartal 2025)', quantity: 1, unitPrice: 95000, currency: 'RSD' },
        ],
      },
      {
        invoiceNumber: '2026/029',
        dateCreated: '2026-03-15',
        dueDate: '2026-04-15',
        paymentDate: '2026-03-25',
        clientKey: 'Fabrika pakovanja "Pak-Sistem"',
        projectName: 'Kvartalno uzorkovanje otpadnih voda – I kvartal 2026',
        status: 'Paid',
        notes: 'Plaćeno na račun kod Banca Intesa.',
        currency: 'RSD',
        totalAmount: 95000,
        createdAt: new Date('2026-03-15T09:30:00Z'),
        items: [
          { description: 'Uzorkovanje i laboratorijsko ispitivanje otpadnih voda (I kvartal 2026)', quantity: 1, unitPrice: 95000, currency: 'RSD' },
        ],
      },
      {
        invoiceNumber: '2026/047',
        dateCreated: '2026-05-20',
        dueDate: '2026-06-20',
        paymentDate: '2026-06-05',
        clientKey: 'Fabrika pakovanja "Pak-Sistem"',
        projectName: 'Evidencija posebnih tokova otpada i Eko taksa (Izveštaj SEPA)',
        status: 'Paid',
        notes: 'Izveštaj prihvaćen u Agenciji za zaštitu životne sredine.',
        currency: 'RSD',
        totalAmount: 130000,
        createdAt: new Date('2026-05-20T10:00:00Z'),
        items: [
          { description: 'Konsalting i unos podataka u SEPA informacioni sistem', quantity: 1, unitPrice: 130000, currency: 'RSD' },
        ],
      },
      {
        invoiceNumber: '2026/062',
        dateCreated: '2026-06-18',
        dueDate: '2026-07-18',
        paymentDate: '2026-06-30',
        clientKey: 'Fabrika pakovanja "Pak-Sistem"',
        projectName: 'Kvartalno ispitivanje otpadnih voda – II kvartal 2026',
        status: 'Paid',
        notes: 'Plaćeno u ugovorenom roku.',
        currency: 'RSD',
        totalAmount: 95000,
        createdAt: new Date('2026-06-18T09:00:00Z'),
        items: [
          { description: 'Uzorkovanje i laboratorijsko ispitivanje otpadnih voda (II kvartal 2026)', quantity: 1, unitPrice: 95000, currency: 'RSD' },
        ],
      },
      {
        invoiceNumber: '2026/086',
        dateCreated: '2026-08-01',
        dueDate: '2026-08-31',
        paymentDate: null,
        clientKey: 'Fabrika pakovanja "Pak-Sistem"',
        projectName: 'Sanitarni pregled i deratizacija skladišnih hala (SRPS EN 16636)',
        status: 'Sent',
        notes: 'Fakturisano nakon izvršenih DDD mera.',
        currency: 'RSD',
        totalAmount: 65000,
        createdAt: new Date('2026-08-01T08:00:00Z'),
        items: [
          { description: 'Dezinfekcija, dezinsekcija i deratizacija skladišnog prostora', quantity: 1, unitPrice: 65000, currency: 'RSD' },
        ],
      },
      {
        invoiceNumber: '2026/098',
        dateCreated: '2026-08-20',
        dueDate: '2026-09-20',
        paymentDate: null,
        clientKey: 'Fabrika pakovanja "Pak-Sistem"',
        projectName: 'Kvartalno ispitivanje otpadnih voda – III kvartal 2026',
        status: 'Draft',
        notes: 'U pripremi za slanje po završetku laboratorijskih analiza.',
        currency: 'RSD',
        totalAmount: 95000,
        createdAt: new Date('2026-08-20T09:00:00Z'),
        items: [
          { description: 'Uzorkovanje i laboratorijsko ispitivanje otpadnih voda (III kvartal 2026)', quantity: 1, unitPrice: 95000, currency: 'RSD' },
        ],
      },

      // --- CLIENT 4: Metalurgija AD ---
      {
        invoiceNumber: '2025/088',
        dateCreated: '2025-09-20',
        dueDate: '2025-10-20',
        paymentDate: '2025-10-05',
        clientKey: 'Metalurgija AD',
        projectName: 'Periodično ispitivanje emisije buke u životnoj sredini',
        status: 'Paid',
        notes: 'Plaćeno bez primedbi.',
        currency: 'RSD',
        totalAmount: 160000,
        createdAt: new Date('2025-09-20T10:00:00Z'),
        items: [
          { description: 'Akustička merenja nivoa buke u zoni fabrike i stambenih objekata', quantity: 4, unitPrice: 40000, currency: 'RSD' },
        ],
      },
      {
        invoiceNumber: '2026/022',
        dateCreated: '2026-02-20',
        dueDate: '2026-03-20',
        paymentDate: '2026-03-01',
        clientKey: 'Metalurgija AD',
        projectName: 'Dozvola za tretman inertnog otpada',
        status: 'Paid',
        notes: 'Plaćeno po rešenju ministarstva.',
        currency: 'RSD',
        totalAmount: 275000,
        createdAt: new Date('2026-02-20T13:45:00Z'),
        items: [
          { description: 'Izrada projekta za tretman inertnog industrijskog otpada', quantity: 1, unitPrice: 275000, currency: 'RSD' },
        ],
      },
      {
        invoiceNumber: '2026/073',
        dateCreated: '2026-07-15',
        dueDate: '2026-08-15',
        paymentDate: '2026-07-28',
        clientKey: 'Metalurgija AD',
        projectName: 'Merenje emisije praškastih materija i gasova iz postrojenja',
        status: 'Paid',
        notes: 'Uplata primljena.',
        currency: 'RSD',
        totalAmount: 210000,
        createdAt: new Date('2026-07-15T11:00:00Z'),
        items: [
          { description: 'Merenje emisije teških metala i čađi iz topioničkih peći', quantity: 3, unitPrice: 70000, currency: 'RSD' },
        ],
      },
      {
        invoiceNumber: '2026/092',
        dateCreated: '2026-08-12',
        dueDate: '2026-08-25',
        paymentDate: null,
        clientKey: 'Metalurgija AD',
        projectName: 'Merenje emisije buke u radnoj okolini i ventilacionim kanalima',
        status: 'Overdue',
        notes: 'Kontaktirati finansijsku službu klijenta radi plaćanja.',
        currency: 'RSD',
        totalAmount: 140000,
        createdAt: new Date('2026-08-12T09:30:00Z'),
        items: [
          { description: 'Ispitivanje buke i vibracija radnog okruženja', quantity: 1, unitPrice: 140000, currency: 'RSD' },
        ],
      },

      // --- CLIENT 5: AgroPlod d.o.o. ---
      {
        invoiceNumber: '2026/007',
        dateCreated: '2026-01-25',
        dueDate: '2026-02-25',
        paymentDate: '2026-02-10',
        clientKey: 'AgroPlod d.o.o.',
        projectName: 'Implementacija ISO 14001:2015 sistema zaštite životne sredine',
        status: 'Paid',
        notes: 'Plaćen I deo ugovora.',
        currency: 'RSD',
        totalAmount: 380000,
        createdAt: new Date('2026-01-25T10:00:00Z'),
        items: [
          { description: 'Uspostavljanje sistema upravljanja zaštitom životne sredine ISO 14001', quantity: 1, unitPrice: 380000, currency: 'RSD' },
        ],
      },
      {
        invoiceNumber: '2026/039',
        dateCreated: '2026-04-20',
        dueDate: '2026-05-20',
        paymentDate: '2026-05-02',
        clientKey: 'AgroPlod d.o.o.',
        projectName: 'Sertifikacija HACCP sistema za prehrambenu industriju',
        status: 'Paid',
        notes: 'Plaćeno u celosti.',
        currency: 'RSD',
        totalAmount: 290000,
        createdAt: new Date('2026-04-20T11:15:00Z'),
        items: [
          { description: 'Konsalting i priprema za eksterni audit HACCP sistema', quantity: 1, unitPrice: 290000, currency: 'RSD' },
        ],
      },
      {
        invoiceNumber: '2026/064',
        dateCreated: '2026-06-20',
        dueDate: '2026-07-20',
        paymentDate: '2026-07-05',
        clientKey: 'AgroPlod d.o.o.',
        projectName: 'Implementacija ENplus standarda za proizvodnju peleta',
        status: 'Paid',
        notes: 'Plaćeno po završenom auditu.',
        currency: 'RSD',
        totalAmount: 220000,
        createdAt: new Date('2026-06-20T14:00:00Z'),
        items: [
          { description: 'ENplus standard certifikacija procesa peletiranja', quantity: 1, unitPrice: 220000, currency: 'RSD' },
        ],
      },
      {
        invoiceNumber: '2026/087',
        dateCreated: '2026-08-05',
        dueDate: '2026-09-05',
        paymentDate: null,
        clientKey: 'AgroPlod d.o.o.',
        projectName: 'Uvođenje FSC standarda za održivo šumarstvo i ambalažu',
        status: 'Sent',
        notes: 'Ispostavljen račun za pripremnu fazu FSC sertifikacije.',
        currency: 'RSD',
        totalAmount: 180000,
        createdAt: new Date('2026-08-05T09:00:00Z'),
        items: [
          { description: 'Uvođenje standarda FSC CoC – faza 1: analiza tokova drvnog materijala', quantity: 1, unitPrice: 180000, currency: 'RSD' },
        ],
      },

      // --- CLIENT 6: Hemija-Farm Beograd ---
      {
        invoiceNumber: '2025/097',
        dateCreated: '2025-10-15',
        dueDate: '2025-11-15',
        paymentDate: '2025-11-01',
        clientKey: 'Hemija-Farm Beograd',
        projectName: 'Godišnji bezbednosni izveštaj ADR savetnika',
        status: 'Paid',
        notes: 'Godišnji ugovor za poslove ADR savetnika.',
        currency: 'RSD',
        totalAmount: 150000,
        createdAt: new Date('2025-10-15T12:00:00Z'),
        items: [
          { description: 'Godišnje angažovanje ovlašćenog savetnika za bezbednost u transportu ADR', quantity: 1, unitPrice: 150000, currency: 'RSD' },
        ],
      },
      {
        invoiceNumber: '2025/115',
        dateCreated: '2025-12-10',
        dueDate: '2026-01-10',
        paymentDate: '2025-12-22',
        clientKey: 'Hemija-Farm Beograd',
        projectName: 'Obuka zaposlenih za bezbedno rukovanje hemikalijama',
        status: 'Paid',
        notes: 'Plaćeno nakon održane obuke.',
        currency: 'RSD',
        totalAmount: 120000,
        createdAt: new Date('2025-12-10T10:30:00Z'),
        items: [
          { description: 'Stručna teorijska i praktična obuka radnika za bezbedno rukovanje hemikalijama', quantity: 1, unitPrice: 120000, currency: 'RSD' },
        ],
      },
      {
        invoiceNumber: '2026/033',
        dateCreated: '2026-03-22',
        dueDate: '2026-04-22',
        paymentDate: '2026-04-05',
        clientKey: 'Hemija-Farm Beograd',
        projectName: 'Ažuriranje registra hemikalija i bezbednosnih listova',
        status: 'Paid',
        notes: 'Plaćeno virmanom.',
        currency: 'RSD',
        totalAmount: 175000,
        createdAt: new Date('2026-03-22T09:00:00Z'),
        items: [
          { description: 'Izrada i usklađivanje Bezbednosnih listova (MSDS) po CLP uredbi', quantity: 35, unitPrice: 5000, currency: 'RSD' },
        ],
      },
      {
        invoiceNumber: '2026/093',
        dateCreated: '2026-08-16',
        dueDate: '2026-09-16',
        paymentDate: null,
        clientKey: 'Hemija-Farm Beograd',
        projectName: 'Kontrola i bezbednosni pregled hemikalija u skladištu',
        status: 'Sent',
        notes: 'Poslato klijentu na elektronski potpis.',
        currency: 'RSD',
        totalAmount: 160000,
        createdAt: new Date('2026-08-16T11:00:00Z'),
        items: [
          { description: 'Inspekcijski pregled usklađenosti skladišta sa Zakonom o hemikalijama', quantity: 1, unitPrice: 160000, currency: 'RSD' },
        ],
      },

      // --- CLIENT 7: Energo-Term Kraljevo ---
      {
        invoiceNumber: '2025/109',
        dateCreated: '2025-11-20',
        dueDate: '2025-12-20',
        paymentDate: '2025-12-05',
        clientKey: 'Energo-Term Kraljevo',
        projectName: 'Izrada studije o proceni uticaja na životnu sredinu',
        status: 'Paid',
        notes: 'Plaćena konačna situacija.',
        currency: 'RSD',
        totalAmount: 320000,
        createdAt: new Date('2025-11-20T13:00:00Z'),
        items: [
          { description: 'Studija o proceni uticaja energana na biomasu na životnu sredinu', quantity: 1, unitPrice: 320000, currency: 'RSD' },
        ],
      },
      {
        invoiceNumber: '2026/018',
        dateCreated: '2026-02-12',
        dueDate: '2026-03-12',
        paymentDate: '2026-02-28',
        clientKey: 'Energo-Term Kraljevo',
        projectName: 'Ispitivanje emisije gasova iz kotlarnice',
        status: 'Paid',
        notes: 'Redovno merenje.',
        currency: 'RSD',
        totalAmount: 145000,
        createdAt: new Date('2026-02-12T09:45:00Z'),
        items: [
          { description: 'Merenje emisije NOx, SO2, CO i čvrstih čestica iz kotlova', quantity: 1, unitPrice: 145000, currency: 'RSD' },
        ],
      },
      {
        invoiceNumber: '2026/078',
        dateCreated: '2026-08-02',
        dueDate: '2026-08-16',
        paymentDate: null,
        clientKey: 'Energo-Term Kraljevo',
        projectName: 'Godišnji monitoring kvaliteta podzemnih voda oko rezervoara',
        status: 'Overdue',
        notes: 'Klijent najavio plaćanje do kraja nedelje.',
        currency: 'RSD',
        totalAmount: 110000,
        createdAt: new Date('2026-08-02T10:00:00Z'),
        items: [
          { description: 'Uzorkovanje i analiza vode iz pijezometara P-1 i P-2', quantity: 2, unitPrice: 55000, currency: 'RSD' },
        ],
      },
      {
        invoiceNumber: '2026/094',
        dateCreated: '2026-08-18',
        dueDate: '2026-09-18',
        paymentDate: null,
        clientKey: 'Energo-Term Kraljevo',
        projectName: 'Kontrolno ispitivanje emisije dimnih gasova iz toplane',
        status: 'Sent',
        notes: 'Faktura za avgustovsko vanredno merenje.',
        currency: 'RSD',
        totalAmount: 135000,
        createdAt: new Date('2026-08-18T08:30:00Z'),
        items: [
          { description: 'Kontrolno merenje dimnih gasova na izlazu iz ciklona', quantity: 1, unitPrice: 135000, currency: 'RSD' },
        ],
      },

      // --- CLIENT 8: Auto-Delovi Šumadija d.o.o. ---
      {
        invoiceNumber: '2026/026',
        dateCreated: '2026-03-05',
        dueDate: '2026-04-05',
        paymentDate: '2026-03-18',
        clientKey: 'Auto-Delovi Šumadija d.o.o.',
        projectName: 'Merenje emisije u vazduh iz lakirnice',
        status: 'Paid',
        notes: 'Plaćeno bez zakašnjenja.',
        currency: 'RSD',
        totalAmount: 210000,
        createdAt: new Date('2026-03-05T10:00:00Z'),
        items: [
          { description: 'Merenje emisije isparljivih organskih jedinjenja (VOC) iz lakirnice', quantity: 1, unitPrice: 210000, currency: 'RSD' },
        ],
      },
      {
        invoiceNumber: '2026/090',
        dateCreated: '2026-08-14',
        dueDate: '2026-09-14',
        paymentDate: null,
        clientKey: 'Auto-Delovi Šumadija d.o.o.',
        projectName: 'Plan upravljanja tehnološkim otpadom',
        status: 'Sent',
        notes: 'Račun za izradu operativnog plana.',
        currency: 'RSD',
        totalAmount: 175000,
        createdAt: new Date('2026-08-14T11:15:00Z'),
        items: [
          { description: 'Izrada operativnog plana upravljanja otpadnim uljima i emulzijama', quantity: 1, unitPrice: 175000, currency: 'RSD' },
        ],
      },

      // --- CLIENT 9: Drvo-Stil Pro d.o.o. ---
      {
        invoiceNumber: '2026/044',
        dateCreated: '2026-05-10',
        dueDate: '2026-06-10',
        paymentDate: '2026-05-22',
        clientKey: 'Drvo-Stil Pro d.o.o.',
        projectName: 'FSC sertifikacija lanca nadzora drveta',
        status: 'Paid',
        notes: 'Sertifikat uspešno izdat.',
        currency: 'RSD',
        totalAmount: 190000,
        createdAt: new Date('2026-05-10T14:30:00Z'),
        items: [
          { description: 'Uspostavljanje i dokumentovanje FSC Chain of Custody procedura', quantity: 1, unitPrice: 190000, currency: 'RSD' },
        ],
      },
      {
        invoiceNumber: '2026/096',
        dateCreated: '2026-08-19',
        dueDate: '2026-09-19',
        paymentDate: null,
        clientKey: 'Drvo-Stil Pro d.o.o.',
        projectName: null,
        status: 'Sent',
        notes: 'Periodični konsalting za procenu rizika na radu.',
        currency: 'RSD',
        totalAmount: 85000,
        createdAt: new Date('2026-08-19T09:00:00Z'),
        items: [
          { description: 'Stručni pregled zaštite od požara i bezbednosti radnih procesa u pilani', quantity: 1, unitPrice: 85000, currency: 'RSD' },
        ],
      },

      // --- CLIENT 10: Termo-Elektronik Niš ---
      {
        invoiceNumber: '2026/031',
        dateCreated: '2026-03-18',
        dueDate: '2026-04-18',
        paymentDate: '2026-04-02',
        clientKey: 'Termo-Elektronik Niš',
        projectName: 'Elaborat o zaštiti od požara i eksplozija',
        status: 'Paid',
        notes: 'Saglasnost MUP-a dobijena.',
        currency: 'RSD',
        totalAmount: 260000,
        createdAt: new Date('2026-03-18T10:00:00Z'),
        items: [
          { description: 'Izrada Glavnog projekta zaštite od požara za novu proizvodnu halu', quantity: 1, unitPrice: 260000, currency: 'RSD' },
        ],
      },
      {
        invoiceNumber: '2026/095',
        dateCreated: '2026-08-17',
        dueDate: '2026-09-17',
        paymentDate: null,
        clientKey: 'Termo-Elektronik Niš',
        projectName: 'Ispitivanje otpadnih voda iz galvanizacije',
        status: 'Sent',
        notes: 'Uzorkovanje obavljeno 15.08.',
        currency: 'RSD',
        totalAmount: 155000,
        createdAt: new Date('2026-08-17T11:00:00Z'),
        items: [
          { description: 'Kompletna laboratorijska analiza otpadnih voda galvanizacije (hrom, cink, nikal)', quantity: 1, unitPrice: 155000, currency: 'RSD' },
        ],
      },

      // --- CLIENT 11: Mlekara Moravica d.o.o. ---
      {
        invoiceNumber: '2026/050',
        dateCreated: '2026-05-28',
        dueDate: '2026-06-28',
        paymentDate: '2026-06-10',
        clientKey: 'Mlekara Moravica d.o.o.',
        projectName: 'Analiza otpadnih voda i mulja iz separatora',
        status: 'Paid',
        notes: 'Plaćeno sa računa kod Komercijalne banke.',
        currency: 'RSD',
        totalAmount: 165000,
        createdAt: new Date('2026-05-28T09:30:00Z'),
        items: [
          { description: 'Analiza otpadnih voda i mulja iz separatora masti mlekare', quantity: 1, unitPrice: 165000, currency: 'RSD' },
        ],
      },
      {
        invoiceNumber: '2026/097',
        dateCreated: '2026-08-20',
        dueDate: '2026-09-20',
        paymentDate: null,
        clientKey: 'Mlekara Moravica d.o.o.',
        projectName: 'HACCP interna provera i sanitarna inspekcija',
        status: 'Draft',
        notes: 'Nacrt fakture za polugodišnji monitoring.',
        currency: 'RSD',
        totalAmount: 140000,
        createdAt: new Date('2026-08-20T10:15:00Z'),
        items: [
          { description: 'Sprovođenje internog audita higijenskih paketa i HACCP standarda', quantity: 1, unitPrice: 140000, currency: 'RSD' },
        ],
      },

      // --- CLIENT 12: Tehno-Plast d.o.o. ---
      {
        invoiceNumber: '2026/059',
        dateCreated: '2026-06-12',
        dueDate: '2026-07-12',
        paymentDate: '2026-06-26',
        clientKey: 'Tehno-Plast d.o.o.',
        projectName: 'Dozvola za skladištenje i tretman plastičnog otpada',
        status: 'Paid',
        notes: 'Plaćeno po dobijanju rešenja.',
        currency: 'RSD',
        totalAmount: 230000,
        createdAt: new Date('2026-06-12T13:00:00Z'),
        items: [
          { description: 'Izrada radnog plana postrojenja za reciklažu i drobljenje plastike', quantity: 1, unitPrice: 230000, currency: 'RSD' },
        ],
      },
      {
        invoiceNumber: '2026/085',
        dateCreated: '2026-07-28',
        dueDate: '2026-08-11',
        paymentDate: null,
        clientKey: 'Tehno-Plast d.o.o.',
        projectName: null,
        status: 'Cancelled',
        notes: 'Stornirano na zahtev klijenta zbog promene obima usluge.',
        currency: 'RSD',
        totalAmount: 90000,
        createdAt: new Date('2026-07-28T09:00:00Z'),
        items: [
          { description: 'Stručno mišljenje o kategorizaciji otpada (Stornirano)', quantity: 1, unitPrice: 90000, currency: 'RSD' },
        ],
      },

      // --- CLIENT 13: Balkan Petroleum Services ---
      {
        invoiceNumber: '2026/068',
        dateCreated: '2026-07-02',
        dueDate: '2026-08-02',
        paymentDate: '2026-07-18',
        clientKey: 'Balkan Petroleum Services',
        projectName: 'ADR bezbednosni konsalting i kontrola rezervoara za derivate',
        status: 'Paid',
        notes: 'Devizno plaćanje realizovano.',
        currency: '€',
        totalAmount: 3200,
        createdAt: new Date('2026-07-02T10:00:00Z'),
        items: [
          { description: 'ADR sigurnosna provera terminala za pretakanje goriva', quantity: 1, unitPrice: 2000, currency: '€' },
          { description: 'Sertifikacija osoblja za rukovanje opasnim teretima klase 3', quantity: 6, unitPrice: 200, currency: '€' },
        ],
      },
      {
        invoiceNumber: '2026/099',
        dateCreated: '2026-08-22',
        dueDate: '2026-09-22',
        paymentDate: null,
        clientKey: 'Balkan Petroleum Services',
        projectName: 'Plan zaštite od akcidentnih izlivanja nafte',
        status: 'Sent',
        notes: 'Fakturisano po ugovoru o vanrednim ekološkim merama.',
        currency: '€',
        totalAmount: 2500,
        createdAt: new Date('2026-08-22T14:00:00Z'),
        items: [
          { description: 'Izrada Plana reagovanja u slučaju izlivanja naftnih derivata u vodotokove', quantity: 1, unitPrice: 2500, currency: '€' },
        ],
      },

      // --- CLIENT 14: Vojvodina Agrar d.o.o. ---
      {
        invoiceNumber: '2026/072',
        dateCreated: '2026-07-10',
        dueDate: '2026-08-10',
        paymentDate: '2026-07-24',
        clientKey: 'Vojvodina Agrar d.o.o.',
        projectName: 'Procena uticaja na životnu sredinu za silosne kapacitete',
        status: 'Paid',
        notes: 'Plaćeno u celosti virmanom.',
        currency: 'RSD',
        totalAmount: 310000,
        createdAt: new Date('2026-07-10T12:30:00Z'),
        items: [
          { description: 'Izrada Zahteva o potrebi procene uticaja na životnu sredinu za silose', quantity: 1, unitPrice: 310000, currency: 'RSD' },
        ],
      },
    ];

    for (const inv of mockInvoices) {
      const client = clientMap[inv.clientKey];
      const projectId = inv.projectName ? (projectMap[inv.projectName] || null) : null;

      await prisma.invoice.create({
        data: {
          invoiceNumber: inv.invoiceNumber,
          dateCreated: inv.dateCreated,
          dueDate: inv.dueDate,
          paymentDate: inv.paymentDate,
          clientId: client?.id || null,
          clientName: client?.name || inv.clientKey,
          projectId: projectId,
          projectName: inv.projectName || null,
          status: inv.status,
          notes: inv.notes,
          totalAmount: inv.totalAmount,
          currency: inv.currency,
          createdAt: inv.createdAt,
          updatedAt: inv.createdAt,
          items: {
            create: inv.items.map((item) => ({
              description: item.description,
              quantity: item.quantity,
              unitPrice: item.unitPrice,
              currency: item.currency,
            })),
          },
        },
      });
    }

    console.log(`✅ Seeded ${mockInvoices.length} invoices across 14 clients.`);
  }

  
  // Seed CompanyInfo (Serbian Latin)
  const defaultCompanyInfo = {
    id: 'default',
    name: 'EKOS GREEN GROUP',
    legalName: 'EKOS GREEN GROUP DOO Kraljevo',
    registrationNumber: '21823759',
    municipality: 'KRALJEVO',
    city: 'KRALJEVO',
    streetAddress: 'HEROJA MARIČIĆA 18',
    postalCode: '36000',
    postOffice: 'KRALJEVO',
    email: 'office@ekosgroup.rs',
    taxId: '113207057',
    activityCode: '7490 - Ostale stručne, naučne i tehničke delatnosti',
    bankAccounts: [
      '325-9500700212451-35',
      '205-0000000547461-12',
      '205-0070100584938-90',
      '325-9601700087442-40',
      '325-9500700218732-10',
      '205-0000000525461-52',
    ],
  };

  const existingCompanyInfo = await prisma.companyInfo.findUnique({ where: { id: 'default' } });
  if (!existingCompanyInfo) {
    await prisma.companyInfo.create({ data: defaultCompanyInfo });
    console.log('✅ Seeded default company info');
  } else if (force) {
    await prisma.companyInfo.update({
      where: { id: 'default' },
      data: defaultCompanyInfo,
    });
    console.log('✅ Updated default company info');
  }

  const finalProjectCount = await prisma.project.count();
  const finalReminderCount = await prisma.reminder.count();
  const finalInvoiceCount = await prisma.invoice.count();
  const finalClientCount = await prisma.client.count();

  console.log(`🎉 Seed completed successfully: ${finalClientCount} clients, ${finalProjectCount} projects, ${finalReminderCount} reminders, ${finalInvoiceCount} invoices.`);
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
