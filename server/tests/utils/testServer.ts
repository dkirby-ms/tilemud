import { agent } from "supertest";
import { createApp } from "../../src/api/app.js";
import { initializeContainer, shutdownContainer, Container } from "../../src/infra/container.js";

export type TestAgent = ReturnType<typeof agent>;

let testContainer: Container | null = null;

export async function createTestAgent(): Promise<TestAgent> {
  if (!testContainer) {
    // Initialize with test environment variables
    process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://tilemud:tilemud_dev_pw@localhost:5438/tilemud";
    process.env.REDIS_URL = process.env.REDIS_URL || "redis://localhost:6380/0";
    process.env.PORT = process.env.PORT || "4000";
    process.env.LOG_LEVEL = process.env.LOG_LEVEL || "debug";
    
    testContainer = await initializeContainer();
  }
  
  const app = createApp();
  return agent(app);
}

export async function getTestContainer(): Promise<Container> {
  if (!testContainer) {
    testContainer = await initializeContainer();
  }
  return testContainer;
}

export async function cleanupTestServer(): Promise<void> {
  if (testContainer) {
    await shutdownContainer();
    testContainer = null;
  }
}
