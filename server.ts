import express from "express";
import http from "http";
import path from "path";
import { fileURLToPath } from "url";
import { createServer as createViteServer } from "vite";
import { WebSocketServer, WebSocket } from "ws";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface ClientInfo {
  socket: WebSocket;
  id: string;
  roomId: string;
  name: string;
  role: "LEFT" | "RIGHT" | "SPECTATOR";
}

interface Room {
  id: string;
  leftPlayerId: string | null;
  leftName: string;
  rightPlayerId: string | null;
  rightName: string;
  wager: number;
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Use http.createServer to attach both Express and WebSocket Server
  const server = http.createServer(app);

  const wss = new WebSocketServer({ noServer: true });

  // Map to hold connected websocket client connections
  const clients = new Map<string, ClientInfo>();
  // Map of rooms
  const rooms = new Map<string, Room>();

  // Helper helper to generate unique IDs
  const generateId = () => Math.random().toString(36).substring(2, 9);

  // Broadcast a message to a room
  const broadcastToRoom = (roomId: string, message: any, excludeClientId?: string) => {
    const payload = JSON.stringify(message);
    clients.forEach((client, id) => {
      if (client.roomId === roomId && id !== excludeClientId) {
        if (client.socket.readyState === WebSocket.OPEN) {
          client.socket.send(payload);
        }
      }
    });
  };

  wss.on("connection", (ws: WebSocket) => {
    const clientId = generateId();
    
    ws.on("message", (rawMessage: string) => {
      try {
        const msg = JSON.parse(rawMessage);
        
        switch (msg.type) {
          case "join": {
            const { roomId, name } = msg;
            
            // Clean up any existing room associations for this socket
            if (clients.has(clientId)) {
              const oldClient = clients.get(clientId)!;
              handleClientDisconnect(clientId, oldClient.roomId);
            }

            // Secure/initialize room state
            let room = rooms.get(roomId);
            if (!room) {
              room = {
                id: roomId,
                leftPlayerId: null,
                leftName: "",
                rightPlayerId: null,
                rightName: "",
                wager: 10.00
              };
              rooms.set(roomId, room);
            }

            // Determine role
            let role: "LEFT" | "RIGHT" | "SPECTATOR" = "SPECTATOR";
            if (!room.leftPlayerId) {
              room.leftPlayerId = clientId;
              room.leftName = name || "Host";
              role = "LEFT";
            } else if (!room.rightPlayerId) {
              room.rightPlayerId = clientId;
              room.rightName = name || "Guest";
              role = "RIGHT";
            }

            const clientInfo: ClientInfo = {
              socket: ws,
              id: clientId,
              roomId,
              name: name || `User-${clientId.substring(0, 4)}`,
              role
            };
            
            clients.set(clientId, clientInfo);

            // Send confirmation back to client
            ws.send(JSON.stringify({
              type: "joined_receipt",
              role,
              clientId,
              roomId,
              roomInfo: {
                leftName: room.leftName,
                rightName: room.rightName,
                wager: room.wager
              }
            }));

            // Broadcast room update to all in room
            broadcastToRoom(roomId, {
              type: "room_update",
              leftName: room.leftName,
              rightName: room.rightName,
              wager: room.wager,
              leftOnline: !!room.leftPlayerId,
              rightOnline: !!room.rightPlayerId
            });
            break;
          }

          case "paddle_sync": {
            const client = clients.get(clientId);
            if (client) {
              broadcastToRoom(client.roomId, {
                type: "paddle_sync",
                role: client.role,
                y: msg.y
              }, clientId);
            }
            break;
          }

          case "ball_sync": {
            const client = clients.get(clientId);
            // Only allow the LEFT player (Host) to coordinate the authoritative ball position
            if (client && client.role === "LEFT") {
              broadcastToRoom(client.roomId, {
                type: "ball_sync",
                balls: msg.balls,
                particles: msg.particles || [],
                scores: msg.scores,
                rallyCount: msg.rallyCount,
                elapsedSeconds: msg.elapsedSeconds,
                escrowPool: msg.escrowPool
              }, clientId);
            }
            break;
          }

          case "game_state_sync": {
            const client = clients.get(clientId);
            if (client) {
              broadcastToRoom(client.roomId, {
                type: "game_state_sync",
                gameState: msg.gameState,
                winner: msg.winner,
                difficulty: msg.difficulty
              }, clientId);
            }
            break;
          }

          case "wager_sync": {
            const client = clients.get(clientId);
            if (client) {
              const room = rooms.get(client.roomId);
              if (room) {
                room.wager = msg.wager;
                broadcastToRoom(client.roomId, {
                  type: "wager_sync",
                  wager: msg.wager
                });
              }
            }
            break;
          }

          case "chat": {
            const client = clients.get(clientId);
            if (client) {
              broadcastToRoom(client.roomId, {
                type: "chat",
                sender: client.name,
                role: client.role,
                text: msg.text
              });
            }
            break;
          }

          case "rematch_vote": {
            const client = clients.get(clientId);
            if (client) {
              broadcastToRoom(client.roomId, {
                type: "rematch_vote",
                role: client.role,
                voted: msg.voted
              }, clientId);
            }
            break;
          }

          default:
            break;
        }

      } catch (e) {
        console.error("Error processing websocket payload:", e);
      }
    });

    const handleClientDisconnect = (cid: string, rid: string) => {
      const room = rooms.get(rid);
      if (room) {
        if (room.leftPlayerId === cid) {
          room.leftPlayerId = null;
          room.leftName = "";
        } else if (room.rightPlayerId === cid) {
          room.rightPlayerId = null;
          room.rightName = "";
        }
        
        // If room is entirely empty, delete it
        if (!room.leftPlayerId && !room.rightPlayerId) {
          rooms.delete(rid);
        } else {
          // Notify remaining player that someone disconnected
          broadcastToRoom(rid, {
            type: "room_update",
            leftName: room.leftName,
            rightName: room.rightName,
            wager: room.wager,
            leftOnline: !!room.leftPlayerId,
            rightOnline: !!room.rightPlayerId,
            disconnectedRole: clients.get(cid)?.role
          });
        }
      }
      clients.delete(cid);
    };

    ws.on("close", () => {
      const client = clients.get(clientId);
      if (client) {
        handleClientDisconnect(clientId, client.roomId);
      }
    });

    ws.on("error", (err) => {
      console.error(`Socket error for ${clientId}:`, err);
    });
  });

  // Attach raw HTTP upgrade events for the ws server on port 3000
  server.on("upgrade", (request, socket, head) => {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit("connection", ws, request);
    });
  });

  // API Routes (mounted before Vite middleware)
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", roomsActive: rooms.size, playersActive: clients.size });
  });

  // Integrate Vite dev middleware or serve production static assets
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  server.listen(PORT, "0.0.0.0", () => {
    console.log(`[FULLSTACK] Server running on http://localhost:${PORT}`);
  });
}

startServer();
