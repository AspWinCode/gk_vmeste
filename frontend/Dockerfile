# Собирается с контекстом == корень репозитория (см. docker-compose.prod.yml),
# т.к. нужен доступ и к frontend/, и к соседней nginx/default.conf.
FROM nginx:1.27-alpine
COPY frontend/ /usr/share/nginx/html
COPY nginx/default.conf /etc/nginx/conf.d/default.conf
