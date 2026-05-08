import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { AudienceApp } from "./AudienceApp";

const root = ReactDOM.createRoot(document.getElementById("root") as HTMLElement);

if (window.location.hash === '#audience') {
  root.render(<React.StrictMode><AudienceApp /></React.StrictMode>);
} else {
  root.render(<React.StrictMode><App /></React.StrictMode>);
}
