/** Independent Habitat edition; shared controls keep their proven behavior. */
import { createRoot } from "react-dom/client";

import { App } from "@habitat/App";
import "@shared/ui/style.css";
import "@habitat/style.css";

const root = document.getElementById("root");
if (!root) throw new Error("Missing Habitat application root");
createRoot(root).render(<App />);
