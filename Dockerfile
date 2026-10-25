# App image for running on this computer (see compose.yaml). Data lives in a mounted /data directory,
# never in the image. Without personal.local.ts the build creates an empty stub.
# Debian rather than Alpine: the local speech-to-text runtime (onnxruntime) needs glibc.
FROM node:22-bookworm-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1 \
    ONNXRUNTIME_NODE_INSTALL_CUDA=skip
COPY package.json package-lock.json ./
COPY scripts ./scripts
RUN npm ci
COPY . .
RUN mkdir -p public && NEXT_OUTPUT=standalone npm run build
# The speech-to-text runtime is loaded at run time, so the build does not trace it: copy it with only this machine's binaries.
RUN mkdir -p /ort && cp -r node_modules/onnxruntime-node /ort/ \
    && arch=$(node -p process.arch) \
    && find /ort/onnxruntime-node/bin/napi-v6 -mindepth 2 -maxdepth 2 ! -path "*/linux/$arch" -exec rm -rf {} + \
    && rm -f /ort/onnxruntime-node/bin/napi-v6/linux/*/libonnxruntime_providers_cuda.so /ort/onnxruntime-node/bin/napi-v6/linux/*/libonnxruntime_providers_tensorrt.so

FROM node:22-bookworm-slim
WORKDIR /app
# ffmpeg decodes recordings (m4a, mp3, …) for local speech-to-text.
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000 \
    HEALTH_DATA_DIR=/data
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
COPY --from=build /ort/onnxruntime-node ./node_modules/onnxruntime-node
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 3000
CMD ["node", "server.js"]
