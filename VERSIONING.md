# Server Versioning & Release Procedure

This backend repository follows [Semantic Versioning (SemVer)](https://semver.org/) and implements automated version bumping, changelog generation, tagging, and Render deployment via GitHub Actions on Pull Request merges.

---

## 1. Semantic Versioning Format (`MAJOR.MINOR.PATCH`)

- **`MAJOR`** (`1.0.0` $\rightarrow$ `2.0.0`): Breaking database schema changes, breaking API contract changes.
- **`MINOR`** (`1.0.0` $\rightarrow$ `1.1.0`): New API endpoints, non-breaking features, backwards-compatible schema additions.
- **`PATCH`** (`1.0.0` $\rightarrow$ `1.0.1`): Bug fixes, performance optimizations, query adjustments, minor dependency updates.

---

## 2. Automated PR-Driven Version Bumping on GitHub

Whenever a Pull Request is merged into `main`, the **Bump Version on PR Merge** workflow automatically runs:

1. **Determines the version bump type**:
   - **PR Labels (Explicit Override)**:
     - `release:major` or `major` $\rightarrow$ Major version bump.
     - `release:minor` or `minor` $\rightarrow$ Minor version bump.
     - `release:patch` or `patch` $\rightarrow$ Patch version bump.
     - `no-release` or `skip-release` $\rightarrow$ Skips version bumping.
   - **PR Title & Conventional Commits (Default fallback)**:
     - Contains `BREAKING CHANGE` or `!:` $\rightarrow$ **Major** bump.
     - Starts with `feat:` or `feat(...):` $\rightarrow$ **Minor** bump.
     - Starts with `fix:`, `refactor:`, `perf:`, `chore:`, etc. $\rightarrow$ **Patch** bump.

2. **Automated Release Execution**:
   - Increments version in `package.json` and `package-lock.json`.
   - Prepends release notes to `CHANGELOG.md` with PR title, number, and author.
   - Commits changes with `chore(release): vX.Y.Z`.
   - Creates and pushes Git tag `vX.Y.Z`.
   - Publishes a GitHub Release with formatted release notes.
   - The push to `main` triggers the **Deploy Backend to Render** workflow (`deploy.yml`).

---

## 3. Server Health & Version Monitoring

The server exposes version, uptime, and timestamp on the `/health` endpoint:
```json
{
  "status": "ok",
  "version": "1.0.0",
  "uptime": 124.5,
  "timestamp": "2026-09-02T11:43:04.000Z"
}
```

---

## 4. Manual / Local Releases (Optional)

If you ever need to manually cut a release locally:

```bash
npm run release:patch   # e.g., 1.0.0 -> 1.0.1
npm run release:minor   # e.g., 1.0.0 -> 1.1.0
npm run release:major   # e.g., 1.0.0 -> 2.0.0
```
Or trigger the workflow manually in GitHub under **Actions > Bump Version on PR Merge > Run workflow**.
