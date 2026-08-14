import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { OverlayApp } from "./overlay/OverlayApp";
import { SettingsApp } from "./settings/SettingsApp";
import "./styles/global.css";

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("Root element #root not found");

const route = window.location.hash.replace(/^#/, "") || "/overlay";
const isSettings = route.startsWith("/settings");

createRoot(rootElement).render(
  <StrictMode>{isSettings ? <SettingsApp /> : <OverlayApp />}</StrictMode>,
);
