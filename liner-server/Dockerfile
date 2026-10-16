FROM node:20-alpine

RUN apk add --no-cache python3 py3-pip ffmpeg curl bash && \
    curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp && \
    chmod a+rx /usr/local/bin/yt-dlp

WORKDIR /app

COPY package.json ./
RUN npm install --production

COPY server.js ./

EXPOSE 3000

ENV PORT=3000
ENV NODE_ENV=production

CMD ["node", "server.js"]
