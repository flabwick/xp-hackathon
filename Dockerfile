FROM node:20-bookworm-slim

# Install Python 3 for the PDF chapter-splitter script
RUN apt-get update && apt-get install -y \
    python3 python3-pip python3-venv \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Python deps in a venv (avoids Debian's "externally managed" restriction)
COPY requirements.txt ./
RUN python3 -m venv /opt/venv \
    && /opt/venv/bin/pip install --no-cache-dir -r requirements.txt
ENV PATH="/opt/venv/bin:$PATH"

# Node deps (production only)
COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

EXPOSE 6969
CMD ["node", "server.js"]
