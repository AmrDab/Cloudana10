# Cloudana MVP Testnet

## Overview

Cloudana is a DePIN (Decentralized Physical Infrastructure Network) compute marketplace prototype running on Base Sepolia testnet. The platform connects compute providers (who offer processing resources) with users (who need compute power for jobs). Users deposit CLD tokens to fund jobs, providers complete work, and the system tracks usage through backend-signed reports that get confirmed on-chain.

The application follows a monorepo structure with a React frontend, Express backend, and PostgreSQL database using Drizzle ORM.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend Architecture
- **Framework**: React 18 with TypeScript
- **Routing**: Wouter (lightweight React router)
- **State Management**: TanStack React Query for server state, React Context for wallet state
- **Styling**: Tailwind CSS v4 with shadcn/ui component library (New York style)
- **Animations**: Framer Motion for UI transitions
- **Web3 Integration**: RainbowKit + wagmi for wallet connection, targeting Base Sepolia network

The frontend lives in `client/src/` with pages in `pages/`, reusable UI components in `components/ui/`, and shared layout in `components/layout/`. Path aliases use `@/` for client source and `@shared/` for shared code.

### Backend Architecture
- **Framework**: Express.js with TypeScript
- **Database**: PostgreSQL with Drizzle ORM
- **API Pattern**: RESTful JSON API under `/api/` prefix
- **Build Tool**: esbuild for server bundling, Vite for client

The server uses a storage abstraction layer (`server/storage.ts`) that wraps all database operations. Routes are registered in `server/routes.ts`. In development, Vite middleware handles hot reloading; in production, static files are served from the build output.

### Data Models
Four main entities defined in `shared/schema.ts`:
1. **Providers** - Compute nodes with address, name, pricing, status, and earnings
2. **Jobs** - User-created compute jobs linking to providers with deposit/spend tracking
3. **Usage Reports** - Records of compute usage with backend signatures for on-chain confirmation
4. **User Credits** - Tracks refund balances for users

### Key Workflows
1. **Provider Registration**: Wallet connects → submits metadata → stored in database
2. **Job Creation**: User selects provider → deposits funds → job tracked in database
3. **Usage Reporting**: Backend signs usage data → user submits transaction on-chain → confirmation stored

## External Dependencies

### Blockchain
- **Network**: Base Sepolia (Chain ID 84532)
- **Wallet Connection**: RainbowKit with WalletConnect (requires `VITE_WALLETCONNECT_PROJECT_ID`)
- **Libraries**: wagmi, viem for Ethereum interactions

### Database
- **PostgreSQL**: Required via `DATABASE_URL` environment variable
- **ORM**: Drizzle with drizzle-kit for migrations (`npm run db:push`)

### Key NPM Packages
- `@rainbow-me/rainbowkit` - Web3 wallet modal
- `@tanstack/react-query` - Data fetching and caching
- `drizzle-orm` / `drizzle-zod` - Database ORM with Zod validation
- `express` - HTTP server
- `framer-motion` - Animations
- `zod` - Runtime type validation