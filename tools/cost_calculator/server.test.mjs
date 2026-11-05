import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import http from "node:http";
import test from "node:test";
import { fileURLToPath } from "node:url";

function request(port, path, method = "GET") {
  return new Promise((resolve, reject) => {
    const outgoing = http.request({ host: "127.0.0.1", port, path, method, agent: false }, response => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", chunk => { body += chunk; });
      response.on("error", reject);
      response.on("end", () => resolve({ status: response.statusCode, headers: response.headers, body }));
    });
    outgoing.setTimeout(5000, () => outgoing.destroy(new Error("Request timed out")));
    outgoing.on("error", reject);
    outgoing.end();
  });
}

test("the calculator process rejects malformed targets and keeps serving assets", { timeout: 15000 }, async t => {
  const reservation = http.createServer();
  reservation.listen(0, "127.0.0.1");
  await once(reservation, "listening");
  const { port } = reservation.address();
  await new Promise((resolve, reject) => reservation.close(error => error ? reject(error) : resolve()));

  const child = spawn(process.execPath, [fileURLToPath(new URL("./server.mjs", import.meta.url))], {
    env: { ...process.env, PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr.setEncoding("utf8").on("data", chunk => { stderr += chunk; });
  const closed = new Promise(resolve => child.once("close", resolve));
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) child.kill();
    await closed;
  });
  await new Promise((resolve, reject) => {
    let stdout = "";
    const timer = setTimeout(() => reject(new Error(`Server startup timed out: ${stderr}`)), 5000);
    child.once("error", error => { clearTimeout(timer); reject(error); });
    child.once("exit", code => {
      clearTimeout(timer);
      reject(new Error(`Server exited during startup (${code}): ${stderr}`));
    });
    child.stdout.setEncoding("utf8").on("data", chunk => {
      stdout += chunk;
      if (stdout.includes(`http://127.0.0.1:${port}`)) {
        clearTimeout(timer);
        resolve();
      }
    });
  });

  for (const target of ["//[", "//%zz", "http://[", "http://localhost:bad/"]) {
    for (const method of ["GET", "POST"]) {
      const bad = await request(port, target, method);
      assert.equal(bad.status, 400, `${method} ${target}`);
      assert.equal(bad.body, "Bad request");
      assert.match(bad.headers["content-type"], /^text\/plain/);
      const page = await request(port, "/?value=%5B%20%25");
      assert.equal(page.status, 200);
      assert.match(page.body, /Voice Agent Cost Lab/);
    }
  }
  for (const file of ["index.html", "styles.css", "app.mjs", "calculator.mjs", "prices.json", "favicon.svg"]) {
    assert.equal((await request(port, `/${file}`)).status, 200, file);
    const head = await request(port, `/${file}`, "HEAD");
    assert.equal(head.status, 200, file);
    assert.equal(head.body, "");
  }
  for (const path of ["/missing%20file", "/%69ndex.html", "/server.mjs"]) {
    assert.equal((await request(port, path)).status, 404, path);
  }
  assert.equal((await request(port, "/", "POST")).status, 404);
  assert.equal(child.exitCode, null, stderr);
  assert.equal(stderr, "");
});
