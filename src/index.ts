import express, { Request, Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { prisma } from './db';
import { seed } from './seed';
import { hashPassword, verifyPassword, generateToken, verifyToken } from './authUtils';

const envFile = process.env.DOTENV_CONFIG_PATH || process.env.ENV_FILE || '.env';
if (fs.existsSync(path.resolve(process.cwd(), envFile))) {
  dotenv.config({ path: path.resolve(process.cwd(), envFile), override: true });
} else {
  dotenv.config({ override: true });
}

const app = express();
const PORT = process.env.PORT || 5000;

app.use(
  helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  })
);

const envOrigins = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(',').map((o) => o.trim())
  : [];

const defaultDevOrigins = [
  'http://localhost:5173',
  'http://localhost:3000',
  'http://127.0.0.1:5173',
  'http://localhost:4173',
  'http://localhost:5000',
];

const isProduction = process.env.NODE_ENV === 'production';
const allowedOrigins = [
  ...envOrigins,
  ...(!isProduction ? defaultDevOrigins : []),
];

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow non-browser requests with no origin header (server-to-server, curl, mobile apps)
      if (!origin) return callback(null, true);

      // If '*' is explicitly configured, allow all origins
      if (allowedOrigins.includes('*')) return callback(null, true);

      // Enforce strict origin whitelist check
      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      console.warn(`[CORS Blocked] Origin: ${origin}`);
      return callback(null, false);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-User-Id', 'Accept', 'Origin'],
  })
);

app.use(express.json());

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 25,
  message: { error: 'TOO_MANY_REQUESTS', message: 'Too many authentication requests from this IP, please try again after 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
});

app.use('/api/auth/login', authLimiter);
app.use('/api/auth/register', authLimiter);

function addMonths(dateStr: string, months: number): string {
  const d = new Date(dateStr);
  d.setMonth(d.getMonth() + months);
  return d.toISOString().slice(0, 10);
}

function daysUntil(dateStr: string): number {
  const d = new Date(dateStr);
  const now = new Date(new Date().toDateString());
  return Math.round((d.getTime() - now.getTime()) / 86400000);
}

function isStale(p: { done: boolean; start: string | null }): boolean {
  if (p.done || !p.start) return false;
  const start = new Date(p.start);
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - 2);
  return start < cutoff;
}

async function getAuthUser(req: Request) {
  // 1. Try Bearer JWT token in Authorization header
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7).trim();
    const payload = verifyToken(token);
    if (payload && payload.userId) {
      const user = await prisma.user.findUnique({ where: { id: payload.userId } });
      if (user) return user;
    }
  }

  // 2. Fallback to X-User-Id header for transitional support
  const userId = req.headers['x-user-id'] as string;
  if (userId) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (user) return user;
  }

  return null;
}

function isAdminOrManager(role: string): boolean {
  return role === 'Administrator' || role === 'Manager';
}

function isProjectOwnerOrAdminManager(
  user: { id: string; name: string; role: string },
  project: { responsible: string | null; responsibleId: string | null }
): boolean {
  if (isAdminOrManager(user.role)) return true;
  if (project.responsible && project.responsible.trim().toLowerCase() === user.name.trim().toLowerCase()) return true;
  if (project.responsibleId && project.responsibleId === user.id) return true;
  return false;
}

// Global API authentication middleware
app.use('/api', async (req: Request, res: Response, next: express.NextFunction) => {
  if (req.path === '/auth/login' || req.path === '/auth/register') {
    return next();
  }
  const authUser = await getAuthUser(req);
  if (!authUser) {
    return res.status(401).json({ error: 'UNAUTHORIZED', message: 'Authentication required. Please log in.' });
  }
  (req as any).authUser = authUser;
  next();
});

