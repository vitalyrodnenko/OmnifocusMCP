FROM node:20-bookworm-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 python3-venv python3-pip ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*

RUN npm install -g npm@latest \
    && python3 -m pip install --no-cache-dir uv

WORKDIR /workspace

CMD ["bash"]
