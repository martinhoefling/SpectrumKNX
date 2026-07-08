FROM python:3.14-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

ENV BIND_HOST=0.0.0.0
ENV BIND_PORT=8000

# `exec` keeps uvicorn as PID 1 so it receives signals for graceful shutdown;
# the shell form lets BIND_HOST/BIND_PORT expand.
CMD ["sh", "-c", "exec uvicorn main:app --host \"$BIND_HOST\" --port \"$BIND_PORT\""]
