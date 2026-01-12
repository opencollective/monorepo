# Open Collective Architecture & Technical Stacks

## Overview

Open Collective is a platform for transparent fundraising and financial management for open source projects and communities. The platform is built using a microservices architecture with multiple specialized services communicating via GraphQL and REST APIs.

## Architecture

The platform follows a **microservices architecture** with the following component relationships:

The **opencollective-frontend** (Next.js/React web application) serves as the primary user interface. It communicates with backend services via GraphQL and REST APIs. The frontend connects to multiple backend services:

- **opencollective-api**: The main GraphQL API service that handles business logic and data persistence. This is the primary backend service.
- **opencollective-rest**: A REST API service that wraps the GraphQL API for legacy integrations.
- **opencollective-pdf**: A dedicated service for PDF document generation.
- **opencollective-images**: A service for image processing and optimization.

The API connects to **PostgreSQL** as the primary database. The API service also uses **Redis** for session management and caching.

## Core Services

### 1. **opencollective-api** (Main Backend API)
The primary GraphQL API service that handles all business logic, data persistence, and integrations.

**Tech Stack:**
- **Runtime**: Node.js
- **Framework**: Express
- **API**: GraphQL (Apollo Server) with two schema versions: V1 (legacy) and V2 (modern)
- **ORM**: Sequelize
- **Database**: PostgreSQL
- **Language**: TypeScript with Babel for transpilation
- **Session Management**: Redis (connect-redis)
- **Authentication**: Passport.js, JWT, WebAuthn
- **Payment Providers**: Stripe, PayPal, Wise, Manual
- **Email**: Nodemailer with Handlebars templates
- **File Storage**: AWS S3 (or MinIO for local dev)
- **Search**: OpenSearch (in private alpha state, production is still using Postgres full text search)
- **Monitoring**: Sentry, Hyperwatch
- **Security**: Helmet, GraphQL Armor
- **Testing**: Mocha, Sinon, Chai

**Key Features:**
- GraphQL API
- Payment processing and webhooks
- Email notifications
- File uploads and image processing
- OAuth2 server implementation
- Cron jobs for scheduled tasks

### 2. **opencollective-frontend** (Main Web Application)
The user-facing web application built with Next.js and React.

**Tech Stack:**
- **Framework**: Next.js
- **UI Library**: React
- **Language**: TypeScript
- **Styling**: 
  - Tailwind CSS (primary, utility-first)
  - Styled Components / Styled System (legacy, being migrated to tailwind)
- **UI Components**: Radix UI (headless components)
- **Icons**: Lucide React (mostly), Styled Icons (legacy)
- **State Management**: Apollo Client (GraphQL)
- **Forms**: Formik
- **Internationalization**: React Intl
- **Charts**: ApexCharts
- **Animations**: Framer Motion
- **Testing**: Jest, React Testing Library, Cypress (E2E)
- **Build**: Webpack, Babel

### 3. **opencollective-rest** (REST API Service)
A REST API wrapper around the GraphQL API for legacy integrations and simpler HTTP endpoints.

**Tech Stack:**
- **Runtime**: Node.js
- **Framework**: Express
- **Language**: TypeScript
- **GraphQL Client**: Apollo Client (queries main GraphQL API)
- **Build**: Babel

### 4. **opencollective-pdf** (PDF Generation Service)
A microservice dedicated to generating PDF documents (receipts, invoices, reports).

**Tech Stack:**
- **Runtime**: Node.js
- **Framework**: Express
- **Language**: TypeScript (ES modules)
- **PDF Generation**: React PDF (@react-pdf/renderer)
- **Testing**: Vitest
- **GraphQL Client**: Apollo Client

### 5. **opencollective-taxes** (Tax Calculation Library)
A shared library for calculating taxes, VAT, and related financial computations.

**Tech Stack:**
- **Language**: TypeScript
- **Libraries**: 
  - jsvat-next (VAT validation)
  - sales-tax (tax calculations)
- **Testing**: Jest

### 6. **opencollective-images** (Image Processing Service)
Service for image upload, processing, and optimization.

**Tech Stack:**
- Image processing and optimization
- Integration with S3/MinIO storage

### 7. **opencollective-tools** (Utility Tools)
Collection of utility scripts and tools for maintenance and operations. Ignore this repository.

### 8. **opencollective-watch** (Monitoring Service)
Service for monitoring and observability. Ignore this repository.

## Infrastructure & DevOps

- **Containerization**: Docker, Docker Compose
- **Deployment**: Heroku (staging & production)
- **CI/CD**: GitHub Actions
- **Database**: PostgreSQL 14+ (primary), Redis (caching/sessions)
- **Storage**: AWS S3 (production), MinIO (local development)
- **Email**: Mailpit (local dev), production email service
- **Search**: OpenSearch
- **Monitoring**: Sentry, OpenTelemetry, Hyperwatch
