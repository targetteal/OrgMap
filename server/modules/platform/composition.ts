/** CLI-only bridge to the coordinator's public application composition. Never import this from HTTP handlers. */
import {
  createPlatformWorker as integratedWorker,
  createIntegratedDispatcher,
  closePlatformWorker as closeIntegratedWorker,
} from "../../integration/index.js";
import { createConfiguredScopeDispatch } from "./dispatcher.js";
import { loadIntegrationOptions } from "../../integration/config.js";
let dispatchConnection:
  ReturnType<typeof createConfiguredScopeDispatch> | undefined;
async function operatorOptions() {
  const options = await loadIntegrationOptions();
  return {
    ...options,
    ...(process.env.PLATFORM_BLOBS_DIRECTORY
      ? { blobsDirectory: process.env.PLATFORM_BLOBS_DIRECTORY }
      : {}),
  };
}
export async function createPlatformWorker() {
  return integratedWorker(await operatorOptions());
}
export async function createPlatformDispatcher() {
  const options = await operatorOptions();
  dispatchConnection = createConfiguredScopeDispatch();
  try {
    return createIntegratedDispatcher(dispatchConnection.port, options);
  } catch (error) {
    await dispatchConnection.close();
    throw error;
  }
}
export async function closePlatformWorker() {
  await dispatchConnection?.close();
  await closeIntegratedWorker();
}