// ----------------------------------------------------
// HEALTH CHECK
// ----------------------------------------------------
app.get('/health', (req: Request, res: Response) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.get('/', (req: Request, res: Response) => {
  res.status(200).json({ message: 'Ekos Project Tracker API is running.' });
});

// ----------------------------------------------------
// STATS & OVERVIEW
// ----------------------------------------------------
app.get('/api/projects/stats', async (req: Request, res: Response) => {
  try {
    const projects = await prisma.project.findMany();
    const clientsCount = await prisma.client.count();
    const usersCount = await prisma.user.count();
    const servicesCount = await prisma.service.count();
    const categoriesCount = await prisma.category.count();

    const active = projects.filter((p) => !p.done).length;
    const done = projects.filter((p) => p.done).length;
    const stale = projects.filter(isStale).length;
    const monitor = projects.filter(
      (p) => p.nextSample && daysUntil(p.nextSample) <= 14
    ).length;

    res.json({
      active,
      done,
      stale,
      monitor,
      clientsCount,
      usersCount,
      servicesCount,
      categoriesCount,
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch project stats' });
  }
});

// ----------------------------------------------------
// REMINDERS CRUD
// ----------------------------------------------------
app.get('/api/reminders', async (req: Request, res: Response) => {
  try {
    const search = ((req.query.search as string) || '').trim().toLowerCase();
    let reminders = await prisma.reminder.findMany({
      orderBy: { createdAt: 'desc' },
      include: { project: true, client: true, responsibleUser: true },
    });

    // Auto-seed reminders from nextSample projects if database has 0 reminders
    if (reminders.length === 0) {
      const sampleProjects = await prisma.project.findMany({
        where: { nextSample: { not: null } },
      });
      for (const p of sampleProjects) {
        await prisma.reminder.create({
          data: {
            title: p.name,
            projectId: p.id,
            projectName: p.name,
            clientId: p.clientId,
            clientName: p.clientName,
            responsibleId: p.responsibleId,
            responsible: p.responsible,
            status: p.done ? 'Completed' : 'Pending',
            notes: `Sampling date: ${p.nextSample}`,
            dueDate: p.nextSample,
          },
        });
      }
      reminders = await prisma.reminder.findMany({
        orderBy: { createdAt: 'desc' },
        include: { project: true, client: true, responsibleUser: true },
      });
    }

    if (!search) return res.json(reminders);

    const filtered = reminders.filter(
      (r) =>
        (r.title || '').toLowerCase().includes(search) ||
        (r.projectName || '').toLowerCase().includes(search) ||
        (r.clientName || '').toLowerCase().includes(search) ||
        (r.responsible || '').toLowerCase().includes(search) ||
        (r.status || '').toLowerCase().includes(search) ||
        (r.notes || '').toLowerCase().includes(search)
    );

    res.json(filtered);
  } catch (error) {
    console.error('Error fetching reminders:', error);
    res.status(500).json({ error: 'Failed to fetch reminders' });
  }
});

app.post('/api/reminders', async (req: Request, res: Response) => {
  try {
    const { title, projectId, projectName, clientId, clientName, responsibleId, responsible, status, notes, dueDate } = req.body;

    const finalTitle = title || projectName;
    if (!finalTitle) {
      return res.status(400).json({ error: 'Reminder title or project name is required' });
    }

    const reminder = await prisma.reminder.create({
      data: {
        title: finalTitle,
        projectId: projectId || null,
        projectName: projectName || null,
        clientId: clientId || null,
        clientName: clientName || null,
        responsibleId: responsibleId || null,
        responsible: responsible || null,
        status: status || 'Pending',
        notes: notes || null,
        dueDate: dueDate || null,
      },
    });

    res.status(201).json(reminder);
  } catch (error) {
    console.error('Error creating reminder:', error);
    res.status(500).json({ error: 'Failed to create reminder' });
  }
});

app.put('/api/reminders/:id', async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const { title, projectId, projectName, clientId, clientName, responsibleId, responsible, status, notes, dueDate } = req.body;

    const existing = await prisma.reminder.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ error: 'Reminder not found' });
    }

    const updated = await prisma.reminder.update({
      where: { id },
      data: {
        title: title !== undefined ? (title || null) : existing.title,
        projectId: projectId !== undefined ? (projectId || null) : existing.projectId,
        projectName: projectName !== undefined ? (projectName || null) : existing.projectName,
        clientId: clientId !== undefined ? (clientId || null) : existing.clientId,
        clientName: clientName !== undefined ? (clientName || null) : existing.clientName,
        responsibleId: responsibleId !== undefined ? (responsibleId || null) : existing.responsibleId,
        responsible: responsible !== undefined ? (responsible || null) : existing.responsible,
        status: status || existing.status,
        notes: notes !== undefined ? (notes || null) : existing.notes,
        dueDate: dueDate !== undefined ? (dueDate || null) : existing.dueDate,
      },
    });

    res.json(updated);
  } catch (error) {
    console.error('Error updating reminder:', error);
    res.status(500).json({ error: 'Failed to update reminder' });
  }
});

