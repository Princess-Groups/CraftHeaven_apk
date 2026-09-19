/**
 * Device Manager - Discovers and manages printers
 */

import { EventEmitter } from "events";
import { PrinterConfig, AgentConfig } from "../config/index.js";
import { usb as usbInstance } from "usb";
import { SerialPort } from "serialport";
import net from "net";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

type UsbPrintingDevice = Awaited<ReturnType<typeof usbInstance.getDevices>>[number];

export interface DiscoveredPrinter {
  id: string;
  name: string;
  type: "usb" | "serial" | "network" | "windows";
  connection: {
    // USB
    vendorId?: number;
    productId?: number;
    device?: UsbPrintingDevice;
    // Serial
    port?: string;
    baudRate?: number;
    // Network
    ip?: string;
    portNumber?: number;
    // Windows
    windowsPrinterName?: string;
  };
  status: "unknown" | "connected" | "disconnected" | "error";
  paperWidth?: "58mm" | "80mm";
  labelWidth?: number;
  labelHeight?: number;
  capabilities?: string[];
}

export class DeviceManager extends EventEmitter {
  private config: AgentConfig;
  private printers: Map<string, DiscoveredPrinter> = new Map();
  private usbDevices: Map<string, UsbPrintingDevice> = new Map();
  private serialPorts: Map<string, SerialPort> = new Map();
  private networkConnections: Map<string, net.Socket> = new Map();
  private reconnectTimers: Map<string, NodeJS.Timeout> = new Map();

  constructor(config: AgentConfig) {
    super();
    this.config = config;
  }

  // Discover all available printers
  async discover(): Promise<DiscoveredPrinter[]> {
    const discovered: DiscoveredPrinter[] = [];

    // Discover USB printers (ESC/POS compatible)
    const usbPrinters = await this.discoverUSB();
    discovered.push(...usbPrinters);

    // Discover serial ports
    const serialPrinters = await this.discoverSerial();
    discovered.push(...serialPrinters);

    // Discover network printers (common ports 9100, 6101, 515)
    const networkPrinters = await this.discoverNetwork();
    discovered.push(...networkPrinters);

    // Discover Windows printers
    const windowsPrinters = await this.discoverWindows();
    discovered.push(...windowsPrinters);

    // Update internal map
    for (const printer of discovered) {
      this.printers.set(printer.id, printer);
    }

    this.emit("discovered", discovered);
    return discovered;
  }

  // Discover USB ESC/POS printers
  private async discoverUSB(): Promise<DiscoveredPrinter[]> {
    const printers: DiscoveredPrinter[] = [];

    try {
      const devices = await usbInstance.getDevices();

      for (const device of devices) {
        const vid = device.vendorId;
        const pid = device.productId;

        // Check if it's a known printer class (0x07) or known vendor/product
        const isPrinterClass = device.deviceClass === 0x07;
        const isKnownPrinter = this.isKnownPrinterVendor(vid, pid);

        if (isPrinterClass || isKnownPrinter) {
          const id = `usb-${vid.toString(16).padStart(4, "0")}-${pid.toString(16).padStart(4, "0")}`;
          const printer: DiscoveredPrinter = {
            id,
            name: `USB Printer (${vid.toString(16)}:${pid.toString(16)})`,
            type: "usb",
            connection: {
              vendorId: vid,
              productId: pid,
              device,
            },
            status: "connected",
            paperWidth: "80mm",
            capabilities: ["escpos", "cut", "cash-drawer"],
          };

          this.usbDevices.set(id, device);
          printers.push(printer);
        }
      }
    } catch (e) {
      console.error("USB discovery error:", e);
    }

    return printers;
  }

