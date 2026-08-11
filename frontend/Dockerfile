# Base stage
FROM node:lts-buster AS build

# Optional Socket.IO origin, baked into the Parcel bundle at build time. Leave it
# empty: nginx.conf proxies both /v1 and /ws, so the bundle talks to its own origin
# and the same image works on any host without a rebuild. Only set it when serving
# the dev stage (npm start), which has no nginx in front of it.
ARG REACT_APP_BACKEND_URL=
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

# Serve the SPA and proxy /v1 -> aLLMa wrapper, /ws -> chat backend
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Expose port
EXPOSE 80
# Start Nginx
CMD ["nginx", "-g", "daemon off;"]
