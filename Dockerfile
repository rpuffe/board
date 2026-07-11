# board — zero-dependency Node.js API + static page, built-ins only.
FROM node:22-alpine

# apk upgrade: official base images lag CVE fixes by days, and the Trivy gate
# fails on fixable HIGH/CRITICAL vulns even in a current image.
RUN apk upgrade --no-cache

# The app has zero npm dependencies but the base image still bundles npm,
# npx, and corepack — each carries its own CVEs, independent of app deps.
# Strip them from the runtime image; nothing at runtime invokes them.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
    && rm -f /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
    && rm -rf /opt/yarn*

WORKDIR /app
COPY server.js ./

# node:22-alpine already ships a non-root "node" user; declare it explicitly
# anyway — Trivy's Dockerfile check (DS002, HIGH) inspects the Dockerfile
# itself, not the base image's runtime user.
USER node

EXPOSE 8080

CMD ["node", "server.js"]
