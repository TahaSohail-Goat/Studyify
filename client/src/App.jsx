// ── Studyify frontend: our first React page ──────────────────────────────────
// This page talks to our backend's /api/health route and shows the result.

import { useState, useEffect } from "react";
import "./App.css";

// The address of our backend. Later we'll move this into a config file.
const API_URL = "http://localhost:5000";

function App() {
  // "state" = data React remembers and re-draws the screen when it changes.
  // `status` holds what we want to show the user; `setStatus` updates it.
  const [status, setStatus] = useState("Checking connection to the server...");

  // useEffect runs code *after* the page first appears. We use it to fetch data.
  useEffect(() => {
    // Ask the backend's health route if it's alive.
    fetch(`${API_URL}/api/health`)
      .then((response) => response.json()) // turn the JSON text into a JS object
      .then((data) => {
        setStatus(`✅ Connected to backend! Server says: "${data.status}"`);
      })
      .catch(() => {
        setStatus("❌ Could not reach the server. Is it running on port 5000?");
      });
  }, []); // the empty [] means "run this only once, when the page loads"

  return (
    <div className="App">
      <h1>📚 Studyify</h1>
      <p>Your AI-powered study companion</p>
      <div className="status-card">{status}</div>
    </div>
  );
}

export default App;