  // Known thermal printer vendors
  private isKnownPrinterVendor(vid: number, pid: number): boolean {
    const knownVendors: Record<number, number[]> = {
      0x0416: [0x5011], // Epson
      0x04b8: [0x0202, 0x0e15, 0x0e1f], // Epson
      0x0456: [0x0808], // Citizen
      0x0dd4: [0x0101], // Custom
      0x0525: [0xa700], // Generic USB printer
      0x1fc9: [0x2016], // Zijiang / Zjiang
      0x1e8d: [0x0011], // Xprinter
      0x0483: [0x5740], // STM32 virtual COM (common for cheap thermal)
      0x28e9: [0x0289], // Gprinter
      0x1a86: [0x7523], // CH340/CH341 USB-Serial (many thermal printers)
      0x067b: [0x2303], // Prolific USB-Serial
      0x10c4: [0xea60], // Silicon Labs CP210x
      0x0403: [0x6001], // FTDI
    };

    return knownVendors[vid]?.includes(pid) ?? false;
  }

  // Discover serial ports
  private async discoverSerial(): Promise<DiscoveredPrinter[]> {
    const printers: DiscoveredPrinter[] = [];

    try {
      const ports = await SerialPort.list();

      for (const port of ports) {
        // Skip Bluetooth, modem, etc.
        if (port.manufacturer?.toLowerCase().includes("bluetooth") ||
            port.path.includes("Bluetooth") ||
            port.path.includes("Modem")) {
          continue;
        }

        const id = `serial-${port.path.replace(/[^a-zA-Z0-9]/g, "-")}`;
        const printer: DiscoveredPrinter = {
          id,
          name: `Serial Port (${port.path}${port.manufacturer ? ` - ${port.manufacturer}` : ""})`,
          type: "serial",
          connection: {
            port: port.path,
            baudRate: 9600,
          },
          status: "unknown",
          paperWidth: "80mm",
          capabilities: ["escpos", "cut"],
        };

        printers.push(printer);
      }
    } catch (e) {
      console.error("Serial discovery error:", e);
    }

    return printers;
  }

  // Discover network printers
  private async discoverNetwork(): Promise<DiscoveredPrinter[]> {
    const printers: DiscoveredPrinter[] = [];
    const commonIPs = this.getLocalNetworkIPs();
    const commonPorts = [9100, 6101, 515, 23]; // JetDirect, IPP, LPR, Telnet

    for (const ip of commonIPs) {
      for (const port of commonPorts) {
        try {
          const connected = await this.testTCPConnection(ip, port, 200);
          if (connected) {
            const id = `network-${ip}-${port}`;
            const printer: DiscoveredPrinter = {
              id,
              name: `Network Printer (${ip}:${port})`,
              type: "network",
              connection: {
                ip,
                portNumber: port,
              },
              status: "connected",
              paperWidth: "80mm",
              capabilities: ["escpos", "cut"],
            };
            printers.push(printer);
          }
        } catch {
          // Ignore connection failures
        }
      }
    }

    return printers;
  }

  private getLocalNetworkIPs(): string[] {
    const ips: string[] = [];
    try {
      const { networkInterfaces } = require("os");
      const nets = networkInterfaces();

      for (const name of Object.keys(nets)) {
        for (const net of nets[name]) {
          if (net.family === "IPv4" && !net.internal) {
            // Add the base network (e.g., 192.168.1.x)
            const parts = net.address.split(".");
            if (parts.length === 4) {
              const base = `${parts[0]}.${parts[1]}.${parts[2]}.`;
              // Scan a small range of the subnet (avoid slow full /24 sweep on startup)
              for (let i = 1; i <= 10; i++) {
                ips.push(`${base}${i}`);
              }
              break; // Just first interface
            }
          }
        }
      }
    } catch {}

    // Add localhost for testing
    ips.unshift("127.0.0.1");
    return ips;
  }

  private async testTCPConnection(ip: string, port: number, timeout: number): Promise<boolean> {
    return new Promise((resolve) => {
      const socket = net.createConnection({ host: ip, port, timeout });
      socket.on("connect", () => {
        socket.destroy();
        resolve(true);
      });
      socket.on("timeout", () => {
        socket.destroy();
        resolve(false);
      });
      socket.on("error", () => {
        resolve(false);
      });
    });
  }

