# Node.js 20 LTS
FROM node:20-alpine

WORKDIR /app

# Install system deps for sharp, pdf2pic, etc.
RUN apk add --no-cache \
    bash \
    libc6-compat \
    vips \
    graphicsmagick \
    imagemagick \
    ghostscript \
    tesseract-ocr \
    openssl

COPY package*.json ./

# Prisma schema is needed during `npm install` because `postinstall` runs `prisma generate`.
COPY prisma ./prisma

# Ensure postinstall helpers (scripts/postinstall.js) are present during `npm ci`.
# The postinstall script runs `prisma generate` and may also run other binaries.
COPY scripts ./scripts

RUN npm ci --omit=dev

COPY . .

# Build Next.js admin UI (static export) so `/setting` etc include latest features.
RUN cd admin-ui; npm ci; npm run build

ENV NODE_ENV=production

# Expose default port
EXPOSE 4000

CMD ["npm", "run", "start:prod"]
