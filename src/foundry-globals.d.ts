declare const Hooks: {
  once(event: "init" | "ready", callback: () => void): void;
  on(event: "userConnected", callback: (user: unknown, connected: boolean) => void): number;
};
