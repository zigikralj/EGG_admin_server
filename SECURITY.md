# Security Policy

## Supported Versions

Only the latest version on the `main` branch is actively supported with security updates.

| Version | Supported          |
| ------- | ------------------ |
| 1.0.x   | :white_check_mark: |
| < 1.0   | :x:                |

## Reporting a Vulnerability

If you discover a security vulnerability within this project, please **do not** open a public issue.

Instead, please send an email or private report detailing:
1. Description of the vulnerability.
2. Steps to reproduce the issue.
3. Potential impact.

We take security seriously and will respond promptly to investigate and address any reported security issues.

## Environment Variables & Secret Hygiene

- **Never commit `.env` or secrets** into git history.
- Always use `server/.env.example` as a template for local development setup.
- All secrets in production must be passed securely via server environment configuration (e.g. Render dashboard environment variables).
