import express from "express";
import cors from "cors";
import { env } from "./lib/env";
import { authRouter } from "./routes/auth";
import { assistantsRouter } from "./routes/assistants";
import { projectsRouter } from "./routes/projects";
import { tasksRouter } from "./routes/tasks";
import { transcriberRouter } from "./routes/transcriber";
import { financeRouter } from "./routes/finance";
import { ksgRouter } from "./routes/ksg";
import { landRouter } from "./routes/land";
import { supportRouter } from "./routes/support";
import { financeMonitorRouter } from "./routes/financeMonitor";
import { mailRouter } from "./routes/mail";
import { notificationsRouter } from "./routes/notifications";
import { reportsRouter } from "./routes/reports";
import { usersRouter } from "./routes/users";

const app = express();

app.use(cors());
app.use(express.json());

app.get("/api/health", (_req, res) => res.json({ status: "ok" }));

app.use("/api/auth", authRouter);
app.use("/api/assistants", assistantsRouter);
app.use("/api/projects", projectsRouter);
app.use("/api/tasks", tasksRouter);
app.use("/api/transcriber", transcriberRouter);
app.use("/api/finance", financeRouter);
app.use("/api/ksg", ksgRouter);
app.use("/api/land", landRouter);
app.use("/api/support", supportRouter);
app.use("/api/finance-monitor", financeMonitorRouter);
app.use("/api/mail", mailRouter);
app.use("/api/notifications", notificationsRouter);
app.use("/api/reports", reportsRouter);
app.use("/api/users", usersRouter);

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).json({ error: "Внутренняя ошибка сервера" });
});

app.listen(env.port, () => {
  console.log(`[api] ВМЕСТЕ AI backend слушает порт ${env.port}`);
});
