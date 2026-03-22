import { describe, test, expect } from "@jest/globals";
import { getHealth } from "../src/routes/health.js";
import { getDocs }   from "../src/routes/docs.js";
import { route }     from "../src/router.js";

// ---------------------------------------------------------------------------
// /health route — unit tests
// ---------------------------------------------------------------------------

describe("getHealth", () => {
  test("returns status 200", async () => {
    const res = await getHealth({});
    expect(res.statusCode).toBe(200);
  });

  test("returns Content-Type text/html", async () => {
    const res = await getHealth({});
    expect(res.headers?.["Content-Type"]).toContain("text/html");
  });

  test("response body contains team name GoosePatrol", async () => {
    const res = await getHealth({});
    expect(res.body).toContain("GoosePatrol");
  });

  test("response body contains goose emoji", async () => {
    const res = await getHealth({});
    expect(res.body).toContain("🪿");
  });

  test("response body contains View API Documentation button", async () => {
    const res = await getHealth({});
    expect(res.body).toContain("View API Documentation");
  });

  test("response body contains a link to /docs", async () => {
    const res = await getHealth({});
    expect(res.body).toContain("/docs");
  });

  test("response body contains server time element", async () => {
    const res = await getHealth({});
    expect(res.body).toContain("server-time");
  });

  test("response body contains auto-refresh JavaScript", async () => {
    const res = await getHealth({});
    expect(res.body).toContain("setInterval");
  });

  test("response body is valid HTML with doctype", async () => {
    const res = await getHealth({});
    expect(res.body.trim().toLowerCase()).toMatch(/^<!doctype html>/);
  });

  test("response body contains Operational status indicator", async () => {
    const res = await getHealth({});
    expect(res.body).toContain("Operational");
  });
});

// ---------------------------------------------------------------------------
// /docs route — unit tests
// ---------------------------------------------------------------------------

describe("getDocs", () => {
  test("returns status 302", async () => {
    const res = await getDocs({});
    expect(res.statusCode).toBe(302);
  });

  test("returns a Location header", async () => {
    const res = await getDocs({});
    expect(res.headers?.Location).toBeDefined();
  });

  test("Location header points to editor.swagger.io", async () => {
    const res = await getDocs({});
    expect(res.headers?.Location).toContain("petstore.swagger.io");
  });

  test("Location header contains the swagger.yaml spec URL", async () => {
    const res = await getDocs({});
    expect(res.headers?.Location).toContain("swagger.yaml");
  });

  test("Location header URL is properly encoded", async () => {
    const res = await getDocs({});
    expect(res.headers?.Location).toMatch(/\?url=https?%3A/);
  });

  test("returns empty body", async () => {
    const res = await getDocs({});
    expect(res.body).toBe("");
  });
});

// ---------------------------------------------------------------------------
// Router integration — routes wired up correctly
// ---------------------------------------------------------------------------

describe("router integration", () => {
  test("GET /health is routed correctly → 200", async () => {
    const res = await route({ httpMethod: "GET", path: "/health", headers: {}, body: null }) as any;
    expect(res.statusCode).toBe(200);
  });

  test("GET /health/ trailing slash is routed correctly → 200", async () => {
    const res = await route({ httpMethod: "GET", path: "/health/", headers: {}, body: null }) as any;
    expect(res.statusCode).toBe(200);
  });

  test("GET /docs is routed correctly → 302", async () => {
    const res = await route({ httpMethod: "GET", path: "/docs", headers: {}, body: null }) as any;
    expect(res.statusCode).toBe(302);
  });

  test("GET /docs/ trailing slash is routed correctly → 302", async () => {
    const res = await route({ httpMethod: "GET", path: "/docs/", headers: {}, body: null }) as any;
    expect(res.statusCode).toBe(302);
  });

  test("GET /docs redirects to editor.swagger.io", async () => {
    const res = await route({ httpMethod: "GET", path: "/docs", headers: {}, body: null }) as any;
    expect(res.headers?.Location).toContain("petstore.swagger.io");
  });

  test("POST /health is not handled → 404", async () => {
    const res = await route({ httpMethod: "POST", path: "/health", headers: {}, body: null }) as any;
    expect(res.statusCode).toBe(404);
  });

  test("POST /docs is not handled → 404", async () => {
    const res = await route({ httpMethod: "POST", path: "/docs", headers: {}, body: null }) as any;
    expect(res.statusCode).toBe(404);
  });

  test("existing routes still work — GET /despatch-advices is not 404", async () => {
    const res = await route({ httpMethod: "GET", path: "/despatch-advices", headers: {}, body: null }) as any;
    expect(res.statusCode).not.toBe(404);
  });

  test("unknown route still returns 404", async () => {
    const res = await route({ httpMethod: "GET", path: "/unknown-route", headers: {}, body: null }) as any;
    expect(res.statusCode).toBe(404);
  });
});