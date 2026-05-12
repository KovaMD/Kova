import React from "react";
import ReactDOM from "react-dom/client";
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/400-italic.css';
import '@fontsource/ibm-plex-mono/700.css';
import App from "./App";
import { AudienceApp } from "./AudienceApp";

const root = ReactDOM.createRoot(document.getElementById("root") as HTMLElement);

if (window.location.hash === '#audience') {
  root.render(<React.StrictMode><AudienceApp /></React.StrictMode>);
} else {
  root.render(<React.StrictMode><App /></React.StrictMode>);
}
