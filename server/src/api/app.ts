import express, { type Express } from "express";

export function createApp(): Express {
  const app = express();

  app.use(express.json());

  app.use((req, res) => {
    res.status(501).json({
      error: "Not implemented",
      method: req.method,
      path: req.path
    });
  });

  return app;
}
