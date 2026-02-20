FROM node:18-alpine AS builder

WORKDIR /app

# Copiar package files
COPY package*.json ./

# Instalar dependências
RUN npm ci

# Copiar código
COPY . .

# Build (opcional, para produção)
# RUN npm run build

# ==============================================================================
# Runtime Stage (Development)
# ==============================================================================
FROM node:18-alpine

WORKDIR /app

# Copiar node_modules do builder
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package*.json ./

# Copiar código
COPY . .

# Expor porta
EXPOSE 3000

# Instalar react-scripts globalmente
RUN npm install -g react-scripts

# Comando para desenvolvimento
CMD ["npm", "start"]
