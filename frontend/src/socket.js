import { io } from "socket.io-client";

// Same origin by default: nginx.conf proxies /ws to the chat backend, so the bundle
// is host-agnostic and needs no rebuild per deployment. REACT_APP_BACKEND_URL stays
// as an override for the dev stage (npm start), which has no nginx in front of it.
const baseUrl = process.env.REACT_APP_BACKEND_URL || window.location.origin;

export const socket = io(baseUrl, {
  path: "/ws",
  transports: ["websocket"],
  autoConnect: false
});
