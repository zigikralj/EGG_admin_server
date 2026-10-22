import express from 'express';
import cors from 'cors';
import compression from 'compression';
import { errorHandler } from './middleware/errorHandler';

// Route imports
import rolesRoutes from './routes/roles.routes';
import authRoutes from './routes/auth.routes';
import usersRoutes from './routes/users.routes';
import activityLogRoutes from './routes/activityLog.routes';
import projectsRoutes from './routes/projects.routes';
import remindersRoutes from './routes/reminders.routes';
import clientsRoutes from './routes/clients.routes';
import servicesRoutes from './routes/services.routes';
import categoriesRoutes from './routes/categories.routes';
import invoicesRoutes from './routes/invoices.routes';
import providedServicesRoutes from './routes/providedServices.routes';
import preferencesRoutes from './routes/preferences.routes';
import companyInfoRoutes from './routes/companyInfo.routes';
import statsRoutes from './routes/stats.routes';
import notificationsRoutes from './routes/notifications.routes';
import permitsRoutes from './routes/permits.routes';
import wasteCatalogRoutes from './routes/wasteCatalog.routes';
import historyRoutes from './routes/history.routes';

// Import rate limiters (currently defined in index.ts or authUtils, let's assume we need to import or recreate them)
import rateLimit from 'express-rate-limit';

import { API_ROUTES } from './constants/apiRoutes';

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: 'Too many requests, please try again later.' },
});

const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1000,
});

export function createApp() {
  const app = express();

  // Middleware
  app.use(cors());
  app.use(compression({ threshold: 1024 }));
  
  // Override for import endpoints (applied before the import route handlers)
  app.use(API_ROUTES.IMPORT, express.json({ limit: '10mb' })); 
  
  // Default for all other routes
  app.use(express.json({ limit: '1mb' })); 

  app.use(globalLimiter);

  // Health check
  app.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      version: process.env.npm_package_version || '1.0.0',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    });
  });

  app.get('/', (_req, res) => {
    res.json({ message: 'Project Tracker API is running' });
  });

  // Apply stricter rate limits to auth
  app.use(API_ROUTES.AUTH.LOGIN, authLimiter);
  app.use(API_ROUTES.AUTH.REGISTER, authLimiter);

  // Mount routes
  app.use(API_ROUTES.ROLES, rolesRoutes);
  app.use(API_ROUTES.AUTH.BASE, authRoutes);
  app.use(API_ROUTES.USERS, usersRoutes);
  app.use(API_ROUTES.ACTIVITY_LOGS.BASE, activityLogRoutes);
  app.use(API_ROUTES.PROJECTS.STATS, statsRoutes);
  app.use(API_ROUTES.PROJECTS.BASE, projectsRoutes);
  app.use(API_ROUTES.REMINDERS, remindersRoutes);
  app.use(API_ROUTES.CLIENTS, clientsRoutes);
  app.use(API_ROUTES.SERVICES, servicesRoutes);
  app.use(API_ROUTES.CATEGORIES, categoriesRoutes);
  app.use(API_ROUTES.INVOICES, invoicesRoutes);
  app.use(API_ROUTES.PROVIDED_SERVICES, providedServicesRoutes);
  app.use(API_ROUTES.PREFERENCES, preferencesRoutes);
  app.use(API_ROUTES.COMPANY_INFO, companyInfoRoutes);
  app.use(API_ROUTES.NOTIFICATIONS, notificationsRoutes);
  app.use(API_ROUTES.PERMITS, permitsRoutes);
  app.use(API_ROUTES.WASTE_CATALOG, wasteCatalogRoutes);
  app.use(API_ROUTES.HISTORY, historyRoutes);

  // Handle undefined routes
  app.use((req, res) => {
    res.status(404).json({ error: `Route ${req.originalUrl} not found` });
  });

  // Global Error Handler
  app.use(errorHandler);

  return app;
}
