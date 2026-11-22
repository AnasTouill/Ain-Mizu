FROM node:20-alpine
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --no-fund --no-audit
COPY . .
ENV VITE_HOST=0.0.0.0 VITE_API_TARGET=http://backend:8000
EXPOSE 5173
CMD ["npm", "run", "dev"]
