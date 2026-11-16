/** The Modern edition is a separate application over the shared UI modules. */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "@modern/App";
import "@shared/ui/style.css";
import "@modern/style.css";

const root = document.getElementById("root");
if (!root) throw new Error("Missing Modern root");
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
