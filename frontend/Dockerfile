# Base stage
FROM node:lts-buster AS build

# Backend URL baked into Parcel bundle at build time
ARG REACT_APP_BACKEND_URL=http://localhost:8000
ENV REACT_APP_BACKEND_URL=${REACT_APP_BACKEND_URL}

# Set working directory
WORKDIR /usr/src/app

# Copy package files
COPY package*.json ./
COPY . /usr/src/app
# Install dependencies
RUN npm install --include=dev

RUN npm run build

# Development stage
FROM build AS development
RUN echo "development stage"
EXPOSE 1234
CMD ["npm", "start"]

# Production stage
FROM nginx:alpine AS production
RUN echo "production stage"

# Copy built files to Nginx web root
COPY --from=build /usr/src/app/dist /usr/share/nginx/html

# Expose port
EXPOSE 80
# Start Nginx
CMD ["nginx", "-g", "daemon off;"]
