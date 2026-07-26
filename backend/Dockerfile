FROM python:3.14-slim

WORKDIR /app

# git is required at build time: on newer Python versions some dependencies
# have no prebuilt wheels and pip builds them from source, invoking git.
RUN apt-get update && \
    apt-get install -y --no-install-recommends git && \
    rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

ENV BIND_HOST=0.0.0.0
ENV BIND_PORT=8765

# `exec` keeps uvicorn as PID 1 so it receives signals for graceful shutdown;
# the shell form lets BIND_HOST/BIND_PORT expand.
CMD ["sh", "-c", "exec uvicorn main:app --host \"$BIND_HOST\" --port \"$BIND_PORT\""]