app.patch('/api/reminders/:id/status', async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const { status } = req.body;

    const existing = await prisma.reminder.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ error: 'Reminder not found' });
    }

    const updated = await prisma.reminder.update({
      where: { id },
      data: { status: status || 'Completed' },
    });

    res.json(updated);
  } catch (error) {
    console.error('Error updating reminder status:', error);
    res.status(500).json({ error: 'Failed to update reminder status' });
  }
});

app.delete('/api/reminders/:id', async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    await prisma.reminder.delete({ where: { id } });
    res.json({ message: 'Reminder deleted successfully' });
  } catch (error) {
    console.error('Error deleting reminder:', error);
    res.status(500).json({ error: 'Failed to delete reminder' });
  }
});

// ----------------------------------------------------
// PROJECTS CRUD
// ----------------------------------------------------
app.get('/api/projects', async (req: Request, res: Response) => {
  try {
    const search = ((req.query.search as string) || '').trim().toLowerCase();
    const projects = await prisma.project.findMany({
      orderBy: { createdAt: 'desc' },
      include: { client: true },
    });

    if (!search) return res.json(projects);

    const filtered = projects.filter(
      (p) =>
        p.name.toLowerCase().includes(search) ||
        p.clientName.toLowerCase().includes(search) ||
        (p.responsible || '').toLowerCase().includes(search)
    );

    res.json(filtered);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch projects' });
  }
});

app.post('/api/projects', async (req: Request, res: Response) => {
  try {
    const authUser = (req as any).authUser;
    const { name, clientId, clientName, responsible, type, start, deadline, progress, done, nextSample } = req.body;

    if (!name || (!clientId && !clientName) || !type) {
      return res.status(400).json({ error: 'Name, client, and type are required' });
    }

    let finalClientName = clientName || '';
    if (clientId) {
      const c = await prisma.client.findUnique({ where: { id: clientId } });
      if (c) finalClientName = c.name;
    }

    // Standard Users must assign themselves as responsible
    let finalResponsible = responsible || authUser.name;
    let finalResponsibleId: string | null = authUser.id;

    if (authUser.role === 'User') {
      finalResponsible = authUser.name;
      finalResponsibleId = authUser.id;
    } else if (responsible) {
      // Find matching user ID if possible
      const matchedUser = await prisma.user.findFirst({ where: { name: responsible } });
      if (matchedUser) finalResponsibleId = matchedUser.id;
    }

    const computedNextSample = nextSample || null;

    const progVal = Math.max(0, Math.min(100, Number(progress) || 0));
    const isDone = done !== undefined ? Boolean(done) : progVal >= 100;

    const project = await prisma.project.create({
      data: {
        name,
        clientId: clientId || null,
        clientName: finalClientName,
        responsible: finalResponsible,
        responsibleId: finalResponsibleId,
        type,
        start: start || null,
        deadline: deadline || null,
        progress: progVal,
        done: isDone,
        nextSample: computedNextSample,
      },
    });

    res.status(201).json(project);
  } catch (error) {
    res.status(500).json({ error: 'Failed to create project' });
  }
});

app.put('/api/projects/:id', async (req: Request, res: Response) => {
  try {
    const authUser = (req as any).authUser;
    const id = req.params.id as string;
    const { name, clientId, clientName, responsible, type, start, deadline, progress, done, nextSample } = req.body;

    const existing = await prisma.project.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: 'Project not found' });

    if (!isProjectOwnerOrAdminManager(authUser, existing)) {
      return res.status(403).json({ error: 'Permission denied. Standard Users can only edit their own projects.' });
    }

    let finalClientName = clientName || existing.clientName;
    if (clientId) {
      const c = await prisma.client.findUnique({ where: { id: clientId } });
      if (c) finalClientName = c.name;
    }

    let finalResponsible = responsible || existing.responsible;
    let finalResponsibleId = existing.responsibleId;

    if (authUser.role === 'User') {
      finalResponsible = authUser.name;
      finalResponsibleId = authUser.id;
    } else if (responsible) {
      const matchedUser = await prisma.user.findFirst({ where: { name: responsible } });
      if (matchedUser) finalResponsibleId = matchedUser.id;
    }

    const computedNextSample = nextSample || null;

    const progVal = Math.max(0, Math.min(100, Number(progress) || 0));
    const isDone = done !== undefined ? Boolean(done) : (progVal >= 100 ? true : existing.done);

    const updated = await prisma.project.update({
      where: { id },
      data: {
        name,
        clientId: clientId || null,
        clientName: finalClientName,
        responsible: finalResponsible,
        responsibleId: finalResponsibleId,
        type,
        start: start || null,
        deadline: deadline || null,
        progress: progVal,
        done: isDone,
        nextSample: computedNextSample,
      },
    });

    res.json(updated);
  } catch (error) {
    res.status(500).json({ error: 'Failed to update project' });
  }
});

