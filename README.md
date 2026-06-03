# Counseling Project

A web-based counseling application featuring a dashboard user interface, patient management, and a robust clinical protocol infrastructure. 

## Features

- **Dashboard Interface:** A comprehensive and professional dashboard for managing counseling sessions and data.
- **Patient Portal:** Interfaces (`patient.html`, `index.html`) to handle patient data and interactions.
- **Server-Side Models:** Built with Node.js and JavaScript, containing models for handling clinical data and logic.

## Project Structure

- `/server` - Contains the server-side code and data models (e.g., `server.js`, `models.js`).
- `/js` - Client-side JavaScript logic (e.g., `calling.js`, `patient.js`, `data.js`).
- `/css` - Styling for the front-end application.
- `/dist` - Build artifacts for production deployment.
- `/dev-tools` - Utilities and tools for local development.

## Tech Stack

- **Frontend:** HTML, CSS, JavaScript (Vanilla JS).
- **Backend:** Node.js, Express (or similar native framework).
- **Utilities:** Puppeteer for headless browser automation, Ngrok for local tunnel exposure.

## Getting Started

1. Install dependencies:
   ```bash
   npm install
   ```

2. Start the development server or build process:
   ```bash
   node serve.js
   ```
   Or if a build step is required:
   ```bash
   node build.js
   ```

## Development

The project uses modular JavaScript (`commonjs` configuration in package.json) and incorporates build/serve scripts to streamline the development workflow.

