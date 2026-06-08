import PingPongGame from "./components/PingPongGame";

export default function App() {
  return (
    <div className="relative min-h-screen w-full bg-[#050508] flex items-center justify-center overflow-x-hidden select-none text-slate-100 p-4">
      {/* Main Game Screen */}
      <main className="w-full flex items-center justify-center">
        <PingPongGame />
      </main>
    </div>
  );
}
