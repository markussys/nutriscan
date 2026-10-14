FROM nginx:1.27-alpine

# Self-signed certificate so the camera works when you open the app
# from your phone over Wi-Fi (browsers only allow camera access over HTTPS).
RUN apk add --no-cache openssl \
 && mkdir -p /etc/nginx/certs \
 && openssl req -x509 -nodes -newkey rsa:2048 -days 825 \
      -keyout /etc/nginx/certs/key.pem -out /etc/nginx/certs/cert.pem \
      -subj "/CN=nutriscan.local"

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY public/ /usr/share/nginx/html/

EXPOSE 80 443
