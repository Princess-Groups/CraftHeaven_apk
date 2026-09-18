import { PrintAgent } from "./print-agent.js";

// Start the Print Agent
const agent = new PrintAgent();
agent.start().catch((error) => {
  console.error("Failed to start Print Agent:", error);
  process.exit(1);
});

// Graceful shutdown
process.on("SIGINT", async () => {
  console.log("Shutting down Print Agent...");
  process.exit(0);
});

process.on("SIGTERM", async () => {
  console.log("Shutting down Print Agent...");
  process.exit(0);
});