# Ekos Project Tracker API Server

Backend API server for Ekos Green Group Project Tracker built with Express, TypeScript, and Prisma.

## Local Development

1. Install dependencies:
   ```bash
   npm install
   ```

2. Run database migrations (requires PostgreSQL running locally, e.g. via Docker or Podman):
   ```bash
   npm run migrate:deploy
   ```

   To create a new migration after editing `prisma/schema.prisma`:
   ```bash
   npm run migrate:dev -- --name <migration_name>
   ```

3. Start development server:
   ```bash
   npm run dev
   ```

4. Build for production:
   ```bash
   npm run build
   ```

---

## Deployment to Render

This repository includes continuous deployment setup for [Render](https://render.com) using GitHub Actions.

### Render Setup (Blueprint or Web Service)

1. Log into your [Render Dashboard](https://dashboard.render.com/).
2. Click **New** -> **Blueprint** (or **Web Service**).
3. Connect your GitHub repository (`EGG_admin_server`).
4. Render will auto-detect `render.yaml` with the following configuration:
   - **Environment**: `Node`
   - **Build Command**: `npm install && npm run build`
   - **Start Command**: `npx prisma migrate deploy && node dist/index.js`
   - **Health Check Path**: `/health`
5. In Render Web Service settings, set the environment variable:
   - `DATABASE_URL`: Your production PostgreSQL database connection string.

### GitHub Actions Setup

1. In Render Web Service settings for your API, copy the **Deploy Hook URL** (found under Settings -> Deploy Hook).
2. In your GitHub repository (`EGG_admin_server`):
   - Go to **Settings** -> **Secrets and variables** -> **Actions**.
   - Click **New repository secret**.
   - Name: `RENDER_DEPLOY_HOOK_URL`
   - Value: Paste the Deploy Hook URL copied from Render.
3. Every push to the `main` branch will automatically validate the TypeScript build and trigger a fresh deployment on Render.
