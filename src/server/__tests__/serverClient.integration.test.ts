/**
 * Integration Test — Layer 1: Server Client
 * Tests the real cnext --serve server parsing in isolation.
 * Validates symbol structure returned by the real transpiler.
 */

import { afterAll, beforeAll, expect, it } from "vitest";
import {
  describeIntegration,
  startServerClient,
  loadFixture,
} from "../../__tests__/helpers";
import CNextServerClient from "../CNextServerClient";

describeIntegration("ServerClient Integration", () => {
  let client: CNextServerClient;

  beforeAll(async () => {
    client = await startServerClient();
  });

  afterAll(async () => {
    await client.stop();
  });

  it("connects and reports a version", async () => {
    const version = await client.getVersion();
    expect(version).toBeTruthy();
    expect(typeof version).toBe("string");
  });

  it("parses scope with fields and methods", async () => {
    const { content } = loadFixture("scope-basic", "LED.cnx");
    const result = await client.parseSymbols(content, "/test/LED.cnx");

    expect(result.success).toBe(true);
    expect(result.errors).toHaveLength(0);

    // Scope definition
    const led = result.symbols.find((s) => s.name === "LED");
    expect(led).toBeDefined();
    expect(led!.kind).toBe("namespace"); // Server returns "namespace" for scopes

    // Fields
    const pin = result.symbols.find((s) => s.name === "pin");
    expect(pin).toBeDefined();
    expect(pin!.parent).toBe("LED");
    expect(pin!.type).toBe("u8");

    const state = result.symbols.find((s) => s.name === "state");
    expect(state).toBeDefined();
    expect(state!.parent).toBe("LED");
    expect(state!.type).toBe("bool");

    // Methods
    const methods = result.symbols.filter(
      (s) => s.parent === "LED" && s.kind === "function",
    );
    const methodNames = methods.map((m) => m.name);
    expect(methodNames).toContain("on");
    expect(methodNames).toContain("off");
    expect(methodNames).toContain("toggle");
  });

  it("preserves parent relationships for scope members", async () => {
    const { content } = loadFixture("cross-file", "driver.cnx");
    const result = await client.parseSymbols(content, "/test/driver.cnx");

    expect(result.success).toBe(true);

    const init = result.symbols.find((s) => s.name === "init");
    expect(init).toBeDefined();
    expect(init!.parent).toBe("Driver");

    const start = result.symbols.find((s) => s.name === "start");
    expect(start).toBeDefined();
    expect(start!.parent).toBe("Driver");
  });

  it("parses top-level symbols without parent", async () => {
    const { content } = loadFixture("cross-file", "driver.cnx");
    const result = await client.parseSymbols(content, "/test/driver.cnx");

    const driverVersion = result.symbols.find(
      (s) => s.name === "driverVersion",
    );
    expect(driverVersion).toBeDefined();
    expect(driverVersion!.parent).toBeUndefined();
    expect(driverVersion!.type).toBe("u8");

    const driverHelper = result.symbols.find((s) => s.name === "driverHelper");
    expect(driverHelper).toBeDefined();
    expect(driverHelper!.parent).toBeUndefined();
    expect(driverHelper!.kind).toBe("function");
  });

  it("parses enum with members", async () => {
    const { content } = loadFixture("enum-scope", "main.cnx");
    const result = await client.parseSymbols(content, "/test/enum.cnx");

    expect(result.success).toBe(true);

    // Enum definition
    const color = result.symbols.find((s) => s.name === "Color");
    expect(color).toBeDefined();
    expect(color!.kind).toBe("enum");

    // Enum members
    const members = result.symbols.filter(
      (s) => s.kind === "enumMember" && s.parent === "Color",
    );
    const memberNames = members.map((m) => m.name);
    expect(memberNames).toContain("Red");
    expect(memberNames).toContain("Green");
    expect(memberNames).toContain("Blue");
  });

  it("parses typed field with correct type", async () => {
    const { content } = loadFixture("enum-scope", "main.cnx");
    const result = await client.parseSymbols(content, "/test/enum.cnx");

    const currentColor = result.symbols.find((s) => s.name === "currentColor");
    expect(currentColor).toBeDefined();
    expect(currentColor!.type).toBe("Color");
    expect(currentColor!.parent).toBe("Display");
  });

  it("parses global variables and functions", async () => {
    const { content } = loadFixture("global-symbols", "utils.cnx");
    const result = await client.parseSymbols(content, "/test/utils.cnx");

    expect(result.success).toBe(true);

    const counter = result.symbols.find((s) => s.name === "globalCounter");
    expect(counter).toBeDefined();
    expect(counter!.type).toBe("u8");
    expect(counter!.parent).toBeUndefined();

    const threshold = result.symbols.find((s) => s.name === "globalThreshold");
    expect(threshold).toBeDefined();
    expect(threshold!.type).toBe("u16");

    const reset = result.symbols.find((s) => s.name === "resetCounters");
    expect(reset).toBeDefined();
    expect(reset!.kind).toBe("function");
    expect(reset!.parent).toBeUndefined();
  });
});
