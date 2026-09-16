FROM nginx:alpine

COPY index.html /usr/share/nginx/html/index.html
COPY widget.js  /usr/share/nginx/html/widget.js
COPY reset.css  /usr/share/nginx/html/reset.css
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
