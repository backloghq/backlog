FROM node:25-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --production
COPY dist/ dist/
ENV TASKDATA=/tmp/backlog-data
ENTRYPOINT ["node", "dist/index.js"]
