import cors from "cors";
import express from "express";
import { actorsRouter } from "./routes/actors";
import { aiRouter } from "./routes/ai";
import { agentsRouter } from "./routes/agents";
import { capabilitiesRouter } from "./routes/capabilities";
import { contractsRouter } from "./routes/contracts";
import { entitiesRouter, productAuxRouter } from "./routes/entities";
import { feedbackRouter } from "./routes/feedback";
import { featuresRouter } from "./routes/features";
import { globalFeedbackRouter } from "./routes/globalFeedback";
import { promptsRouter } from "./routes/prompts";
import { rolesRouter } from "./routes/roles";
import { gitRouter } from "./routes/git";
import { tasksRouter } from "./routes/tasks";
import { sessionsRouter, productSessionsRouter } from "./routes/sessions";
import { agentApiRouter } from "./routes/agentApi";
import { intakeRouter } from "./routes/intake";
import { productsRouter } from "./routes/products";
import { productSpecRouter, specRouter } from "./routes/spec";
import { screensRouter } from "./routes/screens";
import { usecasesRouter } from "./routes/usecases";
import { wizardRouter } from "./routes/wizard";
import { DATA_ROOT } from "./services/fileReader";
import { getDataVersion, onDataChange, startDataWatcher } from "./services/watcher";
import { loadPersistedOrchestration } from "./services/sessionOrchestrator";

const app = express();
const port = Number(process.env.PORT ?? 3001);

app.use(cors());
app.use(express.json({ limit: "5mb" }));

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    dataRoot: DATA_ROOT,
    version: getDataVersion()
  });
});

app.get("/api/events", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  res.write(`event: ready\ndata: ${JSON.stringify({ version: getDataVersion() })}\n\n`);

  const unsubscribe = onDataChange((version, changedPath) => {
    res.write(`event: data-change\ndata: ${JSON.stringify({ version, changedPath })}\n\n`);
  });

  req.on("close", () => {
    unsubscribe();
  });
});

app.use("/api/products/:id/actors", actorsRouter);
app.use("/api/products/:id/capabilities", capabilitiesRouter);
app.use("/api/products/:id/usecases", usecasesRouter);
app.use("/api/products/:id/screens", screensRouter);
app.use("/api/products/:id/entities", entitiesRouter);
app.use("/api/products/:id/features", featuresRouter);
app.use("/api/products/:id/feedback", feedbackRouter);
app.use("/api/products/:id/global-feedback", globalFeedbackRouter);
app.use("/api/products/:id/sessions", productSessionsRouter);
app.use("/api/products/:id", promptsRouter);
app.use("/api/products/:id", productAuxRouter);
app.use("/api/products/:id", productSpecRouter);
app.use("/api/products/wizard", wizardRouter);
app.use("/api/products", productsRouter);
app.use("/api/tasks", tasksRouter);
app.use("/api/sessions", sessionsRouter);
app.use("/api/agent", agentApiRouter);
app.use("/api/contracts", contractsRouter);
app.use("/api/agents", agentsRouter);
app.use("/api/ai", aiRouter);
app.use("/api/roles", rolesRouter);
app.use("/api/intake", intakeRouter);
app.use("/api/spec", specRouter);
app.use("/api", gitRouter);

app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(error);
  res.status(500).json({ error: "Internal server error" });
});

startDataWatcher();

// 改造 5:启动时读回未完成的编排树(续跑/续审)。best-effort,失败不影响启动。
void loadPersistedOrchestration().catch((e) => console.warn("[atlas-api] 编排树恢复失败:", e));

const server = app.listen(port, () => {
  console.log(`Atlas API listening on http://127.0.0.1:${port}`);
  console.log(`Reading data from ${DATA_ROOT}`);
});

server.on("error", (error: NodeJS.ErrnoException) => {
  if (error.code === "EADDRINUSE") {
    console.error(`\n[atlas-api] Port ${port} is already in use.`);
    console.error(`[atlas-api] Another Atlas API process is likely still running.`);
    console.error(`[atlas-api] Find and kill it with:`);
    console.error(`[atlas-api]   lsof -ti :${port} | xargs kill -9`);
    console.error(`[atlas-api] Or run on a different port:  PORT=3002 npm run dev\n`);
    process.exit(1);
  }
  throw error;
});
