export type GameDifficulty = 1 | 2 | 3;

export type GameState = "MENU" | "PLAYING" | "PAUSED" | "GAMEOVER";

export interface Ball {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  isPhantom: boolean;
  opacity: number; // For fading trails or phantom balls
  trail: { x: number; y: number }[];
}

export interface Paddle {
  x: number;
  y: number;
  width: number;
  height: number;
  score: number;
  color: string;
}

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  color: string;
  alpha: number;
  decay: number;
}

export interface GameSettings {
  difficulty: GameDifficulty;
  controlMode: "MOUSE" | "KEYBOARD";
}