  // Discover Windows printers
  private async discoverWindows(): Promise<DiscoveredPrinter[]> {
    const printers: DiscoveredPrinter[] = [];

    try {
      // Use PowerShell to get installed printers
      const { stdout } = await execAsync(
        'powershell -Command "Get-Printer | Select-Object Name, DriverName, PortName, PrinterStatus, WorkOffline | ConvertTo-Json"'
      );

      const winPrinters = JSON.parse(stdout);
      const printerArray = Array.isArray(winPrinters) ? winPrinters : [winPrinters];

      for (const wp of printerArray) {
        if (!wp.Name) continue;

        const id = `windows-${wp.Name.replace(/[^a-zA-Z0-9]/g, "-")}`;
        const isOffline = wp.WorkOffline === true;
        const status = isOffline ? "disconnected" : (wp.PrinterStatus === 3 ? "connected" : "unknown");

        const printer: DiscoveredPrinter = {
          id,
          name: wp.Name,
          type: "windows",
          connection: {
            windowsPrinterName: wp.Name,
          },
          status,
          paperWidth: this.guessPaperWidth(wp.Name),
          capabilities: ["windows", "cut"],
        };

        printers.push(printer);
      }
    } catch (e) {
      console.error("Windows printer discovery error:", e);
    }

    return printers;
  }

  private guessPaperWidth(name: string): "58mm" | "80mm" {
    const lower = name.toLowerCase();
    if (lower.includes("58") || lower.includes("2 inch") || lower.includes("2in")) {
      return "58mm";
    }
    return "80mm";
  }

  // Get configured printers
  getConfiguredPrinters(): DiscoveredPrinter[] {
    return this.config.printers.map(p => this.toDiscovered(p));
  }

  private toDiscovered(cfg: PrinterConfig): DiscoveredPrinter {
    const discovered = this.printers.get(cfg.id);
    return {
      id: cfg.id,
      name: cfg.name,
      type: cfg.type,
      status: discovered?.status ?? "unknown",
      paperWidth: cfg.paperWidth,
      connection: {
        vendorId: cfg.vendorId,
        productId: cfg.productId,
        port: cfg.port,
        baudRate: cfg.baudRate,
        ip: cfg.ip,
        portNumber: cfg.portNumber,
        windowsPrinterName: cfg.windowsPrinterName,
      },
      capabilities: cfg.type === "windows" ? ["windows", "cut"] : ["escpos", "cut"],
    };
  }

  // Resolve a printer by id (discovered first, then configured)
  private resolvePrinter(id: string): DiscoveredPrinter | undefined {
    const discovered = this.printers.get(id);
    if (discovered) return discovered;
    const cfg = this.config.printers.find(p => p.id === id);
    return cfg ? this.toDiscovered(cfg) : undefined;
  }

  // Add/update printer config
  async addPrinter(config: PrinterConfig): Promise<void> {
    this.config.printers = this.config.printers.filter(p => p.id !== config.id);
    this.config.printers.push(config);

    // Save to disk
    const { saveConfig } = await import("../config/index.js");
    saveConfig(this.config);

    this.emit("printer-added", config);
  }

  async removePrinter(id: string): Promise<void> {
    this.config.printers = this.config.printers.filter(p => p.id !== id);
    const { saveConfig } = await import("../config/index.js");
    saveConfig(this.config);

    // Close any open connections
    await this.disconnect(id);

    this.emit("printer-removed", id);
  }

  async setDefaultPrinter(id: string): Promise<void> {
    for (const p of this.config.printers) {
      p.isDefault = p.id === id;
    }
    const { saveConfig } = await import("../config/index.js");
    saveConfig(this.config);
    this.emit("default-changed", id);
  }

  // Get default printer
  getDefaultPrinter(): PrinterConfig | undefined {
    return this.config.printers.find(p => p.isDefault) || this.config.printers[0];
  }