app.patch('/api/projects/:id/toggle-done', async (req: Request, res: Response) => {
  try {
    const authUser = (req as any).authUser;
    const id = req.params.id as string;
    const existing = await prisma.project.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: 'Project not found' });

    if (!isProjectOwnerOrAdminManager(authUser, existing)) {
      return res.status(403).json({ error: 'Permission denied. Standard Users can only edit their own projects.' });
    }

    const newDone = !existing.done;
    const newProgress = newDone ? 100 : existing.progress;

    const updated = await prisma.project.update({
      where: { id },
      data: { done: newDone, progress: newProgress },
    });

    res.json(updated);
  } catch (error) {
    res.status(500).json({ error: 'Failed to toggle status' });
  }
});

app.patch('/api/projects/:id/sample', async (req: Request, res: Response) => {
  try {
    const authUser = (req as any).authUser;
    const id = req.params.id as string;
    const existing = await prisma.project.findUnique({ where: { id } });
    if (!existing || !existing.nextSample) {
      return res.status(400).json({ error: 'Project has no next sample date' });
    }

    if (!isProjectOwnerOrAdminManager(authUser, existing)) {
      return res.status(403).json({ error: 'Permission denied. Standard Users can only edit their own projects.' });
    }

    const service = await prisma.service.findUnique({ where: { code: existing.type } });
    const freq = service?.frequency || 3;
    const newNextSample = addMonths(existing.nextSample, freq);

    const updated = await prisma.project.update({
      where: { id },
      data: { nextSample: newNextSample },
    });

    res.json(updated);
  } catch (error) {
    res.status(500).json({ error: 'Failed to advance sample date' });
  }
});

app.delete('/api/projects/:id', async (req: Request, res: Response) => {
  try {
    const authUser = (req as any).authUser;
    const id = req.params.id as string;
    const existing = await prisma.project.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: 'Project not found' });

    if (!isProjectOwnerOrAdminManager(authUser, existing)) {
      return res.status(403).json({ error: 'Permission denied. Standard Users can only delete their own projects.' });
    }

    await prisma.project.delete({ where: { id } });
    res.json({ message: 'Project deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete project' });
  }
});

// ----------------------------------------------------
// CLIENTS CRUD
// ----------------------------------------------------
app.get('/api/clients', async (req: Request, res: Response) => {
  try {
    const clients = await prisma.client.findMany({
      orderBy: { name: 'asc' },
      include: { projects: true },
    });
    res.json(clients);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch clients' });
  }
});

app.post('/api/clients', async (req: Request, res: Response) => {
  try {
    const authUser = (req as any).authUser;
    if (!isAdminOrManager(authUser.role)) {
      return res.status(403).json({ error: 'Permission denied. Only Administrators and Managers can manage clients.' });
    }

    const { name, contactPerson, email, phone, city } = req.body;
    if (!name) return res.status(400).json({ error: 'Client name is required' });

    const client = await prisma.client.create({
      data: { name, contactPerson, email, phone, city },
    });
    res.status(201).json(client);
  } catch (error) {
    res.status(500).json({ error: 'Failed to create client' });
  }
});

app.put('/api/clients/:id', async (req: Request, res: Response) => {
  try {
    const authUser = (req as any).authUser;
    if (!isAdminOrManager(authUser.role)) {
      return res.status(403).json({ error: 'Permission denied. Only Administrators and Managers can manage clients.' });
    }

    const id = req.params.id as string;
    const { name, contactPerson, email, phone, city } = req.body;
    const updated = await prisma.client.update({
      where: { id },
      data: { name, contactPerson, email, phone, city },
    });
    res.json(updated);
  } catch (error) {
    res.status(500).json({ error: 'Failed to update client' });
  }
});

