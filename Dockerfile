FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build && test -s dist/index.html

# Only the compiled web interface is served. Firebase runs the CRM API and jobs.
FROM nginx:stable-alpine
COPY deploy/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist/ /usr/share/nginx/html/
RUN nginx -t
EXPOSE 3000
CMD ["nginx", "-g", "daemon off;"]
