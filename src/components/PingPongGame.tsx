import React, { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Trophy,
  Play,
  RotateCcw,
  Zap,
  Volume2,
  VolumeX,
  Keyboard,
  MousePointer,
  Pause,
  Info,
  Sparkles,
  Flame,
  Award,
  Wallet,
  Coins,
  DollarSign
} from "lucide-react";
import {
  GameDifficulty,
  GameState,
  Ball,
  Paddle,
  Particle,
  GameSettings,
} from "../types";
import {
  playPaddleHitSound,
  playWallHitSound,
  playScoreSound,
  playGameOverWinSound,
  playGameOverLoseSound,
  playMenuClickSound,
} from "../utils/audio";

// Canvas Resolution Dimensions Internally
const CANVAS_WIDTH = 800;
const CANVAS_HEIGHT = 500;
const PADDLE_WIDTH = 12;
const PADDLE_HEIGHT = 80;
const REAL_BALL_COLOR = "#ffffff"; // Neon White
const PHANTOM_BALL_COLOR = "rgba(255, 255, 255, 0.45)"; // Semitransparent white clones
const BALL_RADIUS = 7;

// Storage Keys
const HIGH_SCORE_KEY_PREFIX = "pingpong_highscore_difficulty_";
const AUDIO_MUTED_KEY = "pingpong_audio_muted";

