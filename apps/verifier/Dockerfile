FROM node:22-alpine AS builder
WORKDIR /app

RUN npm install -g pnpm

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY packages/eslint-config/package.json packages/eslint-config/
COPY apps/verifier/package.json apps/verifier/

RUN pnpm install --frozen-lockfile

COPY packages/eslint-config/ packages/eslint-config/
COPY apps/verifier/ apps/verifier/
COPY tsconfig.json ./

RUN pnpm --filter @hashid/verifier build

FROM node:22-alpine AS runner
WORKDIR /app

RUN npm install -g pnpm

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/eslint-config/package.json packages/eslint-config/
COPY apps/verifier/package.json apps/verifier/

RUN pnpm install --frozen-lockfile --prod

COPY --from=builder /app/apps/verifier/dist apps/verifier/dist

ENV NODE_ENV=production
CMD ["node", "apps/verifier/dist/index.js"]
