FROM node:18-alpine

WORKDIR /app

# Copy dependency files
COPY package*.json ./

# Install frontend dependencies
RUN npm install

# Copy source code
COPY . .

# Start the frontend server (serve.js serves static files & acts as reverse proxy)
EXPOSE 3001
CMD ["node", "serve.js"]
