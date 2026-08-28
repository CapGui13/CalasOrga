FROM node:24-alpine
WORKDIR /app
COPY server.mjs index.html ./
RUN mkdir -p /app/data && chown -R node:node /app
USER node
ENV PORT=3000 DATA_FILE=/app/data/store.json
EXPOSE 3000
CMD ["node","server.mjs"]
