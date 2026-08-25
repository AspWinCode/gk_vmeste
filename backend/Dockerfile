# Многоступенчатая сборка: зависимости и компиляция TypeScript отдельно от рантайма,
# чтобы финальный образ не тащил dev-зависимости и исходники.

FROM node:20-alpine AS deps
WORKDIR /app
# Без openssl Prisma не может определить версию libssl при `prisma generate`
# и молча собирает движок под несуществующий openssl-1.1.x (Alpine 3.19+ = OpenSSL 3).
RUN apk add --no-cache openssl
COPY package.json package-lock.json* ./
RUN npm install

FROM deps AS build
WORKDIR /app
COPY . .
RUN npx prisma generate
RUN npm run build

FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN apk add --no-cache openssl
COPY package.json package-lock.json* ./
RUN npm install --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
RUN mkdir -p uploads

EXPOSE 4000
CMD ["node", "dist/index.js"]
