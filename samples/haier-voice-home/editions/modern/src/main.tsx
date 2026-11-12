/** The immersive edition is a separate application, not a reskin of V1. */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "@v2/App";
import "@v2/style.css";

const root = document.getElementById("root");
if (!root) throw new Error("Missing Atelier root");
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
