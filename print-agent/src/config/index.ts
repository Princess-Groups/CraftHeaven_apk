import { z } from "zod";

export const PrinterConfigSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.enum(["usb", "serial", "network", "windows"]),
  // USB
  vendorId: z.number().optional(),
  productId: z.number().optional(),
  // Serial
  port: z.string().optional(),
  baudRate: z.number().default(9600).optional(),
  // Network
  ip: z.string().optional(),
  portNumber: z.number().default(9100).optional(),
  // Windows
  windowsPrinterName: z.string().optional(),
  // Common
  paperWidth: z.enum(["58mm", "80mm"]).default("80mm"),
  profile: z.enum(["escpos", "windows"]).default("escpos"),
  isDefault: z.boolean().default(false),
});

export const AgentConfigSchema = z.object({
  port: z.number().default(3030),
  host: z.string().default("127.0.0.1"),
  printers: z.array(PrinterConfigSchema).default([]),
  logLevel: z.enum(["debug", "info", "warn", "error"]).default("info"),
  autoReconnect: z.boolean().default(true),
  reconnectInterval: z.number().default(5000),
  jobRetentionDays: z.number().default(30),
});

export type PrinterConfig = z.infer<typeof PrinterConfigSchema>;
export type AgentConfig = z.infer<typeof AgentConfigSchema>;

export const DEFAULT_CONFIG: AgentConfig = {
  port: 3030,
  host: "127.0.0.1",
  printers: [],
  logLevel: "info",
  autoReconnect: true,
  reconnectInterval: 5000,
  jobRetentionDays: 30,
};

export function loadConfig(): AgentConfig {
  const fs = require("fs");
  const path = require("path");
  const configPath = path.join(process.cwd(), "config.json");

  if (fs.existsSync(configPath)) {
    try {
      const content = fs.readFileSync(configPath, "utf-8");
      const parsed = JSON.parse(content);
      return AgentConfigSchema.parse(parsed);
    } catch (e) {
      console.error("Failed to load config, using defaults:", e);
    }
  }
  return DEFAULT_CONFIG;
}

export function saveConfig(config: AgentConfig): void {
  const fs = require("fs");
  const path = require("path");
  const configPath = path.join(process.cwd(), "config.json");
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
}