app.delete('/api/clients/:id', async (req: Request, res: Response) => {
  try {
    const authUser = (req as any).authUser;
    if (!isAdminOrManager(authUser.role)) {
      return res.status(403).json({ error: 'Permission denied. Only Administrators and Managers can manage clients.' });
    }

    const id = req.params.id as string;
    await prisma.client.delete({ where: { id } });
    res.json({ message: 'Client deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete client' });
  }
});

// ----------------------------------------------------
// AUTHENTICATION & REGISTRATION
// ----------------------------------------------------
app.post('/api/auth/login', async (req: Request, res: Response) => {
  try {
    const { emailOrName, password } = req.body;
    if (!emailOrName || !password) {
      return res.status(400).json({ error: 'Email/Username and Password are required.' });
    }

    const searchStr = emailOrName.trim().toLowerCase();
    const user = await prisma.user.findFirst({
      where: {
        OR: [
          { email: { equals: searchStr, mode: 'insensitive' } },
          { name: { equals: searchStr, mode: 'insensitive' } },
        ],
      },
    });

    if (!user) {
      return res.status(401).json({ error: 'INVALID_CREDENTIALS', message: 'Invalid email/username or password.' });
    }

    // Verify password if user has a password set
    if (user.password) {
      const isValid = verifyPassword(password, user.password);
      if (!isValid) {
        return res.status(401).json({ error: 'INVALID_CREDENTIALS', message: 'Invalid email/username or password.' });
      }

      // Automatically upgrade legacy PBKDF2 hash to bcrypt
      if (!user.password.startsWith('$2')) {
        const bcryptHash = hashPassword(password);
        await prisma.user.update({
          where: { id: user.id },
          data: { password: bcryptHash },
        });
      }
    }

    // Check approval status
    if (user.status === 'PENDING') {
      return res.status(403).json({
        error: 'PENDING_APPROVAL',
        message: 'Your account is pending manager approval.',
      });
    }

    if (user.status === 'BLOCKED' || user.isApproved === false) {
      return res.status(403).json({
        error: 'ACCOUNT_BLOCKED',
        message: 'Contact administrator for more information.',
      });
    }

    if (user.status === 'REJECTED') {
      return res.status(403).json({
        error: 'ACCOUNT_REJECTED',
        message: 'Your registration request was not approved.',
      });
    }

    const token = generateToken(user);
    const { password: _, ...userWithoutPassword } = user;
    res.json({ user: userWithoutPassword, token });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Failed to process login.' });
  }
});