export default function PingPongGame() {
  // Game states managed by React & Canvas Loop
  const [gameState, setGameState] = useState<GameState>("MENU");
  const [difficulty, setDifficulty] = useState<GameDifficulty>(2);
  const [controlMode, setControlMode] = useState<"MOUSE" | "KEYBOARD">("MOUSE");
  const [soundEnabled, setSoundEnabled] = useState<boolean>(true);
  const [lastRally, setLastRally] = useState<number>(0);
  const [bestRally, setBestRally] = useState<number>(0);
  
  // Game scores (mirrored to state for visual react render, synchronized with game ref)
  const [playerScore, setPlayerScore] = useState<number>(0);
  const [aiScore, setAiScore] = useState<number>(0);
  const [winner, setWinner] = useState<"PLAYER" | "AI" | null>(null);
  
  // Alert message overlays during high stakes
  const [doubleScoreAlert, setDoubleScoreAlert] = useState<boolean>(false);
  const [phantomAddedAlert, setPhantomAddedAlert] = useState<boolean>(false);

  // Mode select & timing session state
  const [mode, setMode] = useState<"SOLO" | "MULTIPLAYER">("SOLO");
  const [elapsedSeconds, setElapsedSeconds] = useState<number>(0);
  const elapsedSecondsRef = useRef<number>(0);

  // WebSockets Multiplayer state config
  const [mpPlayerName, setMpPlayerName] = useState<string>(() => {
    return localStorage.getItem("pingpong_username") || `Player_${Math.floor(100 + Math.random() * 900)}`;
  });
  const [mpRoomId, setMpRoomId] = useState<string>(() => {
    return Math.random().toString(36).substring(2, 6).toUpperCase();
  });
  const [wsConnected, setWsConnected] = useState<boolean>(false);
  const [mpRole, setMpRole] = useState<"LEFT" | "RIGHT" | "SPECTATOR" | null>(null);
  const [mpRoomState, setMpRoomState] = useState<{
    leftName: string;
    rightName: string;
    wager: number;
    leftOnline: boolean;
    rightOnline: boolean;
  } | null>(null);
  const [mpOpponentDisconnected, setMpOpponentDisconnected] = useState<boolean>(false);
  const [mpChatText, setMpChatText] = useState<string>("");
  const [mpChatLog, setMpChatLog] = useState<Array<{ sender: string; role: string; text: string }>>([]);

  const socketRef = useRef<WebSocket | null>(null);
  const mpRoleRef = useRef<"LEFT" | "RIGHT" | "SPECTATOR" | null>(null);

  useEffect(() => {
    localStorage.setItem("pingpong_username", mpPlayerName);
  }, [mpPlayerName]);

  useEffect(() => {
    mpRoleRef.current = mpRole;
  }, [mpRole]);

  // Handle active session seconds counting
  useEffect(() => {
    if (gameState !== "PLAYING") return;
    const interval = setInterval(() => {
      elapsedSecondsRef.current += 1;
      setElapsedSeconds(elapsedSecondsRef.current);
    }, 1000);
    return () => clearInterval(interval);
  }, [gameState]);

  // Virtual wagering state
  const [walletBalance, setWalletBalance] = useState<number>(() => {
    const saved = localStorage.getItem("pingpong_wallet_balance");
    return saved ? Math.max(0, parseFloat(saved)) : 100.00;
  });
  
  const [aiWalletBalance, setAiWalletBalance] = useState<number>(() => {
    const saved = localStorage.getItem("pingpong_ai_wallet_balance");
    return saved ? Math.max(0, parseFloat(saved)) : 250.00;
  });

  const [selectedWager, setSelectedWager] = useState<number>(10.00);
  const [customWagerText, setCustomWagerText] = useState<string>("10.00");
  const [escrowPool, setEscrowPool] = useState<number>(0);

  const updatePlayerBalanceWithStorage = (newVal: number) => {
    const rounded = Math.max(0, Math.round(newVal * 100) / 100);
    setWalletBalance(rounded);
    localStorage.setItem("pingpong_wallet_balance", rounded.toString());
  };

  const updateAiBalanceWithStorage = (newVal: number) => {
    const rounded = Math.max(0, Math.round(newVal * 100) / 100);
    setAiWalletBalance(rounded);
    localStorage.setItem("pingpong_ai_wallet_balance", rounded.toString());
  };

  const claimBailout = () => {
    if (soundEnabled) playMenuClickSound();
    updatePlayerBalanceWithStorage(100.00);
  };

  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Core Physics Refs (prevents re-render lag inside 60fps loop)
  const stateRef = useRef<GameState>("MENU");
  const playerPaddleRef = useRef<Paddle>({
    x: 20,
    y: CANVAS_HEIGHT / 2 - PADDLE_HEIGHT / 2,
    width: PADDLE_WIDTH,
    height: PADDLE_HEIGHT,
    score: 0,
    color: "#818cf8", // Neon Indigo
  });
  
  const aiPaddleRef = useRef<Paddle>({
    x: CANVAS_WIDTH - 20 - PADDLE_WIDTH,
    y: CANVAS_HEIGHT / 2 - PADDLE_HEIGHT / 2,
    width: PADDLE_WIDTH,
    height: PADDLE_HEIGHT,
    score: 0,
    color: "#fb7185", // Neon Rose
  });

  const ballsRef = useRef<Ball[]>([]);
  const particlesRef = useRef<Particle[]>([]);
  
  // Tracking keystates
  const keysRef = useRef<{ [key: string]: boolean }>({});
  
  // Canvas Interaction Coordinates
  const mousePositionRef = useRef<{ y: number }>({ y: CANVAS_HEIGHT / 2 });

  // Camera Shake Engine
  const shakeTimeRef = useRef<number>(0);
  const shakeIntensityRef = useRef<number>(0);

  // Time & Intervals
  const phantomSpawnCooldownRef = useRef<number>(0);
  const activeRallyCountRef = useRef<number>(0);

  // Align refs with react states
  useEffect(() => {
    stateRef.current = gameState;
  }, [gameState]);

  // Helper helper to distribute payload to the websocket server
  const sendWsMessage = (message: any) => {
    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify(message));
    }
  };

  // Connect to room via WebSocket
  const connectToRoom = (roomIdToJoin: string, playerNameToUse: string) => {
    if (socketRef.current) {
      socketRef.current.close();
    }

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}`;
    const ws = new WebSocket(wsUrl);
    socketRef.current = ws;

    ws.onopen = () => {
      setWsConnected(true);
      setMpOpponentDisconnected(false);
      ws.send(JSON.stringify({
        type: "join",
        roomId: roomIdToJoin.toUpperCase(),
        name: playerNameToUse
      }));
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        switch (msg.type) {
          case "joined_receipt":
            setMpRole(msg.role);
            setMpRoomState(msg.roomInfo);
            setSelectedWager(msg.roomInfo.wager);
            setCustomWagerText(msg.roomInfo.wager.toFixed(2));
            break;

          case "room_update":
            setMpRoomState({
              leftName: msg.leftName,
              rightName: msg.rightName,
              wager: msg.wager,
              leftOnline: msg.leftOnline,
              rightOnline: msg.rightOnline
            });
            
            if (msg.disconnectedRole) {
              setMpOpponentDisconnected(true);
              setGameState("MENU");
            }
            break;

          case "paddle_sync":
            if (mpRoleRef.current === "LEFT" && msg.role === "RIGHT") {
              aiPaddleRef.current.y = msg.y;
            } else if (mpRoleRef.current === "RIGHT" && msg.role === "LEFT") {
              playerPaddleRef.current.y = msg.y;
            } else if (mpRoleRef.current === "SPECTATOR") {
              if (msg.role === "LEFT") {
                playerPaddleRef.current.y = msg.y;
              } else if (msg.role === "RIGHT") {
                aiPaddleRef.current.y = msg.y;
              }
            }
            break;

          case "ball_sync":
            if (mpRoleRef.current !== "LEFT") {
              // Override balls and particles
              ballsRef.current = msg.balls || [];
              particlesRef.current = msg.particles || [];
              setPlayerScore(msg.scores?.player ?? 0);
              setAiScore(msg.scores?.ai ?? 0);
              setLastRally(msg.rallyCount ?? 0);
              setEscrowPool(msg.escrowPool ?? 0);
              setElapsedSeconds(msg.elapsedSeconds ?? 0);
              elapsedSecondsRef.current = msg.elapsedSeconds ?? 0;
            }
            break;

          case "game_state_sync":
            if (mpRoleRef.current !== "LEFT") {
              setGameState(msg.gameState);
              if (msg.difficulty) {
                setDifficulty(msg.difficulty);
              }
              if (msg.winner) {
                setWinner(msg.winner === "LEFT" ? "PLAYER" : "AI");
              }
            }
            break;

          case "wager_sync":
            setSelectedWager(msg.wager);
            setCustomWagerText(msg.wager.toFixed(2));
            break;

          case "chat":
            setMpChatLog(prev => [...prev.slice(-15), { sender: msg.sender, role: msg.role, text: msg.text }]);
            break;

          default:
            break;
        }
      } catch (err) {
        console.error("Error matching websocket sync feed:", err);
      }
    };

    ws.onclose = () => {
      setWsConnected(false);
      setMpRole(null);
    };

    ws.onerror = () => {
      setWsConnected(false);
    };
  };

  const sendMpChat = () => {
    if (!mpChatText.trim()) return;
    sendWsMessage({
      type: "chat",
      text: mpChatText
    });
    setMpChatText("");
  };

  // Handle Loading saved High Rallies & sound setting
  useEffect(() => {
    const savedMuted = localStorage.getItem(AUDIO_MUTED_KEY);
    if (savedMuted === "true") {
      setSoundEnabled(false);
    }

    const savedBest = localStorage.getItem(`${HIGH_SCORE_KEY_PREFIX}${difficulty}`);
    if (savedBest) {
      setBestRally(parseInt(savedBest, 10));
    } else {
      setBestRally(0);
    }
  }, [difficulty]);

  // Click Sound Wrapper
  const handleMenuClick = () => {
    if (soundEnabled) playMenuClickSound();
  };

  // Toggle Mute
  const toggleMute = () => {
    const newMutedState = !soundEnabled;
    setSoundEnabled(newMutedState);
    localStorage.setItem(AUDIO_MUTED_KEY, (!newMutedState).toString());
    if (newMutedState) playMenuClickSound();
  };

  // Keyboard listeners list
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      keysRef.current[e.key.toLowerCase()] = true;
      
      // Prevent scrolling when using arrow keys or space on applet
      if (["arrowup", "arrowdown", " "].includes(e.key.toLowerCase())) {
        e.preventDefault();
      }

      // PAUSE game toggle
      if (e.key === "p" || e.key === "P" || e.key === "Escape") {
        if (stateRef.current === "PLAYING") {
          setGameState("PAUSED");
        } else if (stateRef.current === "PAUSED") {
          setGameState("PLAYING");
        }
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      keysRef.current[e.key.toLowerCase()] = false;
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, []);

  // Set up screen shake helper
  const triggerScreenShake = (intensity: number, durationFrames: number) => {
    shakeIntensityRef.current = intensity;
    shakeTimeRef.current = durationFrames;
  };

  // Spawn visual hit particles
  const createExplosion = (x: number, y: number, color: string, count: number = 10) => {
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 1.5 + Math.random() * 4.5;
      particlesRef.current.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        radius: 1.5 + Math.random() * 2.5,
        color,
        alpha: 1.0,
        decay: 0.02 + Math.random() * 0.035,
      });
    }
  };

  // Ball Initialization
  const resetBall = (launchDirection: "PLAYER" | "AI" | "RANDOM" = "RANDOM") => {
    // Determine velocity based on difficulty speed
    let baseSpeed = 5;
    if (difficulty === 1) baseSpeed = 4.2;
    if (difficulty === 2) baseSpeed = 6.2;
    if (difficulty === 3) baseSpeed = 9.8; // Fast intensive mode!

    let dirX = 1;
    if (launchDirection === "PLAYER") {
      dirX = -1;
    } else if (launchDirection === "AI") {
      dirX = 1;
    } else {
      dirX = Math.random() > 0.5 ? 1 : -1;
    }

    // Give slight angle on start
    const angle = (Math.random() * 40 - 20) * (Math.PI / 180); // -20 to 20 degrees
    const vx = dirX * baseSpeed * Math.cos(angle);
    const vy = baseSpeed * Math.sin(angle);

    ballsRef.current = [
      {
        x: CANVAS_WIDTH / 2,
        y: CANVAS_HEIGHT / 2,
        vx,
        vy,
        radius: BALL_RADIUS,
        isPhantom: false,
        opacity: 1.0,
        trail: [],
      },
    ];

    phantomSpawnCooldownRef.current = 150; // Delay first phantom spawn
    activeRallyCountRef.current = 0; // Reset active rally length for this point
    setLastRally(0);
  };

  // Start Playing Game
  const startGame = (selectedDifficulty: GameDifficulty) => {
    if (walletBalance < selectedWager) {
      return;
    }

    handleMenuClick();
    setDifficulty(selectedDifficulty);
    setPlayerScore(0);
    setAiScore(0);
    setWinner(null);
    setDoubleScoreAlert(false);
    setPhantomAddedAlert(false);

    // Reset session timers
    elapsedSecondsRef.current = 0;
    setElapsedSeconds(0);

    playerPaddleRef.current.score = 0;
    playerPaddleRef.current.y = CANVAS_HEIGHT / 2 - PADDLE_HEIGHT / 2;
    aiPaddleRef.current.score = 0;
    aiPaddleRef.current.y = CANVAS_HEIGHT / 2 - PADDLE_HEIGHT / 2;

    if (mode === "MULTIPLAYER") {
      if (mpRole !== "LEFT") return; // Guest is passive, waiting for host

      const finalWager = selectedWager;
      updatePlayerBalanceWithStorage(walletBalance - finalWager);
      setEscrowPool(finalWager * 2);

      // Reset coordinates and sync
      resetBall("RANDOM");
      setGameState("PLAYING");

      sendWsMessage({
        type: "game_state_sync",
        gameState: "PLAYING",
        difficulty: selectedDifficulty
      });
    } else {
      // Local play vs AI
      let currentAiBal = aiWalletBalance;
      if (currentAiBal < selectedWager) {
        currentAiBal = 250.00;
        updateAiBalanceWithStorage(250.00);
      }

      const finalWager = selectedWager;
      updatePlayerBalanceWithStorage(walletBalance - finalWager);
      updateAiBalanceWithStorage(currentAiBal - finalWager);
      setEscrowPool(finalWager * 2);

      resetBall("RANDOM");
      setGameState("PLAYING");
    }
  };

  const restartPlay = () => {
    if (walletBalance < selectedWager) {
      setGameState("MENU");
    } else {
      if (mode === "MULTIPLAYER") {
        if (mpRole === "LEFT") {
          startGame(difficulty);
        } else {
          // Send request or notice that player is ready
          sendWsMessage({
            type: "chat",
            text: "🔄 I am ready for a rematch!"
          });
        }
      } else {
        startGame(difficulty);
      }
    }
  };

  // Pause toggle
  const togglePause = () => {
    handleMenuClick();
    if (gameState === "PLAYING") {
      setGameState("PAUSED");
    } else if (gameState === "PAUSED") {
      setGameState("PLAYING");
    }
  };

  // Main game logic loop
  useEffect(() => {
    let animId: number;

    const gameLoop = () => {
      updatePhysics();
      renderCanvas();
      animId = requestAnimationFrame(gameLoop);
    };

    animId = requestAnimationFrame(gameLoop);
    return () => cancelAnimationFrame(animId);
  }, [difficulty, controlMode, soundEnabled]);

  // Update Game State Coordinates
  const updatePhysics = () => {
    if (stateRef.current !== "PLAYING") return;

    // --- 1. Paddle Movement (Player Left / AI/Human Right) ---
    const player = playerPaddleRef.current;
    const ai = aiPaddleRef.current;

    // Left Paddle movement (Controlled by local player in SOLO, or Host in MULTIPLAYER)
    if (mode === "SOLO" || mpRole === "LEFT") {
      if (controlMode === "MOUSE") {
        const targetY = mousePositionRef.current.y - PADDLE_HEIGHT / 2;
        player.y += (targetY - player.y) * 0.35;
      } else {
        const keySpeed = 10;
        if (keysRef.current["w"] || keysRef.current["arrowup"]) {
          player.y -= keySpeed;
        }
        if (keysRef.current["s"] || keysRef.current["arrowdown"]) {
          player.y += keySpeed;
        }
      }
      if (player.y < 0) player.y = 0;
      if (player.y > CANVAS_HEIGHT - PADDLE_HEIGHT) {
        player.y = CANVAS_HEIGHT - PADDLE_HEIGHT;
      }

      // Sync Left player paddle to WebSocket
      if (mode === "MULTIPLAYER") {
        sendWsMessage({ type: "paddle_sync", y: player.y });
      }
    }

    // Right Paddle movement (AI in SOLO mode, or Player 2 Guest in MULTIPLAYER Mode)
    if (mode === "SOLO") {
      const realBall = ballsRef.current[0];
      if (realBall) {
        const aiCenterY = ai.y + PADDLE_HEIGHT / 2;
        const targetAiY = realBall.y;
        const diffY = targetAiY - aiCenterY;

        let aiSpeedFactor = 0.06;
        let maxAiSpeed = 4.5;

        if (difficulty === 1) {
          aiSpeedFactor = 0.051;
          maxAiSpeed = 3.6;
        } else if (difficulty === 2) {
          aiSpeedFactor = 0.095;
          maxAiSpeed = 6.2;
        } else if (difficulty === 3) {
          aiSpeedFactor = 0.175;
          maxAiSpeed = 11.0;
        }

        const isBallInAiHalf = realBall.vy !== undefined ? realBall.x > CANVAS_WIDTH * 0.35 : realBall.x > CANVAS_WIDTH * 0.45;
        if (isBallInAiHalf || difficulty === 3) {
          const moveStep = diffY * aiSpeedFactor;
          const clampedMove = Math.max(-maxAiSpeed, Math.min(maxAiSpeed, moveStep));
          ai.y += clampedMove;
        }

        if (ai.y < 0) ai.y = 0;
        if (ai.y > CANVAS_HEIGHT - PADDLE_HEIGHT) {
          ai.y = CANVAS_HEIGHT - PADDLE_HEIGHT;
        }
      }
    } else if (mpRole === "RIGHT") {
      // Local player is on the RIGHT. Read cursor or keyboard and update ai.y directly
      if (controlMode === "MOUSE") {
        const targetY = mousePositionRef.current.y - PADDLE_HEIGHT / 2;
        ai.y += (targetY - ai.y) * 0.35;
      } else {
        const keySpeed = 10;
        if (keysRef.current["w"] || keysRef.current["arrowup"]) {
          ai.y -= keySpeed;
        }
        if (keysRef.current["s"] || keysRef.current["arrowdown"]) {
          ai.y += keySpeed;
        }
      }
      if (ai.y < 0) ai.y = 0;
      if (ai.y > CANVAS_HEIGHT - PADDLE_HEIGHT) {
        ai.y = CANVAS_HEIGHT - PADDLE_HEIGHT;
      }

      // Sync Right player paddle position
      sendWsMessage({ type: "paddle_sync", y: ai.y });
    }

    // Only host (Left player) or local play calculates ball trajectories, collisions, and scores
    if (mode === "SOLO" || mpRole === "LEFT") {
      const realBall = ballsRef.current[0];

      // --- 2. Phantom Ball Periodical Spawner (Difficulty 3 Exclusive) ---
      if (difficulty === 3) {
        if (phantomSpawnCooldownRef.current > 0) {
          phantomSpawnCooldownRef.current--;
        } else if (ballsRef.current.length < 3 && realBall) {
          if (realBall.vx < 0 && realBall.x > CANVAS_WIDTH * 0.4) {
            spawnPhantomBall();
            phantomSpawnCooldownRef.current = 240 + Math.floor(Math.random() * 180);
          }
        }
      }

      // --- 3. Ball Physics & Collision Updates ---
      for (let index = 0; index < ballsRef.current.length; index++) {
        const ball = ballsRef.current[index];
        if (!ball) continue;

        // Maintain trail positions
        ball.trail.push({ x: ball.x, y: ball.y });
        if (ball.trail.length > 12) {
          ball.trail.shift();
        }

        // Update positions
        ball.x += ball.vx;
        ball.y += ball.vy;

        // Continuous session speed scale increase (+0.016% speed per animation frame)
        if (!ball.isPhantom) {
          const continuousBoostFactor = 1.00016;
          const currentSpeed = Math.hypot(ball.vx, ball.vy);
          if (currentSpeed < 25) {
            ball.vx *= continuousBoostFactor;
            ball.vy *= continuousBoostFactor;
          }
        }

        // Bounce top and bottom
        if (ball.y - ball.radius <= 0) {
          ball.y = ball.radius;
          ball.vy = -ball.vy;
          createExplosion(ball.x, ball.y, "#94a3b8", 4);
          if (!ball.isPhantom && soundEnabled) playWallHitSound();
          triggerScreenShake(1.5, 4);
        } else if (ball.y + ball.radius >= CANVAS_HEIGHT) {
          ball.y = CANVAS_HEIGHT - ball.radius;
          ball.vy = -ball.vy;
          createExplosion(ball.x, ball.y, "#94a3b8", 4);
          if (!ball.isPhantom && soundEnabled) playWallHitSound();
          triggerScreenShake(1.5, 4);
        }

        // Collide Left Paddle (Player side)
        const paddleLeftX = player.x + player.width;
        if (
          ball.vx < 0 &&
          ball.x - ball.radius <= paddleLeftX &&
          ball.x - ball.radius >= player.x - 5 &&
          ball.y >= player.y - 4 &&
          ball.y <= player.y + PADDLE_HEIGHT + 4
        ) {
          if (ball.isPhantom) {
            // Phantom ball goes through Left paddle
          } else {
            ball.x = paddleLeftX + ball.radius;
            const relativeIntersectY = (player.y + PADDLE_HEIGHT / 2) - ball.y;
            const normalizedIntersectY = relativeIntersectY / (PADDLE_HEIGHT / 2);
            const bounceAngle = -normalizedIntersectY * (Math.PI / 3.4);

            // Starting speed scales continuously as timer increases to create rising pressure!
            const sessionSpeedFactor = 1.0 + Math.min(0.8, elapsedSecondsRef.current * 0.005);
            const speed = Math.min(24, Math.hypot(ball.vx, ball.vy) * 1.06 * sessionSpeedFactor);

            ball.vx = speed * Math.cos(bounceAngle);
            ball.vy = speed * Math.sin(bounceAngle);

            activeRallyCountRef.current += 1;
            setLastRally(activeRallyCountRef.current);
            if (activeRallyCountRef.current > bestRally) {
              setBestRally(activeRallyCountRef.current);
              localStorage.setItem(`${HIGH_SCORE_KEY_PREFIX}${difficulty}`, activeRallyCountRef.current.toString());
            }

            createExplosion(player.x + player.width, ball.y, REAL_BALL_COLOR, 14);
            if (soundEnabled) playPaddleHitSound();
            triggerScreenShake(3.5, 7);

            if (difficulty === 3 && ballsRef.current.length < 3 && Math.random() > 0.4) {
              setTimeout(() => {
                if (stateRef.current === "PLAYING") spawnPhantomBall(true);
              }, 100);
            }
          }
        }

        // Collide Right Paddle (AI/Human Player-2 side)
        const paddleRightX = ai.x;
        if (
          ball.vx > 0 &&
          ball.x + ball.radius >= paddleRightX &&
          ball.x + ball.radius <= ai.x + ai.width + 5 &&
          ball.y >= ai.y - 4 &&
          ball.y <= ai.y + PADDLE_HEIGHT + 4
        ) {
          ball.x = paddleRightX - ball.radius;
          const relativeIntersectY = (ai.y + PADDLE_HEIGHT / 2) - ball.y;
          const normalizedIntersectY = relativeIntersectY / (PADDLE_HEIGHT / 2);
          const bounceAngle = -normalizedIntersectY * (Math.PI / 3.4);

          // Starting speed scales continuously as timer increases too!
          const sessionSpeedFactor = 1.0 + Math.min(0.8, elapsedSecondsRef.current * 0.005);
          const speed = Math.min(24, Math.hypot(ball.vx, ball.vy) * 1.05 * sessionSpeedFactor);

          ball.vx = -speed * Math.cos(bounceAngle);
          ball.vy = speed * Math.sin(bounceAngle);

          createExplosion(ai.x, ball.y, ai.color, 12);
          if (soundEnabled && !ball.isPhantom) playPaddleHitSound();
          triggerScreenShake(3, 6);
        }

        // --- 4. Scoring Boundaries ---
        if (ball.x < 0) {
          if (ball.isPhantom) {
            ballsRef.current.splice(index, 1);
            index--;
          } else {
            handleAiScored();
            return;
          }
        } else if (ball.x > CANVAS_WIDTH) {
          if (ball.isPhantom) {
            ballsRef.current.splice(index, 1);
            index--;
          } else {
            handlePlayerScored();
            return;
          }
        }
      }

      // --- 5. Broadcast full match telemetry to multiplayer client ---
      if (mode === "MULTIPLAYER") {
        sendWsMessage({
          type: "ball_sync",
          balls: ballsRef.current,
          particles: particlesRef.current,
          scores: { player: playerScore, ai: aiScore },
          rallyCount: lastRally,
          elapsedSeconds: elapsedSecondsRef.current,
          escrowPool: escrowPool
        });
      }
    }

    // --- 6. Update Particles Decaying ---
    const particles = particlesRef.current;
    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      p.x += p.vx;
      p.y += p.vy;
      p.alpha -= p.decay;

      if (p.alpha <= 0) {
        particles.splice(i, 1);
        i--;
      }
    }

    // Update screen shake frames
    if (shakeTimeRef.current > 0) {
      shakeTimeRef.current--;
    }
  };

  // Helper trigger to create a cloned phantom distraction ball
  const spawnPhantomBall = (splitFromPlayer: boolean = false) => {
    const realBall = ballsRef.current[0];
    if (!realBall) return;

    // Set spawning coordinate
    let startX = realBall.x;
    let startY = realBall.y;
    
    // Create subtle angle divergence (e.g. offset velocity in Y direction)
    const multiplierY = splitFromPlayer ? -1.18 : -0.92;
    const offsetVy = realBall.vy * multiplierY + (Math.random() * 2 - 1);
    
    // Ensure phantom velocity stays reasonably active
    const vxOffset = realBall.vx * (splitFromPlayer ? 1.0 : 0.85);

    ballsRef.current.push({
      x: startX,
      y: startY,
      vx: vxOffset,
      vy: offsetVy,
      radius: BALL_RADIUS,
      isPhantom: true,
      opacity: 0.55, // Semitransparent visual
      trail: [],
    });

    // Fire ephemeral HUD overlay notices
    setPhantomAddedAlert(true);
    setTimeout(() => setPhantomAddedAlert(false), 1400);
  };

  // Human player scored point
  const handlePlayerScored = () => {
    const nextScore = playerScore + 1;
    setPlayerScore(nextScore);
    
    // Update Score Synth Audio
    if (soundEnabled) playScoreSound();

    if (nextScore >= 10) {
      setWinner("PLAYER");
      setGameState("GAMEOVER");
      if (soundEnabled) playGameOverWinSound();

      if (mode === "MULTIPLAYER") {
        if (mpRole === "LEFT") {
          updatePlayerBalanceWithStorage(walletBalance + escrowPool);
        }
        setEscrowPool(0);
        sendWsMessage({
          type: "game_state_sync",
          gameState: "GAMEOVER",
          winner: "LEFT"
        });
      } else {
        updatePlayerBalanceWithStorage(walletBalance + escrowPool);
        setEscrowPool(0);
      }
    } else {
      // Launch next serve towards AI
      resetBall("AI");
    }
  };

  // AI scored point
  const handleAiScored = () => {
    // High-Stakes Scoring Rule Check:
    // If phantom balls are active on screen and player missed real ball, get double points (2 instead of 1)
    const hasPhantomsActive = ballsRef.current.some(b => b.isPhantom);
    let pointsAwarded = 1;

    if (hasPhantomsActive && difficulty === 3) {
      pointsAwarded = 2;
      setDoubleScoreAlert(true);
      setTimeout(() => setDoubleScoreAlert(false), 2400);
    }

    const nextScore = aiScore + pointsAwarded;
    setAiScore(nextScore);

    if (soundEnabled) playScoreSound();

    if (nextScore >= 10) {
      setWinner("AI");
      setGameState("GAMEOVER");

      if (mode === "MULTIPLAYER") {
        if (soundEnabled) {
          if (mpRole === "RIGHT") playGameOverWinSound();
          else playGameOverLoseSound();
        }

        if (mpRole === "RIGHT") {
          updatePlayerBalanceWithStorage(walletBalance + escrowPool);
        }
        setEscrowPool(0);
        sendWsMessage({
          type: "game_state_sync",
          gameState: "GAMEOVER",
          winner: "RIGHT"
        });
      } else {
        if (soundEnabled) playGameOverLoseSound();
        updateAiBalanceWithStorage(aiWalletBalance + escrowPool);
        setEscrowPool(0);
      }
    } else {
      // Launch serve towards player
      resetBall("PLAYER");
    }
  };

  // Draw Arena Graphics on HTML5 Canvas
  const renderCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.save();

    // Reset translation for clear redraw
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    // Apply Camera Screen-Shake Offset if active
    if (shakeTimeRef.current > 0) {
      const shakeX = (Math.random() - 0.5) * shakeIntensityRef.current;
      const shakeY = (Math.random() - 0.5) * shakeIntensityRef.current;
      ctx.translate(shakeX, shakeY);
    }

    // --- A. Draw Digital Pitch BG Canvas Aesthetics ---
    // Translucent black clear to keep high-speed neon trails and reveal CSS grid underneath
    ctx.fillStyle = "rgba(5, 5, 8, 0.16)";
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    // Grid accent lines
    ctx.strokeStyle = "rgba(30,41,59, 0.4)";
    ctx.lineWidth = 1;
    const gridSize = 40;
    for (let x = 0; x < CANVAS_WIDTH; x += gridSize) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, CANVAS_HEIGHT);
      ctx.stroke();
    }
    for (let y = 0; y < CANVAS_HEIGHT; y += gridSize) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(CANVAS_WIDTH, y);
      ctx.stroke();
    }

    // Arena Outer borders (Neon Accent)
    ctx.strokeStyle = "rgba(71, 85, 105, 0.5)"; // deep charcoal slate
    ctx.lineWidth = 4;
    ctx.strokeRect(2, 2, CANVAS_WIDTH - 4, CANVAS_HEIGHT - 4);

    // Center Dashed Net Line
    ctx.strokeStyle = "rgba(148, 163, 184, 0.3)";
    ctx.lineWidth = 3;
    ctx.setLineDash([12, 15]);
    ctx.beginPath();
    ctx.moveTo(CANVAS_WIDTH / 2, 0);
    ctx.lineTo(CANVAS_WIDTH / 2, CANVAS_HEIGHT);
    ctx.stroke();
    ctx.setLineDash([]); // Reset line dash

    // --- B. Draw Paddles (Left = Human, Right = AI) ---
    const player = playerPaddleRef.current;
    const ai = aiPaddleRef.current;

    // Left Paddle shadow/glow
    ctx.shadowBlur = 10;
    ctx.shadowColor = player.color;
    ctx.fillStyle = player.color;
    ctx.beginPath();
    ctx.roundRect(player.x, player.y, player.width, player.height, 4);
    ctx.fill();

    // Right Paddle shadow/glow
    ctx.shadowColor = ai.color;
    ctx.fillStyle = ai.color;
    ctx.beginPath();
    ctx.roundRect(ai.x, ai.y, ai.width, ai.height, 4);
    ctx.fill();

    // Reset shadow for trails to maintain high frame rate performance
    ctx.shadowBlur = 0;

    // --- C. Draw Ball Trails & Balls (Real + Phantoms) ---
    ballsRef.current.forEach((ball) => {
      // Color selector
      const ballColor = ball.isPhantom ? PHANTOM_BALL_COLOR : REAL_BALL_COLOR;

      // Draw glowing trail
      if (ball.trail && ball.trail.length > 1) {
        ctx.lineWidth = ball.radius * 1.5;
        ctx.lineCap = "round";

        for (let i = 1; i < ball.trail.length; i++) {
          const pt1 = ball.trail[i - 1];
          const pt2 = ball.trail[i];
          const calculatedOpacity = (i / ball.trail.length) * 0.16 * ball.opacity;
          
          ctx.strokeStyle = ball.isPhantom 
            ? `rgba(255, 0, 127, ${calculatedOpacity})`
            : `rgba(0, 243, 255, ${calculatedOpacity})`;
          
          ctx.beginPath();
          ctx.moveTo(pt1.x, pt1.y);
          ctx.lineTo(pt2.x, pt2.y);
          ctx.stroke();
        }
      }

      // Draw Active Ball Core
      ctx.save();
      ctx.shadowBlur = ball.isPhantom ? 8 : 15;
      ctx.shadowColor = ballColor;
      ctx.fillStyle = ball.isPhantom ? `rgba(255, 0, 127, 0.7)` : ballColor;
      ctx.beginPath();
      ctx.arc(ball.x, ball.y, ball.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    });

    // --- D. Draw Fireworks impact Spark Particles ---
    particlesRef.current.forEach((p) => {
      ctx.save();
      ctx.globalAlpha = p.alpha;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    });

    ctx.restore();
  };

  // Mouse coordinate capturing inside bounds
  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    // Scale factor to map client CSS sizing to 800x500 logical dimensions safely
    const scaleY = CANVAS_HEIGHT / rect.height;
    
    // Relative pointer position inside canvas coordinates
    const relativeY = (e.clientY - rect.top) * scaleY;
    
    mousePositionRef.current.y = relativeY;
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-[92vh] text-slate-100 p-4 font-sans select-none w-full">
      
      {/* Immersive Outer Frame Structure */}
      <div className="w-full max-w-5xl bg-[#050508] text-white flex flex-col items-center justify-between font-sans overflow-hidden relative border-8 border-[#1a1a2e] rounded-xl shadow-2xl shadow-indigo-950/45">
        
        {/* Subtle radial and grid absolute enhancements */}
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,#1a1a2e_0%,#050508_100%)] opacity-50 pointer-events-none"></div>
        <div className="absolute inset-0 opacity-10 pointer-events-none" style={{ backgroundImage: "radial-gradient(#4f46e5 1px, transparent 1px)", backgroundSize: "40px 40px" }}></div>

        {/* Dynamic Alerts Space */}
        <div className="relative w-full">
          <AnimatePresence>
            {doubleScoreAlert && (
              <motion.div
                initial={{ opacity: 0, y: -20, scale: 0.9 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -10, scale: 0.95 }}
                className="absolute left-1/2 -translate-x-1/2 top-4 z-50 bg-rose-500/95 border border-rose-400 px-4 py-2 rounded-xl text-white text-xs font-bold tracking-wider uppercase shadow-lg flex items-center gap-1.5"
              >
                <Flame className="h-4 w-4 text-amber-300 animate-bounce" />
                Phantom Miss: +2 points to AI!
              </motion.div>
            )}

            {phantomAddedAlert && (
              <motion.div
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                className="absolute left-24 bottom-6 z-40 bg-pink-500/90 border border-pink-400 px-3 py-1.5 rounded text-white text-xs font-bold tracking-wider shadow-lg flex items-center gap-1"
              >
                <Sparkles className="h-3 w-3 text-cyan-200 animate-spin" />
                Phantom Clones Active!
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* HUD Scoreboard header */}
        <div className="w-full pt-8 px-12 flex justify-between items-center z-10 select-none">
          {/* Human score side (Indigo style) */}
          <div className="flex flex-col">
            <span className="text-[10px] uppercase tracking-[0.4em] text-indigo-400 font-bold mb-1">
              {mode === "MULTIPLAYER" ? (mpRoomState?.leftName || "Left Player") : "Human Pilot"} 
              {mpRole === "LEFT" && <span className="text-[8px] text-emerald-400 ml-1 ml-1 font-mono">(You)</span>}
            </span>
            <div className="flex items-center gap-4">
              <motion.span
                key={playerScore}
                initial={{ scale: 0.5, opacity: 0, textShadow: "0 0 0px rgba(99,102,241,0)" }}
                animate={{ scale: [1.6, 0.95, 1], opacity: 1, textShadow: ["0 0 35px rgba(99,102,241,1)", "0 0 15px rgba(99,102,241,0.5)", "0 0 0px rgba(99,102,241,0)"] }}
                transition={{ duration: 0.45, ease: "easeOut" }}
                className="text-7xl font-mono leading-none tracking-tighter text-indigo-300 inline-block"
              >
                {playerScore.toString().padStart(2, "0")}
              </motion.span>
              <div className="w-2 h-12 bg-indigo-500"></div>
              {/* Wallet info */}
              <div className="flex flex-col">
                <span className="text-[9px] uppercase tracking-wider text-slate-500">Active Wallet</span>
                <span className="text-sm font-mono font-bold text-emerald-400">
                  ${walletBalance.toFixed(2)}
                </span>
              </div>
            </div>
          </div>

          {/* Hard mode indicators */}
          <div className="flex flex-col items-center">
            {gameState !== "MENU" && (
              <>
                {difficulty === 1 && (
                  <div className="bg-emerald-500/10 border border-emerald-500/50 px-4 py-1 rounded-full mb-1">
                    <span className="text-emerald-400 text-[10px] font-bold uppercase tracking-widest">Level 1: Casual Slow</span>
                  </div>
                )}
                {difficulty === 2 && (
                  <div className="bg-amber-500/10 border border-amber-500/50 px-4 py-1 rounded-full mb-1">
                    <span className="text-amber-400 text-[10px] font-bold uppercase tracking-widest">Level 2: Standard Pitch</span>
                  </div>
                )}
                {difficulty === 3 && (
                  <div className="bg-rose-500/10 border border-rose-500/50 px-4 py-1 rounded-full mb-1">
                    <span className="text-rose-400 text-[10px] font-bold uppercase tracking-widest animate-pulse">Level 3: Phantom Mode</span>
                  </div>
                )}
                
                {mode === "MULTIPLAYER" && (
                  <div className="bg-cyan-500/10 border border-cyan-500/30 px-3 py-0.5 rounded-full mb-2">
                    <span className="text-cyan-400 text-[9px] font-bold uppercase tracking-widest">Room: {mpRoomId}</span>
                  </div>
                )}
                
                {/* STAKES/ESCROW POOL DISPLAY */}
                <div className="mt-1 px-4 py-1.5 bg-amber-500/10 border border-amber-500/30 rounded-xs flex items-center gap-1.5 shadow-[0_0_15px_rgba(245,158,11,0.1)]">
                  <span className="w-1.5 h-1.5 bg-amber-400 rounded-full animate-ping" />
                  <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">STAKES POOL:</span>
                  <span className="text-xs font-mono font-bold text-amber-300">${escrowPool.toFixed(2)}</span>
                </div>

                <div className="text-[11px] text-slate-500 uppercase tracking-widest mt-2 justify-center text-center flex flex-col items-center">
                  <span>First to 10 Wins</span> 
                  {lastRally > 0 && <span className="text-indigo-400 font-mono text-[9px] mt-0.5">Continuous rally: {lastRally} hits</span>}
                  {elapsedSeconds > 0 && <span className="text-cyan-400 font-mono text-[9px] mt-0.5">Session time: {elapsedSeconds}s (Acceleration active)</span>}
                </div>
              </>
            )}
            {gameState === "MENU" && (
              <div className="text-[11px] text-slate-500 uppercase tracking-widest">
                System Awaiting Initialization
              </div>
            )}
          </div>

          {/* Neural computer score side (Rose style) */}
          <div className="flex flex-col items-end">
            <span className="text-[10px] uppercase tracking-[0.4em] text-rose-400 font-bold mb-1">
              {mode === "MULTIPLAYER" ? (mpRoomState?.rightName || "Awaiting Opponent") : "Neural AI"}
              {mpRole === "RIGHT" && <span className="text-[8px] text-emerald-400 ml-1 font-mono">(You)</span>}
            </span>
            <div className="flex items-center gap-4 text-right">
              {/* Reserves info */}
              <div className="flex flex-col items-end">
                <span className="text-[9px] uppercase tracking-wider text-slate-500">
                  {mode === "MULTIPLAYER" ? "Match Opponent" : "AI Reserves"}
                </span>
                <span className="text-sm font-mono font-bold text-rose-400">
                  {mode === "MULTIPLAYER" ? "Ready" : `$${aiWalletBalance.toFixed(2)}`}
                </span>
              </div>
              <div className="w-2 h-12 bg-rose-500"></div>
              <motion.span
                key={aiScore}
                initial={{ scale: 0.5, opacity: 0, textShadow: "0 0 0px rgba(244,63,94,0)" }}
                animate={{ scale: [1.6, 0.95, 1], opacity: 1, textShadow: ["0 0 35px rgba(244,63,94,1)", "0 0 15px rgba(244,63,94,0.5)", "0 0 0px rgba(244,63,94,0)"] }}
                transition={{ duration: 0.45, ease: "easeOut" }}
                className="text-7xl font-mono leading-none tracking-tighter text-rose-300 inline-block"
              >
                {aiScore.toString().padStart(2, "0")}
              </motion.span>
            </div>
          </div>
        </div>

        {/* Dynamic Game stage with active controls overlay */}
        <div className="w-full px-12 py-6 flex items-center justify-center relative">
          
          {/* Subtitle key interactive help on screen during play */}
          {gameState === "PLAYING" && (
            <div className="absolute bottom-10 left-1/2 -translate-x-1/2 z-15 text-[10px] text-slate-400 tracking-wide bg-slate-950/90 px-3 py-1 rounded border border-slate-800 pointer-events-none flex items-center gap-1.5 shadow-md">
              <Info className="h-3 w-3 text-indigo-400" />
              {controlMode === "MOUSE" 
                ? "Move mouse inside arena boundaries to control paddle"
                : "W/S or Arrow Keys to move paddle"}
              <span className="text-slate-500 font-medium ml-1">· ESC or P to Pause</span>
            </div>
          )}

          {/* Interactive HTML5 drawing element */}
          <canvas
            ref={canvasRef}
            width={CANVAS_WIDTH}
            height={CANVAS_HEIGHT}
            onMouseMove={handleMouseMove}
            className={`w-full h-auto aspect-[800/500] max-w-[800px] block transition-transform duration-300 relative border border-white/5 bg-[#050508]/10 rounded shadow-md ${
              controlMode === "MOUSE" && gameState === "PLAYING" ? "cursor-none" : "cursor-default"
            }`}
          />

          {/* MENU SCREEN OVERLAY */}
          <AnimatePresence>
            {gameState === "MENU" && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="absolute inset-0 bg-black/85 backdrop-blur-sm z-30 flex items-center justify-center p-4 overflow-y-auto"
              >
                <div className="w-[500px] max-h-[92%] overflow-y-auto no-scrollbar p-6 bg-[#0a0a14] border border-white/10 shadow-2xl text-center relative rounded-sm">
                  <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 px-6 py-1 bg-indigo-600 font-bold uppercase tracking-[0.3em] text-[10px] text-white">
                    Main Menu
                  </div>
                  
                  <h1 className="text-4xl font-black italic tracking-tighter mb-4 mt-2 bg-gradient-to-b from-white to-slate-500 bg-clip-text text-transparent uppercase">
                    Neon Volley
                  </h1>

                  {/* Mode Selector Tabs */}
                  <div className="grid grid-cols-2 gap-1 mb-5 bg-black/40 p-1 border border-white/5 rounded-xs">
                    <button
                      type="button"
                      onClick={() => {
                        setMode("SOLO");
                        if (soundEnabled) playMenuClickSound();
                      }}
                      className={`py-2 text-[10px] font-bold uppercase tracking-widest rounded-xs transition cursor-pointer ${
                        mode === "SOLO"
                          ? "bg-indigo-600/90 text-white shadow-lg"
                          : "text-slate-400 hover:text-white hover:bg-white/5"
                      }`}
                    >
                      🤖 Solo (Vs AI)
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setMode("MULTIPLAYER");
                        if (soundEnabled) playMenuClickSound();
                      }}
                      className={`py-2 text-[10px] font-bold uppercase tracking-widest rounded-xs transition cursor-pointer ${
                        mode === "MULTIPLAYER"
                          ? "bg-indigo-600/90 text-white shadow-lg"
                          : "text-slate-400 hover:text-white hover:bg-white/5"
                      }`}
                    >
                      ⚡ Online Arena
                    </button>
                  </div>

                  {mode === "SOLO" ? (
                    <>
                      {/* SOLO MODE CONTENT: DIFFICULTY SELECTION */}
                      <div className="flex flex-col gap-2.5">
                        <span className="text-[10px] uppercase tracking-[0.2em] text-slate-400 font-bold text-left block mb-1">
                          Select Difficulty
                        </span>
                        {/* Level 1 Button */}
                        <button
                          id="menu-level-1"
                          onClick={() => { setDifficulty(1); if (soundEnabled) playMenuClickSound(); }}
                          className={`w-full py-3.5 px-5 text-left flex justify-between items-center group transition-all duration-300 border cursor-pointer ${
                            difficulty === 1
                              ? "bg-emerald-600/20 border-emerald-500 text-emerald-100 ring-2 ring-emerald-500/50"
                              : "bg-white/5 border-white/10 hover:bg-white/10 text-white hover:border-white/20"
                          }`}
                        >
                          <span className={`text-[10px] uppercase tracking-widest ${difficulty === 1 ? 'opacity-90 text-emerald-300' : 'opacity-60'}`}>Level 01</span>
                          <span className="font-bold text-sm">CASUAL SLOW</span>
                          <span className={`w-2.5 h-2.5 rounded-full bg-emerald-500 ${difficulty === 1 ? 'shadow-[0_0_12px_#10b981]' : 'opacity-60 group-hover:opacity-100'}`} />
                        </button>

                        {/* Level 2 Button */}
                        <button
                          id="menu-level-2"
                          onClick={() => { setDifficulty(2); if (soundEnabled) playMenuClickSound(); }}
                          className={`w-full py-3.5 px-5 text-left flex justify-between items-center group transition-all duration-300 border cursor-pointer ${
                            difficulty === 2
                              ? "bg-amber-600/20 border-amber-500 text-amber-100 ring-2 ring-amber-500/50"
                              : "bg-white/5 border-white/10 hover:bg-white/10 text-white hover:border-white/20"
                          }`}
                        >
                          <span className={`text-[10px] uppercase tracking-widest ${difficulty === 2 ? 'opacity-90 text-amber-300' : 'opacity-60'}`}>Level 02</span>
                          <span className="font-bold text-sm">STANDARD PITCH</span>
                          <span className={`w-2.5 h-2.5 rounded-full bg-amber-500 ${difficulty === 2 ? 'shadow-[0_0_12px_#f59e0b]' : 'opacity-60 group-hover:opacity-100'}`} />
                        </button>

                        {/* Level 3 Button (Phantom Protocol) */}
                        <button
                          id="menu-level-3"
                          onClick={() => { setDifficulty(3); if (soundEnabled) playMenuClickSound(); }}
                          className={`w-full py-3.5 px-5 text-left flex justify-between items-center group transition-all duration-300 border cursor-pointer ${
                            difficulty === 3
                              ? "bg-indigo-600/25 border-indigo-500 text-indigo-100 ring-2 ring-indigo-500/50"
                              : "bg-white/5 border-white/10 hover:bg-white/10 text-white hover:border-white/20"
                          }`}
                        >
                          <span className={`text-[10px] uppercase tracking-widest ${difficulty === 3 ? 'opacity-90 text-indigo-300' : 'opacity-60'}`}>Level 03</span>
                          <span className="font-bold text-sm">PHANTOM PROTOCOL</span>
                          <div className="flex gap-1">
                            <span className={`w-2 h-2 rounded-full bg-indigo-400 ${difficulty === 3 ? 'animate-pulse' : 'opacity-60'}`} />
                            <span className={`w-2 h-2 rounded-full bg-indigo-400 ${difficulty === 3 ? 'animate-pulse delay-75' : 'opacity-60'}`} />
                          </div>
                        </button>
                      </div>

                      {/* Wager Selection Block */}
                      <div className="mt-5 border-t border-white/5 pt-5 text-left">
                        <span className="text-[10px] uppercase tracking-[0.2em] text-slate-400 font-bold block mb-3">
                          Match Wager Stakes
                        </span>
                        
                        {/* Visual wallet balance readout */}
                        <div className="flex items-center justify-between mb-3 bg-white/5 border border-white/10 p-2.5 rounded-sm">
                          <div className="flex items-center gap-2">
                            <Wallet className="h-4 w-4 text-indigo-400" />
                            <div>
                              <div className="text-[9px] text-slate-500 uppercase tracking-widest font-bold">Your Wallet Balance</div>
                              <div className="text-sm font-bold font-mono text-white">${walletBalance.toFixed(2)}</div>
                            </div>
                          </div>
                          
                          {walletBalance <= 0 && (
                            <button
                              type="button"
                              onClick={claimBailout}
                              className="px-3 py-1 bg-emerald-600/20 hover:bg-emerald-600/40 text-emerald-400 hover:text-white text-[10px] font-bold uppercase tracking-wider border border-emerald-500/30 transition cursor-pointer"
                            >
                              Refill Wallet
                            </button>
                          )}
                        </div>

                        {/* Pre-set Wager buttons */}
                        <div className="grid grid-cols-5 gap-1 mb-2.5">
                          {[5, 10, 25, 50, 100].map((amt) => {
                            const isSelectable = walletBalance >= amt;
                            return (
                              <button
                                key={amt}
                                type="button"
                                disabled={!isSelectable}
                                onClick={() => {
                                  setSelectedWager(amt);
                                  setCustomWagerText(amt.toFixed(2));
                                  if (soundEnabled) playMenuClickSound();
                                }}
                                className={`py-1.5 text-[11px] font-mono font-bold border transition ${
                                  selectedWager === amt
                                    ? "bg-indigo-600 border-indigo-500 text-white"
                                    : isSelectable
                                      ? "bg-white/5 border-white/10 hover:bg-white/10 text-slate-300 hover:text-white cursor-pointer"
                                      : "opacity-35 cursor-not-allowed bg-black/40 border-white/5 text-slate-600"
                                }`}
                              >
                                ${amt}
                              </button>
                            );
                          })}
                        </div>

                        {/* Custom input or summary explanation */}
                        <div className="flex items-center justify-between gap-3 text-slate-400 text-xs">
                          <div className="flex-1 flex items-center justify-between bg-black/45 px-3 py-1.5 border border-white/5 text-[11px]">
                            <span className="text-slate-500 uppercase text-[9px] tracking-widest">Custom Stake</span>
                            <div className="flex items-center">
                              <span className="text-slate-500 mr-0.5">$</span>
                              <input
                                type="number"
                                min="1"
                                max={walletBalance || 1}
                                value={customWagerText}
                                onChange={(e) => {
                                  const rawVal = e.target.value;
                                  setCustomWagerText(rawVal);
                                  const val = parseFloat(rawVal);
                                  if (!isNaN(val) && val > 0) {
                                    if (val <= walletBalance) {
                                      setSelectedWager(val);
                                    } else {
                                      setSelectedWager(walletBalance);
                                    }
                                  }
                                }}
                                className="bg-transparent border-none text-white italic text-right font-mono font-bold outline-hidden focus:ring-0 max-w-[70px] p-0"
                              />
                            </div>
                          </div>
                          
                          <div className="text-right flex flex-col justify-center">
                            <span className="text-slate-500 uppercase text-[9px] tracking-widest block">Matched Escrow Pool</span>
                            <span className="font-bold font-mono text-indigo-300 text-sm">
                              ${(selectedWager * 2).toFixed(2)}
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* Play Trigger */}
                      <button
                        id="initialize-arena-btn"
                        disabled={walletBalance < selectedWager || selectedWager <= 0}
                        onClick={() => startGame(difficulty)}
                        className={`w-full py-4 mt-6 text-xs font-bold uppercase tracking-[0.3em] transition-all shadow-lg flex items-center justify-center gap-2 ${
                          walletBalance >= selectedWager && selectedWager > 0
                            ? "bg-indigo-600 hover:bg-indigo-500 text-white hover:shadow-indigo-500/25 cursor-pointer animate-none"
                            : "bg-slate-800 text-slate-500 cursor-not-allowed border border-white/5"
                        }`}
                      >
                        <Play className="h-4 w-4 fill-current animate-pulse" />
                        {walletBalance >= selectedWager ? "Initialize Arena" : "Insufficient Balance"}
                      </button>
                    </>
                  ) : (
                    <>
                      {/* Live Multiplayer Lobby Configurations */}
                      <div className="text-left border-b border-white/5 pb-4 mb-4">
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <label className="text-[9px] uppercase tracking-wider text-slate-400 font-bold block mb-1">Your Username</label>
                            <input
                              type="text"
                              value={mpPlayerName}
                              onChange={(e) => setMpPlayerName(e.target.value.substring(0, 15))}
                              placeholder="Name"
                              className="w-full bg-white/5 border border-white/10 px-3 py-1.5 rounded-xs text-white text-xs font-mono outline-hidden focus:border-indigo-500 focus:ring-1 focus:ring-indigo-550"
                            />
                          </div>

                          <div>
                            <label className="text-[9px] uppercase tracking-wider text-slate-400 font-bold block mb-1">Room Code</label>
                            <div className="flex gap-1.5">
                              <input
                                type="text"
                                value={mpRoomId}
                                onChange={(e) => setMpRoomId(e.target.value.toUpperCase().substring(0, 6))}
                                placeholder="ROOM"
                                className="w-full bg-white/5 border border-white/10 px-3 py-1.5 rounded-xs text-white text-xs font-mono font-bold tracking-widest text-center outline-hidden focus:border-indigo-550"
                              />
                            </div>
                          </div>
                        </div>

                        {!wsConnected ? (
                          <button
                            type="button"
                            onClick={() => {
                              if (!mpPlayerName.trim() || !mpRoomId.trim()) return;
                              if (soundEnabled) playMenuClickSound();
                              connectToRoom(mpRoomId, mpPlayerName);
                            }}
                            className="w-full py-2.5 mt-3 bg-cyan-600 hover:bg-cyan-500 text-white text-[11px] font-bold uppercase tracking-wider transition cursor-pointer flex items-center justify-center gap-1.5 shadow-sm"
                          >
                            <Sparkles className="h-3.5 w-3.5 text-cyan-200" />
                            Connect to Live Room
                          </button>
                        ) : (
                          <div className="mt-3 flex items-center justify-between gap-2 p-2 bg-emerald-500/10 border border-emerald-500/30 rounded-xs">
                            <div className="flex items-center gap-1.5">
                              <span className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse" />
                              <span className="text-[10px] text-emerald-300 font-bold uppercase tracking-wider">
                                Connected (Assigned: {mpRole})
                              </span>
                            </div>
                            <button
                              type="button"
                              onClick={() => {
                                if (socketRef.current) socketRef.current.close();
                                setWsConnected(false);
                                setMpRole(null);
                                setMpRoomState(null);
                                setMpChatLog([]);
                              }}
                              className="px-2.5 py-1 bg-rose-500/10 hover:bg-rose-550 text-rose-400 hover:text-white text-[9px] font-bold uppercase tracking-wider rounded-xs border border-rose-500/20 cursor-pointer"
                            >
                              Disconnect
                            </button>
                          </div>
                        )}
                      </div>

                      {wsConnected && mpRoomState && (
                        <div className="text-left bg-black/40 p-3.5 border border-white/5 rounded-xs mb-4">
                          <span className="text-[9px] uppercase tracking-wider text-slate-500 font-bold block mb-2">Room Synchronizer Details</span>
                          
                          <div className="grid grid-cols-2 gap-2 text-xs mb-3 font-mono">
                            <div className="bg-[#05050a] p-2 border border-white/5 flex flex-col justify-between">
                              <span className="text-[8px] text-slate-500 uppercase">Left Player (Host)</span>
                              <span className={`font-bold mt-1 overflow-hidden text-ellipsis ${mpRoomState.leftOnline ? 'text-indigo-300' : 'text-slate-600'}`}>
                                {mpRoomState.leftName || "Empty Lobby"}
                              </span>
                            </div>
                            <div className="bg-[#05050a] p-2 border border-white/5 flex flex-col justify-between">
                              <span className="text-[8px] text-slate-500 uppercase">Right Player (Guest)</span>
                              <span className={`font-bold mt-1 overflow-hidden text-ellipsis ${mpRoomState.rightOnline ? 'text-rose-300' : 'text-slate-600'}`}>
                                {mpRoomState.rightName || "Awaiting Peer..."}
                              </span>
                            </div>
                          </div>

                          {/* Live Chat Segment */}
                          <div className="mt-3">
                            <span className="text-[9px] uppercase tracking-widest text-slate-500 font-bold block mb-1">Live Arena Chat</span>
                            <div className="h-28 bg-[#050508]/90 p-2 rounded-xs border border-white/5 overflow-y-auto mb-2 text-[10px] font-mono flex flex-col gap-1 select-text">
                              {mpChatLog.length === 0 ? (
                                <span className="text-slate-600 italic">No chat messages yet. Type below to say hello!</span>
                              ) : (
                                mpChatLog.map((chatVal, kVal) => (
                                  <div key={kVal} className="break-all">
                                    <span className={`font-bold ${chatVal.role === "LEFT" ? 'text-indigo-400' : 'text-rose-400'}`}>
                                      [{chatVal.sender}]
                                    </span>
                                    <span className="text-slate-300 ml-1.5">{chatVal.text}</span>
                                  </div>
                                ))
                              )}
                            </div>
                            <div className="flex gap-1.5">
                              <input
                                type="text"
                                value={mpChatText}
                                onChange={(e) => setMpChatText(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") {
                                    sendMpChat();
                                  }
                                }}
                                placeholder="Message match room..."
                                className="w-full bg-white/5 border border-white/10 px-2.5 py-1 text-xs text-white rounded-xs outline-hidden"
                              />
                              <button
                                type="button"
                                onClick={sendMpChat}
                                className="bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-[10px] uppercase tracking-wider px-3 rounded-xs cursor-pointer"
                              >
                                Send
                              </button>
                            </div>
                          </div>

                          {/* Multiplayer Stakes / Wager section */}
                          <div className="mt-4 pt-3 border-t border-white/5">
                            <span className="text-[9px] uppercase tracking-wider text-slate-400 font-bold block mb-2">Sync Match Stake</span>
                            <div className="flex items-center justify-between gap-4">
                              {mpRole === "LEFT" ? (
                                <div className="grid grid-cols-4 gap-1 flex-1">
                                  {[5, 10, 25, 50].map((vamt) => (
                                    <button
                                      key={vamt}
                                      type="button"
                                      onClick={() => {
                                        setSelectedWager(vamt);
                                        setCustomWagerText(vamt.toFixed(2));
                                        sendWsMessage({ type: "wager_sync", wager: vamt });
                                        if (soundEnabled) playMenuClickSound();
                                      }}
                                      className={`py-1 text-[10px] font-mono font-bold border transition rounded-sm ${
                                        selectedWager === vamt
                                          ? "bg-indigo-600 border-indigo-500 text-white"
                                          : "bg-white/5 border-white/10 hover:bg-white/10 text-slate-300"
                                      }`}
                                    >
                                      ${vamt}
                                    </button>
                                  ))}
                                </div>
                              ) : (
                                <div className="text-slate-400 text-[11px] font-mono">
                                  Host Wager: <span className="text-amber-400 font-bold">${selectedWager.toFixed(2)}</span> (Locked stake auto-matches)
                                </div>
                              )}

                              <div className="text-right">
                                <span className="text-[8px] text-slate-500 uppercase tracking-widest block">Lobby Pot</span>
                                <span className="font-bold font-mono text-cyan-300 text-xs">${(selectedWager * 2).toFixed(2)}</span>
                              </div>
                            </div>
                          </div>

                          {/* Start triggering for Host */}
                          <div className="mt-4 pt-3">
                            {mpRole === "LEFT" ? (
                              <div>
                                <div className="flex justify-between items-center mb-3">
                                  <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wide">Select Difficulty</span>
                                  <div className="flex gap-1.5">
                                    {[1, 2, 3].map((lv) => (
                                      <button
                                        key={lv}
                                        type="button"
                                        onClick={() => {
                                          setDifficulty(lv);
                                          if (soundEnabled) playMenuClickSound();
                                        }}
                                        className={`px-2 py-0.5 font-mono text-[9px] font-bold border rounded-xs transition ${
                                          difficulty === lv
                                            ? "bg-indigo-600 text-white border-indigo-500"
                                            : "bg-white/5 border-white/10 text-slate-400 hover:text-white"
                                        }`}
                                      >
                                        Lvl {lv}
                                      </button>
                                    ))}
                                  </div>
                                </div>

                                <button
                                  type="button"
                                  disabled={walletBalance < selectedWager || !mpRoomState.rightOnline}
                                  onClick={() => startGame(difficulty)}
                                  className={`w-full py-3 text-xs font-bold uppercase tracking-[0.2em] transition-all flex items-center justify-center gap-1.5 shadow-md ${
                                    walletBalance >= selectedWager && mpRoomState.rightOnline
                                      ? "bg-emerald-600 hover:bg-emerald-500 text-white cursor-pointer"
                                      : "bg-slate-800 text-slate-500 cursor-not-allowed border border-white/5"
                                  }`}
                                >
                                  <Play className="h-3.5 w-3.5 text-white" />
                                  {!mpRoomState.rightOnline ? "Awaiting player 2..." : "Kickstart Live Arena Match"}
                                </button>
                              </div>
                            ) : (
                              <div className="p-3 bg-indigo-950/40 text-indigo-300 text-xs text-center border border-indigo-500/30 rounded-xs flex items-center justify-center gap-2 font-bold uppercase tracking-wider animate-pulse">
                                <span className="h-2 w-2 bg-indigo-400 rounded-full animate-ping" />
                                Waiting for Host {mpRoomState.leftName || 'Player 1'} to Start match
                              </div>
                            )}
                          </div>
                        </div>
                      )}

                      {!wsConnected && (
                        <div className="text-center p-6 border border-dashed border-white/15 bg-black/10 rounded-sm">
                          <p className="text-[11px] text-slate-400 uppercase tracking-widest font-mono">
                            Online multiplayer mode requires direct socket linkage! Enter room and name above to connect.
                          </p>
                        </div>
                      )}
                    </>
                  )}

                  {/* Best Score Counter in main menu */}
                  <div className="mt-5 flex justify-center gap-1.5 items-center text-[10px] uppercase tracking-wider text-slate-500">
                    <Trophy className="h-3.5 w-3.5 text-amber-500" />
                    <span>Best Rally Score:</span>
                    <span className="text-indigo-400 font-extrabold font-mono">{bestRally} hits</span>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* PAUSED GAME SCREEN OVERLAY */}
          <AnimatePresence>
            {gameState === "PAUSED" && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="absolute inset-0 bg-black/80 backdrop-blur-sm z-30 flex items-center justify-center p-4 text-center"
              >
                <div className="w-[380px] p-8 bg-[#0a0a14] border border-white/10 shadow-2xl relative rounded-sm">
                  <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 px-6 py-2 bg-indigo-600 font-bold uppercase tracking-[0.3em] text-[10px] text-white">
                    Pause Mode
                  </div>

                  <Pause className="h-10 w-10 text-indigo-400 mx-auto mb-4 mt-2 animate-pulse" />
                  <h3 className="text-2xl font-black uppercase tracking-tight text-white italic mb-2">Arena Suspended</h3>
                  <p className="text-xs text-slate-400 mb-6 uppercase tracking-wider">
                    Press ESC or P key to resume play.
                  </p>

                  <div className="flex flex-col gap-3">
                    <button
                      id="resume-game-btn"
                      onClick={togglePause}
                      className="w-full py-3 bg-indigo-500 hover:bg-indigo-400 text-white text-xs font-bold uppercase tracking-[0.25em] transition cursor-pointer"
                    >
                      Resume Match
                    </button>
                    <button
                      id="quit-game-btn"
                      onClick={() => {
                        if (mode === "MULTIPLAYER") {
                          if (socketRef.current) socketRef.current.close();
                          setWsConnected(false);
                          setMpRole(null);
                          setMpRoomState(null);
                        } else {
                          updateAiBalanceWithStorage(aiWalletBalance + escrowPool);
                        }
                        setEscrowPool(0);
                        setGameState("MENU");
                        handleMenuClick();
                      }}
                      className="w-full py-3 bg-white/5 hover:bg-white/10 text-slate-300 text-xs font-bold uppercase tracking-[0.25em] border border-white/10 transition cursor-pointer"
                    >
                      Abandon Arena
                    </button>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* GAME OVER FINISH SCREEN OVERLAY */}
          <AnimatePresence>
            {gameState === "GAMEOVER" && (() => {
              const isMpWinner = mode === "MULTIPLAYER" && (
                (winner === "PLAYER" && mpRole === "LEFT") || 
                (winner === "AI" && mpRole === "RIGHT")
              );
              const isSoloWinner = mode === "SOLO" && winner === "PLAYER";
              const isWinnerFlag = isMpWinner || isSoloWinner;

              return (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="absolute inset-0 bg-black/85 backdrop-blur-sm z-30 flex items-center justify-center p-4"
                >
                  <motion.div
                    initial={{ scale: 0.95, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ type: "spring", stiffness: 120 }}
                    className="w-[450px] p-10 bg-[#0a0a14] border border-white/10 shadow-2xl text-center relative rounded-sm"
                  >
                    <div className={`absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 px-6 py-2 font-bold uppercase tracking-[0.3em] text-[10px] text-white ${
                      isWinnerFlag ? "bg-emerald-600" : "bg-rose-600"
                    }`}>
                      {isWinnerFlag ? "Victory" : "Defeat"}
                    </div>

                    {isWinnerFlag ? (
                      <div className="mb-6 mt-2">
                        <div className="h-16 w-16 bg-emerald-500/10 text-emerald-400 rounded-full border border-emerald-500/30 flex items-center justify-center mx-auto mb-4 text-3xl">
                          🏆
                        </div>
                        <h3 className="text-3xl font-black uppercase text-emerald-400 tracking-tight italic">Mission Cleared</h3>
                        <p className="text-slate-400 text-xs mt-2">
                          {mode === "MULTIPLAYER" 
                            ? `You successfully secured the arena with a score of ${mpRole === "LEFT" ? playerScore : aiScore} to ${mpRole === "LEFT" ? aiScore : playerScore}!`
                            : `You successfully neutralized the neural computer with ${playerScore} to ${aiScore}.`}
                        </p>
                      </div>
                    ) : (
                      <div className="mb-6 mt-2">
                        <div className="h-16 w-16 bg-rose-500/10 text-rose-400 rounded-full border border-rose-500/30 flex items-center justify-center mx-auto mb-4 text-3xl">
                          🤖
                        </div>
                        <h3 className="text-3xl font-black uppercase text-rose-500 tracking-tight italic">System Overridden</h3>
                        <p className="text-slate-400 text-xs mt-2">
                          {mode === "MULTIPLAYER" 
                            ? `Your opponent won the match with a score of ${mpRole === "RIGHT" ? playerScore : aiScore} to ${mpRole === "RIGHT" ? aiScore : playerScore}.`
                            : `Neural AI captured the arena with ${aiScore} to ${playerScore}.`}
                        </p>
                      </div>
                    )}

                    {/* Highlights Summary HUD panel */}
                    <div className="grid grid-cols-2 gap-4 mb-6 bg-black/40 p-4 border border-white/5 rounded text-left">
                      <div className="flex flex-col">
                        <span className="text-[9px] text-slate-500 uppercase font-bold tracking-widest">Stakes Pool</span>
                        <span className="text-sm font-mono font-extrabold text-amber-300">
                          ${(selectedWager * 2).toFixed(2)}
                        </span>
                      </div>
                      <div className="flex flex-col items-end text-right">
                        <span className="text-[9px] text-slate-500 uppercase font-bold tracking-widest">Payout Distributed</span>
                        <span className={`text-sm font-bold uppercase tracking-wider font-mono ${
                          isWinnerFlag ? "text-emerald-400" : "text-rose-500"
                        }`}>
                          {isWinnerFlag ? `+$${(selectedWager * 2).toFixed(2)}` : "+$0.00"}
                        </span>
                      </div>
                      <div className="col-span-2 border-t border-white/5 pt-2 flex justify-between items-center text-xs">
                        <span className="text-[9px] text-slate-500 uppercase tracking-widest font-bold">Your Wallet Balance</span>
                        <span className="font-mono font-bold text-white text-sm">
                          ${walletBalance.toFixed(2)}
                        </span>
                      </div>
                    </div>

                    <div className="flex flex-col gap-3">
                      <button
                        id="play-again-btn"
                        disabled={mode === "MULTIPLAYER" && mpRole === "RIGHT" && wsConnected}
                        onClick={restartPlay}
                        className={`w-full py-3.5 text-xs font-bold uppercase tracking-[0.25em] transition shadow-md cursor-pointer ${
                          mode === "MULTIPLAYER" && mpRole === "RIGHT" && wsConnected
                            ? "bg-slate-800 text-slate-500 cursor-not-allowed border border-white/5"
                            : "bg-indigo-600 hover:bg-indigo-500 text-white hover:border-indigo-400"
                        }`}
                      >
                        {mode === "MULTIPLAYER" && mpRole === "RIGHT" && wsConnected
                          ? "Waiting for Host Rematch"
                          : "Initialize Rematch"}
                      </button>
                      <button
                        id="gameover-main-menu-btn"
                        onClick={() => { setGameState("MENU"); handleMenuClick(); }}
                        className="w-full py-3.5 bg-white/5 hover:bg-white/10 text-slate-300 text-xs font-bold uppercase tracking-[0.25em] border border-white/10 transition cursor-pointer"
                      >
                        Return to Menu
                      </button>
                    </div>
                  </motion.div>
                </motion.div>
              );
            })()}
          </AnimatePresence>

        </div>

        {/* Immersive Footer layout bar integrated on bottom of the screen */}
        <div className="w-full h-16 border-t border-white/5 bg-black/40 flex items-center justify-between px-12 z-10 text-slate-500">
          <div className="flex gap-8 text-[10px] font-bold uppercase tracking-widest">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 bg-indigo-400 rounded-full" />
              {controlMode === "MOUSE" ? "Mouse to Move" : "Arrows / W-S to Move"}
            </div>
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 bg-slate-400 rounded-full" />
              ESC / P to Pause
            </div>
          </div>

          <div className="flex items-center gap-6">
            {/* Control mode switcher */}
            <button
              id="bar-toggle-control"
              onClick={() => { setControlMode(controlMode === "MOUSE" ? "KEYBOARD" : "MOUSE"); handleMenuClick(); }}
              className="text-[10px] font-bold text-slate-400 hover:text-white uppercase tracking-[0.15em] transition flex items-center gap-1.5 bg-white/5 hover:bg-white/10 px-2 py-1 border border-white/5 cursor-pointer rounded-xs"
            >
              Mode: {controlMode}
            </button>

            {/* Audio Toggle button */}
            <button
              id="bar-toggle-mute"
              onClick={toggleMute}
              className="text-[10px] font-bold text-slate-400 hover:text-white uppercase tracking-[0.15em] transition flex items-center gap-1.5 bg-white/5 hover:bg-white/10 px-2.5 py-1 border border-white/5 cursor-pointer rounded-xs"
            >
              {soundEnabled ? "SFX: ON" : "SFX: MUTED"}
            </button>

            <div className="text-[10px] font-bold text-indigo-400 uppercase tracking-widest flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />
              Systems Nominal: 60 FPS
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
