# Neon Volley 🏓⚡

Neon Volley is a high-performance, full-stack arcade Ping Pong replica built with React, TypeScript, Tailwind CSS, Express, and WebSockets. 

It features an immersive neon sci-fi aesthetic, real-time multiplayer arenas with WebSockets synchronization, a virtual wagering economy, dynamic ball speed scaling to increase pressure over time, and highly responsive sound/visual effects.

---

## Key Features

- **🧠 Solo Mode**: Compete against an adaptive Neural AI across three difficulty levels (Casual, Standard, and Phantom Protocol with disappearing clone balls).
- **⚡ Online Arena (Multiplayer)**: Join or host a real-time multiplayer room over WebSockets using precise player paddle, ball coordinate, and game status synchronizations.
- **📈 Progressive Acceleration**: The ball speeds up continuously as the session duration increases, making each rally progressively more challenging.
- **💎 Virtual Stakes Wagers**: Risk your virtual wallet balance in pre-set or custom stakes matching. Winners claim the escrow pool upon completing a match to 10 points.
- **✨ Animated Score HUD**: Smooth scaling, fade, and neon shadow reflections driven by standard `motion/react` dynamic viewport translations when scores are updated.

---

## Local Setup & Installation

Follow these quick steps to get Neon Volley running on your local computer:

### 1. Prerequisites
Make sure you have **Node.js** (version 18 or higher recommended) and **npm** installed on your system.

### 2. Install Dependencies
Run the following command at the root of the project to install all required client-side and server-side components:
```bash
npm install
```

### 3. Run the Development Server
Power up the dev environment. This command boots our **Express server with integrated Vite middleware** to serve both the WebSocket synchronizer endpoints and the React frontend on the same port:
```bash
npm run dev
```
Once started, open your web browser and navigate to:
👉 **`http://localhost:3000`**

### 4. Build and Run in Production
To test production builds or host on cloud services (such as Render, Railway, Heroku, Fly.io, etc.):
```bash
# Build Vite client & bundle typescript server with esbuild
npm run build

# Start the optimized Node server
npm run start
```

---

## Directory Structure

```text
├── assets/             # Vector icons and core static images
├── src/
│   ├── components/     # Primary UI, canvas drawing loop, and PingPongGame wrapper
│   ├── index.css       # Tailwind CSS directives & global font definitions
│   ├── main.tsx        # React client entrypoint
│   └── App.tsx         # Main application coordinator
├── server.ts           # Express server & WebSockets Room/Sync state coordinator
├── package.json        # Dependencies, bundling configurations, and runner scripts
└── tsconfig.json       # TypeScript compiler parameters
```

---

## Technologies Used

- **Client**: React, Tailwind CSS, Motion (`motion/react` for elegant UI transitions)
- **Server**: Express, Node.js, `ws` (native WebSockets)
- **Graphics**: HTML5 `<canvas>` API with custom particle system and camera shakes
- **Build System**: Vite (frontend compilation) + esbuild (server bundling)
