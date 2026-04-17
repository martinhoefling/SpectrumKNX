# Stage 1: Build the frontend
FROM node:18-alpine AS frontend-builder
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm install
COPY frontend/ ./
RUN npm run build

# Stage 2: Serve with Python
FROM python:3.11-slim
WORKDIR /app

# Install system dependencies if needed (e.g. for xknx)
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Install python dependencies
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy backend source
COPY backend/ .

# Copy built frontend from Stage 1 into the backend's static directory
COPY --from=frontend-builder /app/frontend/dist ./static

# Expose port
EXPOSE 8000

# Environment variables
ENV DATABASE_URL=postgresql://postgres:postgres@localhost:5432/knx
ENV KNX_PROJECT_PATH=/app/project.knxproj
ENV LOG_LEVEL=INFO

# Command to run the application
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