app.post('/api/auth/register', async (req: Request, res: Response) => {
  try {
    const { name, email, phone, password, gender } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Full name is required.' });
    }
    if (!email || !email.trim()) {
      return res.status(400).json({ error: 'Email is required.' });
    }
    if (!password || password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters long.' });
    }

    const existingUser = await prisma.user.findFirst({
      where: {
        OR: [
          { email: { equals: email.trim(), mode: 'insensitive' } },
          { name: { equals: name.trim(), mode: 'insensitive' } },
        ],
      },
    });

    if (existingUser) {
      return res.status(400).json({ error: 'A user with this name or email already exists.' });
    }

    const hashedPassword = hashPassword(password);
    const newUser = await prisma.user.create({
      data: {
        name: name.trim(),
        email: email.trim(),
        phone: phone ? phone.trim() : null,
        password: hashedPassword,
        gender: gender ? gender.trim() : null,
        isApproved: false,
        status: 'PENDING',
        role: 'User',
      },
    });

    const token = generateToken(newUser);
    const { password: _, ...userWithoutPassword } = newUser;
    res.status(201).json({
      message: 'Registration submitted successfully! Your account is pending manager approval.',
      user: userWithoutPassword,
      token,
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Failed to process registration.' });
  }
});

app.get('/api/auth/me', async (req: Request, res: Response) => {
  try {
    const authUser = await getAuthUser(req);
    if (!authUser) {
      return res.status(401).json({ error: 'UNAUTHORIZED', message: 'Authentication required.' });
    }
    if ((authUser as any).status === 'BLOCKED' || ((authUser as any).isApproved === false && (authUser as any).status !== 'PENDING')) {
      return res.status(403).json({ error: 'ACCOUNT_BLOCKED', message: 'Contact administrator for more information.' });
    }
    const { password: _, ...userWithoutPassword } = authUser as any;
    res.json(userWithoutPassword);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch current user' });
  }
});

// ----------------------------------------------------
// USERS CRUD
// ----------------------------------------------------
app.get('/api/users', async (req: Request, res: Response) => {
  try {
    const users = await prisma.user.findMany({
      orderBy: { name: 'asc' },
    });
    const sanitizedUsers = users.map(({ password, ...rest }) => rest);
    res.json(sanitizedUsers);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

app.post('/api/users', async (req: Request, res: Response) => {
  try {
    const authUser = (req as any).authUser;
    if (!isAdminOrManager(authUser.role)) {
      return res.status(403).json({ error: 'Permission denied. Only Administrators and Managers can manage users.' });
    }

    const { name, email, role, phone, password, gender } = req.body;
    if (!name) return res.status(400).json({ error: 'User name is required' });

    const targetRole = role || 'User';

    // Manager cannot create an Administrator account
    if (authUser.role === 'Manager' && targetRole === 'Administrator') {
      return res.status(403).json({ error: 'Permission denied. Managers cannot assign the Administrator role.' });
    }

    const hashedPassword = password ? hashPassword(password) : hashPassword('password123');

    const user = await prisma.user.create({
      data: {
        name,
        email,
        role: targetRole,
        phone,
        gender: gender || null,
        password: hashedPassword,
        isApproved: true,
        status: 'APPROVED',
      },
    });
    const { password: _, ...userWithoutPassword } = user;
    res.status(201).json(userWithoutPassword);
  } catch (error) {
    res.status(500).json({ error: 'Failed to create user' });
  }
});

app.put('/api/users/:id', async (req: Request, res: Response) => {
  try {
    const authUser = (req as any).authUser;
    const id = req.params.id as string;
    const isSelf = authUser.id === id;

    if (!isAdminOrManager(authUser.role) && !isSelf) {
      return res.status(403).json({ error: 'Permission denied. Only Administrators and Managers can manage users.' });
    }

    const { name, email, role, phone, avatarUrl, password, currentPassword, isApproved, status, gender } = req.body;

    const existingUser = await prisma.user.findUnique({ where: { id } });
    if (!existingUser) return res.status(404).json({ error: 'User not found' });

    let finalRole = existingUser.role;
    if (isAdminOrManager(authUser.role)) {
      finalRole = role || existingUser.role;
    }

    // Manager cannot edit an Administrator account or upgrade someone to Administrator
    if (authUser.role === 'Manager') {
      if (existingUser.role === 'Administrator') {
        return res.status(403).json({ error: 'Permission denied. Managers cannot modify Administrator accounts.' });
      }
      if (finalRole === 'Administrator') {
        return res.status(403).json({ error: 'Permission denied. Managers cannot assign the Administrator role.' });
      }
    }

    const updatedData: any = {
      name: name !== undefined ? name : existingUser.name,
      email: email !== undefined ? email : existingUser.email,
      phone: phone !== undefined ? phone : existingUser.phone,
      avatarUrl: avatarUrl !== undefined ? avatarUrl : (existingUser as any).avatarUrl,
      gender: gender !== undefined ? gender : (existingUser as any).gender,
      role: finalRole,
    };

    if (password) {
      if (isSelf && currentPassword !== undefined) {
        if (!verifyPassword(currentPassword, existingUser.password)) {
          return res.status(400).json({ error: 'Current password is incorrect' });
        }
      }
      updatedData.password = hashPassword(password);
    }
    if (isAdminOrManager(authUser.role)) {
      if (status !== undefined) {
        updatedData.status = status;
        updatedData.isApproved = status === 'APPROVED';
      } else if (isApproved !== undefined) {
        updatedData.isApproved = isApproved;
        updatedData.status = isApproved ? 'APPROVED' : 'BLOCKED';
      }
    }

    const updated = await prisma.user.update({
      where: { id },
      data: updatedData,
    });
    const { password: _, ...userWithoutPassword } = updated;
    res.json(userWithoutPassword);
  } catch (error) {
    res.status(500).json({ error: 'Failed to update user' });
  }
});

app.post('/api/users/:id/approve', async (req: Request, res: Response) => {
  try {
    const authUser = (req as any).authUser;
    if (!isAdminOrManager(authUser.role)) {
      return res.status(403).json({ error: 'Permission denied. Only Administrators and Managers can approve users.' });
    }

    const id = req.params.id as string;
    const { role } = req.body;
    const targetRole = role || 'User';

    if (authUser.role === 'Manager' && targetRole === 'Administrator') {
      return res.status(403).json({ error: 'Permission denied. Managers cannot assign the Administrator role.' });
    }

    const updatedUser = await prisma.user.update({
      where: { id },
      data: {
        isApproved: true,
        status: 'APPROVED',
        role: targetRole,
      },
    });

    const { password: _, ...userWithoutPassword } = updatedUser;
    res.json(userWithoutPassword);
  } catch (error) {
    res.status(500).json({ error: 'Failed to approve user' });
  }
});

app.post('/api/users/:id/reject', async (req: Request, res: Response) => {
  try {
    const authUser = (req as any).authUser;
    if (!isAdminOrManager(authUser.role)) {
      return res.status(403).json({ error: 'Permission denied. Only Administrators and Managers can reject users.' });
    }

    const id = req.params.id as string;
    const existingUser = await prisma.user.findUnique({ where: { id } });
    if (!existingUser) return res.status(404).json({ error: 'User not found' });

    if (authUser.role === 'Manager' && existingUser.role === 'Administrator') {
      return res.status(403).json({ error: 'Permission denied.' });
    }

    await prisma.user.delete({ where: { id } });
    res.json({ message: 'Registration rejected and account removed.' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to reject user' });
  }
});

app.delete('/api/users/:id', async (req: Request, res: Response) => {
  try {
    const authUser = (req as any).authUser;
    if (!isAdminOrManager(authUser.role)) {
      return res.status(403).json({ error: 'Permission denied. Only Administrators and Managers can manage users.' });
    }

    const id = req.params.id as string;
    const existingUser = await prisma.user.findUnique({ where: { id } });
    if (!existingUser) return res.status(404).json({ error: 'User not found' });

    // Manager cannot delete an Administrator account
    if (authUser.role === 'Manager' && existingUser.role === 'Administrator') {
      return res.status(403).json({ error: 'Permission denied. Managers cannot delete Administrator accounts.' });
    }

    await prisma.user.delete({ where: { id } });
    res.json({ message: 'User deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete user' });
  }
});

// ----------------------------------------------------
// SERVICES CRUD
// ----------------------------------------------------
app.get('/api/services', async (req: Request, res: Response) => {
  try {
    const services = await prisma.service.findMany({
      orderBy: { name: 'asc' },
    });
    res.json(services);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch services' });
  }
});

app.post('/api/services', async (req: Request, res: Response) => {
  try {
    const authUser = (req as any).authUser;
    if (!isAdminOrManager(authUser.role)) {
      return res.status(403).json({ error: 'Permission denied. Only Administrators and Managers can manage services.' });
    }

    const { code, name, group, frequency, description } = req.body;
    if (!code || !name) return res.status(400).json({ error: 'Code and Name are required' });

    const service = await prisma.service.create({
      data: {
        code,
        name,
        group: group || 'grp-legal',
        frequency: Number(frequency) || 0,
        description: description ? description.trim() : null,
      },
    });
    res.status(201).json(service);
  } catch (error) {
    res.status(500).json({ error: 'Failed to create service' });
  }
});

app.put('/api/services/:id', async (req: Request, res: Response) => {
  try {
    const authUser = (req as any).authUser;
    if (!isAdminOrManager(authUser.role)) {
      return res.status(403).json({ error: 'Permission denied. Only Administrators and Managers can manage services.' });
    }

    const id = req.params.id as string;
    const { name, group, frequency, description } = req.body;
    const updated = await prisma.service.update({
      where: { id },
      data: {
        name,
        group,
        frequency: Number(frequency) || 0,
        description: description ? description.trim() : null,
      },
    });
    res.json(updated);
  } catch (error) {
    res.status(500).json({ error: 'Failed to update service' });
  }
});

app.delete('/api/services/:id', async (req: Request, res: Response) => {
  try {
    const authUser = (req as any).authUser;
    if (!isAdminOrManager(authUser.role)) {
      return res.status(403).json({ error: 'Permission denied. Only Administrators and Managers can manage services.' });
    }

    const id = req.params.id as string;
    await prisma.service.delete({ where: { id } });
    res.json({ message: 'Service deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete service' });
  }
});

// ----------------------------------------------------
// CATEGORIES CRUD
// ----------------------------------------------------
app.get('/api/categories', async (req: Request, res: Response) => {
  try {
    const categories = await prisma.category.findMany({
      orderBy: { name: 'asc' },
    });
    res.json(categories);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch categories' });
  }
});

app.post('/api/categories', async (req: Request, res: Response) => {
  try {
    const authUser = (req as any).authUser;
    if (!isAdminOrManager(authUser.role)) {
      return res.status(403).json({ error: 'Permission denied. Only Administrators and Managers can manage categories.' });
    }

    const { code, name, description } = req.body;
    if (!code || !name) return res.status(400).json({ error: 'Code and Name are required' });

    const formattedCode = code.trim().toLowerCase().replace(/\s+/g, '-');

    const existing = await prisma.category.findUnique({ where: { code: formattedCode } });
    if (existing) {
      return res.status(400).json({ error: 'Category code already exists' });
    }

    const category = await prisma.category.create({
      data: {
        code: formattedCode,
        name: name.trim(),
        description: description ? description.trim() : null,
      },
    });
    res.status(201).json(category);
  } catch (error) {
    res.status(500).json({ error: 'Failed to create category' });
  }
});

app.put('/api/categories/:id', async (req: Request, res: Response) => {
  try {
    const authUser = (req as any).authUser;
    if (!isAdminOrManager(authUser.role)) {
      return res.status(403).json({ error: 'Permission denied. Only Administrators and Managers can manage categories.' });
    }

    const id = req.params.id as string;
    const { name, description } = req.body;
    const updated = await prisma.category.update({
      where: { id },
      data: {
        name: name ? name.trim() : undefined,
        description: description !== undefined ? (description ? description.trim() : null) : undefined,
      },
    });
    res.json(updated);
  } catch (error) {
    res.status(500).json({ error: 'Failed to update category' });
  }
});

app.delete('/api/categories/:id', async (req: Request, res: Response) => {
  try {
    const authUser = (req as any).authUser;
    if (!isAdminOrManager(authUser.role)) {
      return res.status(403).json({ error: 'Permission denied. Only Administrators and Managers can manage categories.' });
    }

    const id = req.params.id as string;
    await prisma.category.delete({ where: { id } });
    res.json({ message: 'Category deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete category' });
  }
});

// ----------------------------------------------------
// USER PREFERENCES
// ----------------------------------------------------
app.get('/api/preferences', async (req: Request, res: Response) => {
  try {
    const authUser = (req as any).authUser;
    if (!authUser || !authUser.id) {
      return res.json({});
    }

    const preferences = await prisma.userPreference.findMany({
      where: { userId: authUser.id },
    });

    const prefObj: Record<string, any> = {};
    for (const p of preferences) {
      try {
        prefObj[p.key] = JSON.parse(p.value);
      } catch {
        prefObj[p.key] = p.value;
      }
    }
    res.json(prefObj);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch user preferences' });
  }
});

app.put('/api/preferences/:key', async (req: Request, res: Response) => {
  try {
    const authUser = (req as any).authUser;
    if (!authUser || !authUser.id) {
      return res.status(400).json({ error: 'Valid user session required' });
    }

    const key = req.params.key as string;
    const valueStr = typeof req.body.value === 'string' ? req.body.value : JSON.stringify(req.body.value);

    const preference = await prisma.userPreference.upsert({
      where: {
        userId_key: {
          userId: authUser.id,
          key,
        },
      },
      update: {
        value: valueStr,
      },
      create: {
        userId: authUser.id,
        key,
        value: valueStr,
      },
    });

    res.json({ key: preference.key, value: req.body.value });
  } catch (error) {
    console.error('Error saving preference:', error);
    res.status(500).json({ error: 'Failed to save user preference' });
  }
});

app.listen(PORT, async () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  if (process.env.ENABLE_SEED === 'true') {
    try {
      console.log('🌱 ENABLE_SEED=true detected. Running seed...');
      await seed();
    } catch (e) {
      console.error('Error during auto-seed:', e);
    }
  } else {
    console.log('ℹ️ Auto-seed skipped (ENABLE_SEED is not true). Database data preserved.');
  }
});
