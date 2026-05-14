FROM node:20.19.2-alpine@sha256:dd75a9e8995e7f9d83f64af16d07c1edbc97139b08246ed8cb7f5ea1d28c726d AS builder
WORKDIR /app
ENV GENERATE_SOURCEMAP=false
ENV NODE_OPTIONS=--max-old-space-size=768
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:1.27.5-alpine@sha256:62223d644fa234c3a1cc785ee14242ec47a77364226f1c811d2f669f96dc2ac8
COPY --from=builder /app/build /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
