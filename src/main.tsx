import React from "react";
import { createRoot } from "react-dom/client";
import { AuthProvider } from "./auth/AuthProvider";
import { App } from "./App";
import { PhoneFrame } from "./components/PhoneFrame";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AuthProvider>
      <PhoneFrame>
        <App />
      </PhoneFrame>
    </AuthProvider>
  </React.StrictMode>,
);
