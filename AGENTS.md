# Agent Configuration

## Project Information

This is a NestJS backend project with TypeScript, Prisma ORM, and Railway deployment.

## Build Commands

- `npm run build` - Build the project
- `npm run lint` - Run ESLint
- `npm run test` - Run Jest tests
- `npm run start:dev` - Start development server with watch mode

## CI/CD Configuration

- CI workflow: `.github/workflows/ci.yml` - Runs lint, test, and build on PRs
- CD workflow: `.github/workflows/cd.yml` - Deploys to Railway on merge to main
- Branch protection: Main branch requires PR approval from code owner and passing CI checks
- CODEOWNERS: `.github/CODEOWNERS` - Requires @Maycon-Rodrigues approval for all changes

## GitHub Repository

- Owner: ChatPay-Go-Labs-Oficial
- Repository: smartpig-backend
- Main branch is protected with branch rules

## Deployment

- Platform: Railway
- Config: `railway.toml`
- Health check: `/health` path with 60s timeout
