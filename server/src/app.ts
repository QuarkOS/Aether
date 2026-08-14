import cors from "cors";
import express, { type Express } from "express";

import { SignalStore, validateNewSignal } from "./store.js";

export function createApp(store: SignalStore = new SignalStore()): Express {
  const app = express();
  app.use(cors());
  app.use(express.json());

  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok", uptime: process.uptime() });
  });

  app.get("/api/signals", (_req, res) => {
    res.json(store.list());
  });

  app.post("/api/signals", (req, res) => {
    const input = validateNewSignal(req.body);
    if (!input) {
      res.status(400).json({
        error: "Invalid signal: 'message' (1-280 chars) and 'author' (1-60 chars) are required.",
      });
      return;
    }
    const signal = store.add(input);
    res.status(201).json(signal);
  });

  app.delete("/api/signals/:id", (req, res) => {
    const removed = store.remove(req.params.id);
    res.status(removed ? 204 : 404).end();
  });

  return app;
}
