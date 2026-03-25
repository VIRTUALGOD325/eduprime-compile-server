FROM node:20-bookworm-slim

WORKDIR /app

# Install arduino-cli
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && ARCH=$(dpkg --print-architecture) \
    && if [ "$ARCH" = "arm64" ]; then \
         curl -fsSL https://github.com/arduino/arduino-cli/releases/download/v1.4.1/arduino-cli_1.4.1_Linux_ARM64.tar.gz | tar -xz -C /usr/local/bin arduino-cli; \
       else \
         curl -fsSL https://github.com/arduino/arduino-cli/releases/download/v1.4.1/arduino-cli_1.4.1_Linux_64bit.tar.gz | tar -xz -C /usr/local/bin arduino-cli; \
       fi

# Pre-install Arduino AVR core + common libraries at build time (faster cold starts)
RUN arduino-cli core install arduino:avr \
    && arduino-cli lib install "IRremote@2.6.0" "Servo" "DHT sensor library" "Adafruit NeoPixel"

COPY package*.json ./
RUN npm install --production

COPY . .

ENV PORT=3100
EXPOSE 3100

CMD ["node", "server.js"]
