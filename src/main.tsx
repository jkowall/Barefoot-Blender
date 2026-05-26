import React from "react";
import ReactDOM from "react-dom/client";
import { Capacitor } from "@capacitor/core";
import App from "./App";
import "./index.css";

const root = document.getElementById("root");

if (!root) {
  throw new Error("Root element not found");
}

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

if ("serviceWorker" in navigator && !Capacitor.isNativePlatform()) {
  void import("virtual:pwa-register")
    .then(({ registerSW }) => {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call
      registerSW({ immediate: true });
    })
    .catch((error) => {
      // Surface registration issues for troubleshooting while keeping build targets compatible.
      console.error("Failed to register service worker", error);
    });
}