  // Connect to a printer
  async connect(id: string): Promise<boolean> {
    const printer = this.resolvePrinter(id);
    if (!printer) return false;

    try {
      switch (printer.type) {
        case "usb":
          return await this.connectUSB(printer);
        case "serial":
          return await this.connectSerial(printer);
        case "network":
          return await this.connectNetwork(printer);
        case "windows":
          return true; // Windows printers don't need persistent connection
      }
    } catch (e) {
      console.error(`Failed to connect to ${id}:`, e);
      printer.status = "error";
      this.emit("status-change", { id, status: "error", error: String(e) });
      return false;
    }
    return false;
  }

  private async connectUSB(printer: DiscoveredPrinter): Promise<boolean> {
    if (!printer.connection.vendorId || !printer.connection.productId) return false;

    try {
      let device = this.usbDevices.get(printer.id) || printer.connection.device;
      if (!device) {
        device = await usbInstance.findDeviceByIds(printer.connection.vendorId, printer.connection.productId);
        if (!device) return false;
        this.usbDevices.set(printer.id, device);
      }

      if (!device.opened) {
        await device.open();
      }
      try {
        await device.claimInterface(0);
      } catch {
        // Interface may already be claimed by another call
      }

      printer.connection.device = device;
      printer.status = "connected";
      this.emit("status-change", { id: printer.id, status: "connected" });
      return true;
    } catch (e) {
      printer.status = "error";
      this.emit("status-change", { id: printer.id, status: "error", error: String(e) });
      return false;
    }
  }

  private async connectSerial(printer: DiscoveredPrinter): Promise<boolean> {
    if (!printer.connection.port) return false;

    try {
      const port = new SerialPort({
        path: printer.connection.port,
        baudRate: printer.connection.baudRate || 9600,
        autoOpen: false,
      });

      await new Promise<void>((resolve, reject) => {
        port.open((err) => {
          if (err) reject(err);
          else resolve();
        });
      });

      this.serialPorts.set(printer.id, port);
      printer.status = "connected";
      this.emit("status-change", { id: printer.id, status: "connected" });
      return true;
    } catch (e) {
      printer.status = "error";
      this.emit("status-change", { id: printer.id, status: "error", error: String(e) });
      return false;
    }
  }

