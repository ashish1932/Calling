FROM node:20-alpine

WORKDIR /app

# Copy dependency files
COPY package*.json ./

# Install backend dependencies
RUN npm install

# Copy source code
COPY . .

# Expose backend port
EXPOSE 5001

CMD ["node", "server.js"]
