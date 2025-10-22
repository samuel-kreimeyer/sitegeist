import cors from "cors";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createApiRouter } from "./api-server.js";
import { createHandlers } from "./handlers.js";
import { FileStore } from "./storage.js";
import type { EmailSignup } from "../shared/types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number.parseInt(process.env.PORT || "3000", 10);
const DATA_DIR = process.env.DATA_DIR || "./data";
const isDevelopment = process.env.NODE_ENV !== "production";

async function startServer() {
	// Initialize email storage
	const signupsPath = path.join(DATA_DIR, "signups.json");
	const signupsStore = new FileStore<EmailSignup[] | string>(signupsPath);

	// Initialize signups array if it doesn't exist
	if (!signupsStore.getItem("signups")) {
		signupsStore.setItem("signups", []);
	}

	console.log(`✓ Initialized email storage at ${signupsPath}`);

	// Create API handlers
	const handlers = createHandlers(signupsStore);

	// Create Express app
	const app = express();

	// Middleware
	app.use(cors());
	app.use(express.json());

	// API routes (auto-generated from handlers)
	const apiRouter = express.Router();
	createApiRouter(apiRouter, handlers);

	app.use("/api", apiRouter);

	// In production, serve static files from dist/frontend
	if (!isDevelopment) {
		const staticPath = path.resolve(__dirname, "../../dist/frontend");
		console.log(`✓ Serving static files from ${staticPath}`);

		app.use(express.static(staticPath));

		// SPA fallback - serve index.html for all non-API routes
		app.use((_req, res) => {
			res.sendFile(path.join(staticPath, "index.html"));
		});
	} else {
		// 404 handler for dev mode (API only)
		app.use((_req, res) => {
			res.status(404).json({ error: "Not found" });
		});
	}

	// Start server
	const server = app.listen(PORT, () => {
		console.log(`✓ Server listening on port ${PORT}`);
		console.log(`  Health: http://localhost:${PORT}/api/health`);
		if (isDevelopment) {
			console.log(`  API: http://localhost:${PORT}/api`);
		} else {
			console.log(`  Frontend: http://localhost:${PORT}`);
		}
	});

	// Graceful shutdown
	const shutdown = () => {
		console.log("\n✓ Shutting down gracefully...");
		server.close(() => {
			console.log("✓ Server closed");
			process.exit(0);
		});

		// Force shutdown after 5 seconds
		setTimeout(() => {
			console.error("✗ Forced shutdown");
			process.exit(1);
		}, 5000);
	};

	process.on("SIGTERM", shutdown);
	process.on("SIGINT", shutdown);
}

startServer().catch((err) => {
	console.error("Failed to start server:", err);
	process.exit(1);
});
