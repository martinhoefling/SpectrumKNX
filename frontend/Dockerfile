FROM node:20-slim

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

# Expose Vite's default dev port
EXPOSE 5173

# Run Vite in host mode so it's accessible outside the container
CMD ["npm", "run", "dev", "--", "--host"]
