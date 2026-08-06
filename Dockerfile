# syntax=docker/dockerfile:1

# Fem-ho (docs/12 §1).
#
# Multi-etapa: una que compila i una final que només porta el runtime i els artefactes.
# Els requisits que NO es negocien:
#
#   - Usuari no root.
#   - PID 1 que rep SIGTERM i tanca net. Amb SQLite, un tall brusc és arriscat.
#   - Healthcheck a /healthz.
#   - Multi-arquitectura amd64 i arm64. Molta gent ho posarà en un ARM petit.
#   - Sense compiladors ni eines de construcció a la imatge final.

# --------------------------------------------------------------------- construcció
FROM node:22-bookworm-slim AS build

# `better-sqlite3` i `@node-rs/argon2` porten binaris precompilats per a amd64 i arm64,
# però si no n'hi ha per a la plataforma cal poder-los compilar. Aquestes eines es
# queden AQUÍ i no arriben a la imatge final.
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /src

# Primer els manifestos i el lockfile: així la capa de dependències es reaprofita mentre
# no canviïn, que és el 95% de les construccions.
COPY package.json package-lock.json ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY packages/contracts/package.json packages/contracts/
COPY packages/design-system/package.json packages/design-system/

RUN npm ci

COPY . .

RUN npm run build --workspace @fem-ho/contracts \
    && npm run build --workspace @fem-ho/web \
    && npm run build --workspace @fem-ho/server

# Es reinstal·len només les de producció: les de desenvolupament no han d'anar a la
# imatge final ni per mida ni per superfície d'atac.
RUN npm ci --omit=dev

# ------------------------------------------------------------------------- runtime
FROM node:22-bookworm-slim AS runtime

# `tini` com a PID 1: Node no reparteix senyals als fills ni recull processos zombis,
# i sense això cada reinici del contenidor és un tall brusc (docs/12 §1).
RUN apt-get update \
    && apt-get install -y --no-install-recommends tini ca-certificates \
    && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    FEMHO_DATA_DIR=/data \
    FEMHO_DATABASE_URL=sqlite:///data/femho.db

WORKDIR /app

COPY --from=build /src/node_modules ./node_modules
COPY --from=build /src/package.json ./package.json
COPY --from=build /src/apps/server/dist ./apps/server/dist
COPY --from=build /src/apps/server/package.json ./apps/server/package.json
COPY --from=build /src/apps/server/node_modules ./apps/server/node_modules
COPY --from=build /src/apps/web/dist ./apps/web/dist
COPY --from=build /src/packages ./packages

# El volum el crea el runtime i l'ha de poder escriure l'usuari sense privilegis. El
# `node` ja ve a la imatge base amb uid 1000.
RUN mkdir -p /data && chown -R node:node /data /app

USER node

EXPOSE 8080 8081

# El healthcheck apunta a /healthz i NO a /readyz: /healthz diu si el procés és viu,
# que és el que Docker ha de saber per reiniciar-lo. /readyz mira la base de dades, i
# una base momentàniament ocupada no és motiu per matar el contenidor (docs/12 §8).
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:8080/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "apps/server/dist/index.js"]
