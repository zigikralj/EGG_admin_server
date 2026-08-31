import dotenv from 'dotenv';
dotenv.config();

import { createApp } from './app';
import { prisma } from './db';

const PORT = process.env.PORT || 3001;

async function startServer() {
  try {
    const app = createApp();

    const server = app.listen(PORT, () => {
      console.log(`🚀 Server running on port ${PORT}`);
    });

    // Graceful shutdown handling
    const gracefulShutdown = async () => {
      console.log('Shutting down server gracefully...');
      server.close(async () => {
        console.log('HTTP server closed.');
        await prisma.$disconnect();
        console.log('Prisma disconnected.');
        process.exit(0);
      });
    };

    process.on('SIGTERM', gracefulShutdown);
    process.on('SIGINT', gracefulShutdown);

  } catch (error) {
    console.error('Failed to start server:', error);
    await prisma.$disconnect();
    process.exit(1);
  }
}

startServer();
