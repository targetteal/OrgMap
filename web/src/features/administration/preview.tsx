// Local integration harness using the actual shell, foundation authentication and PostgreSQL API.
import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "../../App";
import "../../styles.css";
if (location.pathname.endsWith("/preview.html"))
  history.replaceState({}, "", "/administration/pages");
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
