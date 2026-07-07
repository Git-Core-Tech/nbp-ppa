# syntax=docker/dockerfile:1.7

# -----------------------------
# Build stage
# -----------------------------
FROM node:24-bookworm-slim AS build

WORKDIR /app

COPY package.json package-lock.json .npmrc ./

RUN --mount=type=secret,id=gh_token \
    export GH_TOKEN="$(cat /run/secrets/gh_token)" && \
    npm ci

COPY nest-cli.json tsconfig.json ./
COPY src ./src

RUN npm run build


# -----------------------------
# Production stage
# -----------------------------
FROM node:24-bookworm-slim AS production

WORKDIR /app

ENV NODE_ENV=production

COPY package.json package-lock.json .npmrc ./

RUN --mount=type=secret,id=gh_token \
    export GH_TOKEN="$(cat /run/secrets/gh_token)" && \
    npm ci --omit=dev && \
    npm cache clean --force && \
    rm -f .npmrc

COPY --from=build --chown=node:node /app/dist ./dist

USER node

EXPOSE 3004

CMD ["node", "dist/main"]
