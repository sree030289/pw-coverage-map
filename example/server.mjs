// Tiny demo app for the example suite: an in-memory users API and a todo page.
import { createServer } from "node:http";

const users = new Map();
let nextId = 1;

const page = `<!doctype html><title>Todos</title>
<h1>Todos</h1>
<input aria-label="New todo"><button>Add</button>
<ul></ul>
<script>
  const input = document.querySelector("input");
  document.querySelector("button").onclick = () => {
    if (!input.value.trim()) return;
    const li = document.createElement("li");
    li.textContent = input.value;
    li.onclick = () => li.classList.toggle("done");
    document.querySelector("ul").append(li);
    input.value = "";
  };
</script>`;

const send = (res, status, body) => {
  res.writeHead(status, { "content-type": typeof body === "string" ? "text/html" : "application/json" });
  res.end(body === undefined ? "" : typeof body === "string" ? body : JSON.stringify(body));
};

createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  let raw = "";
  for await (const chunk of req) raw += chunk;
  const body = raw ? JSON.parse(raw) : {};
  const match = /^\/api\/users\/(\d+)$/.exec(url.pathname);

  if (url.pathname === "/") return send(res, 200, page);
  if (url.pathname === "/about") return send(res, 200, "<h1>About</h1>");
  if (url.pathname === "/api/users" && req.method === "GET") return send(res, 200, [...users.values()]);
  if (url.pathname === "/api/users" && req.method === "POST") {
    if (!body.name || body.name.length > 50) return send(res, 400, { error: "invalid name" });
    const user = { id: nextId++, name: body.name, role: body.role ?? "member" };
    users.set(user.id, user);
    return send(res, 201, user);
  }
  if (match) {
    const user = users.get(Number(match[1]));
    if (!user) return send(res, 404, { error: "not found" });
    if (req.method === "GET") return send(res, 200, user);
    if (req.method === "PATCH") return send(res, 200, Object.assign(user, body));
    if (req.method === "DELETE") { users.delete(user.id); return send(res, 204); }
  }
  send(res, 404, { error: "not found" });
}).listen(Number(process.env.PORT ?? 4321));