  private async connectNetwork(printer: DiscoveredPrinter): Promise<boolean> {
    if (!printer.connection.ip || !printer.connection.portNumber) return false;

    try {
      const socket = net.createConnection({
        host: printer.connection.ip,
        port: printer.connection.portNumber,
      });

      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("Timeout")), 5000);
        socket.on("connect", () => {
          clearTimeout(timeout);
          resolve();
        });
        socket.on("error", (err) => {
          clearTimeout(timeout);
          reject(err);
        });
      });

      this.networkConnections.set(printer.id, socket);
      printer.status = "connected";
      this.emit("status-change", { id: printer.id, status: "connected" });

      // Auto-reconnect
      socket.on("close", () => {
        printer.status = "disconnected";
        this.emit("status-change", { id: printer.id, status: "disconnected" });
        if (this.config.autoReconnect) {
          this.scheduleReconnect(printer.id);
        }
      });

      return true;
    } catch (e) {
      printer.status = "error";
      this.emit("status-change", { id: printer.id, status: "error", error: String(e) });
      return false;
    }
  }

  private scheduleReconnect(id: string): void {
    if (this.reconnectTimers.has(id)) return;

    const timer = setTimeout(async () => {
      this.reconnectTimers.delete(id);
      const printer = this.printers.get(id);
      if (printer) {
        await this.connect(id);
      }
    }, this.config.reconnectInterval);

    this.reconnectTimers.set(id, timer);
  }

  // Disconnect from printer
  async disconnect(id: string): Promise<void> {
    const printer = this.printers.get(id);
    if (!printer) return;

    // Clear reconnect timer
    const timer = this.reconnectTimers.get(id);
    if (timer) {
      clearTimeout(timer);
      this.reconnectTimers.delete(id);
    }

    try {
      switch (printer.type) {
        case "usb": {
          const device = this.usbDevices.get(id);
          if (device) {
            try { await device.close(); } catch {}
            this.usbDevices.delete(id);
          }
          break;
        }
        case "serial": {
          const port = this.serialPorts.get(id);
          if (port) {
            await new Promise<void>((resolve) => port.close(() => resolve()));
            this.serialPorts.delete(id);
          }
          break;
        }
        case "network": {
          const socket = this.networkConnections.get(id);
          if (socket) {
            socket.destroy();
            this.networkConnections.delete(id);
          }
          break;
        }
      }
      printer.status = "disconnected";
      this.emit("status-change", { id, status: "disconnected" });
    } catch (e) {
      console.error(`Disconnect error for ${id}:`, e);
    }
  }

  // Send raw data to printer
  async print(id: string, data: Uint8Array): Promise<{ success: boolean; error?: string }> {
    const printer = this.resolvePrinter(id);
    if (!printer) {
      return { success: false, error: "Printer not found" };
    }

    try {
      // Ensure connected
      if (printer.status !== "connected") {
        const connected = await this.connect(id);
        if (!connected) {
          return { success: false, error: "Failed to connect to printer" };
        }
      }

      switch (printer.type) {
        case "usb":
          return await this.printUSB(printer, data);
        case "serial":
          return await this.printSerial(printer, data);
        case "network":
          return await this.printNetwork(printer, data);
        case "windows":
          return await this.printWindows(printer, data);
      }
    } catch (e) {
      printer.status = "error";
      this.emit("status-change", { id: printer.id, status: "error", error: String(e) });
      return { success: false, error: String(e) };
    }

    return { success: false, error: "Unknown printer type" };
  }

  private async printUSB(printer: DiscoveredPrinter, data: Uint8Array): Promise<{ success: boolean; error?: string }> {
    const device = this.usbDevices.get(printer.id) || printer.connection.device;
    if (!device) return { success: false, error: "USB device not connected" };

    try {
      if (!device.opened) {
        await device.open();
      }
      try {
        await device.claimInterface(0);
      } catch {
        // Interface may already be claimed
      }

      // Find OUT endpoint in the first available interface
      const config = device.configuration;
      let endpointNumber: number | undefined;

      for (const iface of config?.interfaces ?? []) {
        const alt = iface.alternate || iface.alternates?.[0];
        const endpoint = alt?.endpoints?.find(e => e.direction === "out");
        if (endpoint) {
          endpointNumber = endpoint.endpointNumber;
          break;
        }
      }

      if (!endpointNumber) return { success: false, error: "No OUT endpoint" };

      // Write in chunks via native bulk transfer
      const chunkSize = 64 * 1024;
      for (let i = 0; i < data.length; i += chunkSize) {
        const chunk = data.slice(i, i + chunkSize);
        await device.nativeTransferOut(endpointNumber, 5000, chunk);
      }

      return { success: true };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  }

  private async printSerial(printer: DiscoveredPrinter, data: Uint8Array): Promise<{ success: boolean; error?: string }> {
    const port = this.serialPorts.get(printer.id);
    if (!port) return { success: false, error: "Serial port not connected" };

    try {
      await new Promise<void>((resolve, reject) => {
        port.write(data, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });

      // Wait for drain
      await new Promise<void>((resolve, reject) => {
        port.drain((err) => {
          if (err) reject(err);
          else resolve();
        });
      });

      return { success: true };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  }

  private async printNetwork(printer: DiscoveredPrinter, data: Uint8Array): Promise<{ success: boolean; error?: string }> {
    const socket = this.networkConnections.get(printer.id);
    if (!socket || socket.destroyed) return { success: false, error: "Network connection lost" };

    try {
      await new Promise<void>((resolve, reject) => {
        socket.write(data, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });
      return { success: true };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  }

  private async printWindows(printer: DiscoveredPrinter, data: Uint8Array): Promise<{ success: boolean; error?: string }> {
    const fs = await import("fs");
    const path = await import("path");
    const os = await import("os");

    const tempFile = path.join(os.tmpdir(), `ach-print-${Date.now()}.bin`);

    try {
      fs.writeFileSync(tempFile, data);

      const printerName = (printer.connection.windowsPrinterName || printer.name).replace(/'/g, "''");

      const psScript = [
        "$bytes = [IO.File]::ReadAllBytes('" + tempFile + "')",
        "$printer = '" + printerName + "'",
        "$hPrinter = 0",
        "Add-Type -TypeDefinition @'",
        "using System;",
        "using System.Runtime.InteropServices;",
        "public static class WinSpool {",
        "  [DllImport(\"winspool.drv\", CharSet = CharSet.Auto, SetLastError = true)]",
        "  public static extern bool OpenPrinter(string pPrinterName, out IntPtr phPrinter, IntPtr pDefault);",
        "  [DllImport(\"winspool.drv\", CharSet = CharSet.Auto, SetLastError = true)]",
        "  public static extern bool StartDocPrinter(IntPtr hPrinter, int Level, byte[] pDocInfo);",
        "  [DllImport(\"winspool.drv\", CharSet = CharSet.Auto, SetLastError = true)]",
        "  public static extern bool StartPagePrinter(IntPtr hPrinter);",
        "  [DllImport(\"winspool.drv\", CharSet = CharSet.Auto, SetLastError = true)]",
        "  public static extern bool WritePrinter(IntPtr hPrinter, byte[] pBytes, int dwCount, out int dwWritten);",
        "  [DllImport(\"winspool.drv\", CharSet = CharSet.Auto, SetLastError = true)]",
        "  public static extern bool EndPagePrinter(IntPtr hPrinter);",
        "  [DllImport(\"winspool.drv\", CharSet = CharSet.Auto, SetLastError = true)]",
        "  public static extern bool EndDocPrinter(IntPtr hPrinter);",
        "  [DllImport(\"winspool.drv\", CharSet = CharSet.Auto, SetLastError = true)]",
        "  public static extern bool ClosePrinter(IntPtr hPrinter);",
        "}",
        "'@",
        "$doc = 'ACH Receipt' + [char]0 + 'RAW' + [char]0 + '' + [char]0 + [char]0",
        "$docBytes = [System.Text.Encoding]::Unicode.GetBytes($doc)",
        "if ([WinSpool]::OpenPrinter($printer, [ref]$hPrinter, [IntPtr]::Zero)) {",
        "  if ([WinSpool]::StartDocPrinter($hPrinter, 1, $docBytes)) {",
        "    if ([WinSpool]::StartPagePrinter($hPrinter)) {",
        "      $written = 0",
        "      [WinSpool]::WritePrinter($hPrinter, $bytes, $bytes.Length, [ref]$written)",
        "      [WinSpool]::EndPagePrinter($hPrinter)",
        "    }",
        "    [WinSpool]::EndDocPrinter($hPrinter)",
        "  }",
        "  [WinSpool]::ClosePrinter($hPrinter)",
        "}",
      ].join("\n");

      const psPath = path.join(os.tmpdir(), `ach-print-${Date.now()}.ps1`);
      fs.writeFileSync(psPath, psScript);
      await execAsync('powershell -NoProfile -ExecutionPolicy Bypass -File "' + psPath + '"');

      setTimeout(() => {
        try { fs.unlinkSync(tempFile); } catch {}
        try { fs.unlinkSync(psPath); } catch {}
      }, 5000);

      return { success: true };
    } catch (e) {
      try { fs.unlinkSync(tempFile); } catch {}
      return { success: false, error: String(e) };
    }
  }

  // Get printer status
  getPrinterStatus(id: string): DiscoveredPrinter | undefined {
    return this.printers.get(id);
  }

  // Get all printers
  getAllPrinters(): DiscoveredPrinter[] {
    return Array.from(this.printers.values());
  }
}