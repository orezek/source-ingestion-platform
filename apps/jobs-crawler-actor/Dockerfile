# syntax=docker/dockerfile:1.4

# ==============================================================================
# STAGE 1: Base
# Use node:20-slim (Debian) instead of Alpine to match the OS of the
# Apify runner. This prevents "GLIBC_NOT_FOUND" errors for native modules.
# ==============================================================================
FROM node:20-slim AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable && corepack prepare pnpm@latest --activate

# ==============================================================================
# STAGE 2: Pruner
# Creates a pruned, partial monorepo for the target application.
# ==============================================================================
FROM base AS pruner
WORKDIR /app
RUN pnpm add --global turbo
# This is relative to where the docker build context is defined!
COPY . .


ARG APP_NAME=jobs-crawler-actor
RUN turbo prune --scope=${APP_NAME} --docker

# ==============================================================================
# STAGE 3: Installer
# Installs dependencies in a dedicated layer.
# ==============================================================================
FROM base AS installer
WORKDIR /app

# Copy lockfile and package.jsons from pruner
COPY --from=pruner /app/out/json/ .
COPY --from=pruner /app/out/pnpm-lock.yaml .
COPY --from=pruner /app/out/pnpm-workspace.yaml .

# Install dependencies (including dev deps for building)
# We need to install Playwright browsers? No, only the node packages.
# The binaries are in the final image.
#RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile --ignore-scripts
RUN pnpm install --frozen-lockfile --ignore-scripts
# ==============================================================================
# STAGE 4: Builder
# Builds the application source code.
# ==============================================================================
FROM installer AS builder
WORKDIR /app
ARG APP_NAME=jobs-crawler-actor

# Copy full source code from pruner
COPY --from=pruner /app/out/full/ .

# Run your build command (Adjust if you use different build scripts)
RUN pnpm run build --filter ${APP_NAME}

# ==============================================================================
# STAGE 5: Runner (Final Apify Production Image)
# ==============================================================================
# ⚠️ CRITICAL: Must use the Apify image to get Chrome/Playwright binaries + XVFB
FROM apify/actor-node-playwright-chrome:20 AS runner
WORKDIR /app
ARG APP_NAME=jobs-crawler-actor

# 1. Enable pnpm in the Apify image (it's not there by default)
USER root
RUN corepack enable && corepack prepare pnpm@latest --activate && chown -R myuser:myuser /app

# 2. Switch back to 'myuser' (Apify's default non-root user)
# We do NOT use 'nodejs' user here because Apify's permissions are tied to 'myuser'
USER myuser

# 3. Copy workspace definitions
COPY --from=pruner --chown=myuser:myuser /app/out/json/ .
COPY --from=pruner --chown=myuser:myuser /app/out/pnpm-lock.yaml .
COPY --from=pruner --chown=myuser:myuser /app/out/pnpm-workspace.yaml .

# 4. Install ONLY production dependencies
# This ensures that standard 'dependencies' (like crawlee) are present,
# but 'devDependencies' (like typescript/eslint) are skipped.
#RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --prod --frozen-lockfile --ignore-scripts
RUN pnpm install --prod --frozen-lockfile --ignore-scripts
# 5. Copy built artifacts from Builder
# We copy the 'packages' folder just in case your app relies on local workspace packages
COPY --from=builder --chown=myuser:myuser /app/packages ./packages
# Copy the specific app distribution
COPY --from=builder --chown=myuser:myuser /app/apps/${APP_NAME}/dist ./apps/${APP_NAME}/dist
# Copy any generated files if needed (e.g. Prisma client)
# COPY --from=builder --chown=myuser:myuser /app/apps/${APP_NAME}/generated ./apps/${APP_NAME}/generated

# 6. Final Configuration
ENV NODE_ENV=production
ENV CRAWLEE_LOG_LEVEL=INFO
# We set the workdir to the specific app so 'node dist/main.js' works relatively
#WORKDIR /app/apps/${APP_NAME}
CMD ["node", "apps/jobs-crawler-actor/dist/main.js"]
