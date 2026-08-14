import { createApp } from "./app.js";
import { SignalStore } from "./store.js";

const PORT = Number(process.env.PORT ?? 3001);
const HOST = process.env.HOST ?? "0.0.0.0";

const store = new SignalStore();
store.add({ author: "mission-control", message: "Welcome to Aether. Broadcast your first signal." });

const app = createApp(store);

app.listen(PORT, HOST, () => {
  console.log(`[aether] API listening on http://${HOST}:${PORT}`);
});
