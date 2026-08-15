FROM node:22-bookworm-slim

# System dependencies: ffmpeg (render + subtitles), Python (edge-tts helpers),
# and fonts so ASS subtitles render for Arabic and English.
RUN apt-get update && apt-get install -y --no-install-recommends \
        ffmpeg \
        python3 \
        python3-pip \
        fonts-noto-core \
        fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/*

# TTS + word-timing helper (streams audio and WordBoundary events).
RUN pip3 install --break-system-packages edge-tts

WORKDIR /app

COPY package.json ./
# --ignore-scripts skips the ffmpeg-static download (~70MB); the apt ffmpeg
# above already ships libass for the ASS subtitle filter.
RUN npm install --omit=dev --ignore-scripts

COPY app ./app
COPY public ./public

ENV NODE_ENV=production
ENV PORT=8283

EXPOSE 8283

CMD ["node", "app/server.js"]
