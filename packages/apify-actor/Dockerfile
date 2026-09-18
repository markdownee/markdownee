# syntax=docker/dockerfile:1.7
# Built from the public markdownee mirror, whose repo root IS the engine
# workspace root (dockerContextDir "../../.."). `trafilaturacore` is an ordinary
# published npm dependency here, so `pnpm install` fetches it: no sibling engine,
# and no Rust toolchain anywhere in this image.

FROM apify/actor-node-playwright:24 AS builder

USER root
ENV NODE_ENV=development
WORKDIR /repo

# Copy workspace + package manifests for layer-cache efficiency.
COPY pnpm-workspace.yaml package.json .npmrc ./
# The licence-clean replacement for launder is a `file:` override target in package.json,
# so it must exist before install resolves sanitize-html. Registry `launder` declares MIT
# and ships no copyright-and-permission notice in any published release; without this the
# image would redistribute it.
COPY dependency-replacements/ dependency-replacements/
COPY packages/schema/package.json packages/schema/
COPY packages/conversion/package.json packages/conversion/
COPY packages/extraction/package.json packages/extraction/
COPY packages/crawler/package.json packages/crawler/
COPY packages/standalone/package.json packages/standalone/
COPY packages/apify-actor/package.json packages/apify-actor/

RUN corepack enable && pnpm install

# Copy sources needed for the build.
COPY tsconfig.json ./
# The standalone tsup build copies the repo-root NOTICE, LICENSE and
# THIRD-PARTY-NOTICES.txt into its dist (npm attribution); the builder must
# have all three on disk for those copies to succeed.
COPY NOTICE LICENSE THIRD-PARTY-NOTICES.txt ./
COPY packages/schema/ packages/schema/
COPY packages/conversion/ packages/conversion/
COPY packages/extraction/ packages/extraction/
COPY packages/crawler/ packages/crawler/
COPY packages/standalone/ packages/standalone/
COPY packages/apify-actor/ packages/apify-actor/

# Build packages in dependency order, then deploy a self-contained bundle.
RUN pnpm --filter @markdownee/schema build \
    && pnpm --filter @markdownee/conversion build \
    && pnpm --filter @markdownee/extraction build \
    && pnpm --filter @markdownee/crawler build \
    && pnpm --filter @markdownee/markdownee build \
    && pnpm --filter @markdownee/apify build \
    && pnpm install --config.inject-workspace-packages=true \
    && pnpm --filter @markdownee/apify --prod deploy --config.inject-workspace-packages=true /deploy \
    && node -e "const fs=require('fs');const p='/deploy/package.json';const pkg=JSON.parse(fs.readFileSync(p,'utf8'));pkg.type='module';fs.writeFileSync(p,JSON.stringify(pkg,null,2)+String.fromCharCode(10))"

FROM apify/actor-node-playwright:24

WORKDIR /usr/src/app

COPY --chown=myuser:myuser --from=builder /deploy ./
# Third-party license attribution (Ghostery MPL-2.0) plus the Apache-2.0 LICENSE
# text the NOTICE points at ("see LICENSE") and the THIRD-PARTY-NOTICES.txt the
# NOTICE names for the redistributed closure; see repo-root NOTICE.
COPY --chown=myuser:myuser NOTICE LICENSE THIRD-PARTY-NOTICES.txt ./

CMD ["node", "dist/main.js"]
