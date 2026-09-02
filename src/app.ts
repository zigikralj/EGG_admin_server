import express from 'express';
import cors from 'cors';
import { errorHandler } from './middleware/errorHandler';

// Route imports
import authRoutes from './routes/auth.routes';
import usersRoutes from './routes/users.routes';
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

// Import rate limiters (currently defined in index.ts or authUtils, let's assume we need to import or recreate them)
import rateLimit from 'express-rate-limit';

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
  
  // Override for import endpoints (applied before the import route handlers)
  app.use('/api/import', express.json({ limit: '10mb' })); 
  
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
  app.use('/api/auth/login', authLimiter);
  app.use('/api/auth/register', authLimiter);

  // Mount routes
  app.use('/api/auth', authRoutes);
  app.use('/api/users', usersRoutes);
  app.use('/api/projects/stats', statsRoutes);
  app.use('/api/projects', projectsRoutes);
  app.use('/api/reminders', remindersRoutes);
  app.use('/api/clients', clientsRoutes);
  app.use('/api/services', servicesRoutes);
  app.use('/api/categories', categoriesRoutes);
  app.use('/api/invoices', invoicesRoutes);
  app.use('/api/provided-services', providedServicesRoutes);
  app.use('/api/preferences', preferencesRoutes);
  app.use('/api/company-info', companyInfoRoutes);
  app.use('/api/notifications', notificationsRoutes);

  // Handle undefined routes
  app.use((req, res) => {
    res.status(404).json({ error: `Route ${req.originalUrl} not found` });
  });

  // Global Error Handler
  app.use(errorHandler);

  return app;
}
