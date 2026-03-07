import { createInitialWorkspace } from "./defaults";
import type { WorkspaceData } from "../types";

const STORAGE_KEY = "pricing-desk-workspace-v1";

export function loadWorkspace(): WorkspaceData {
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return createInitialWorkspace();
  }

  try {
    return { ...createInitialWorkspace(), ...JSON.parse(raw) } as WorkspaceData;
  } catch (error) {
    console.error("Failed to parse local workspace", error);
    return createInitialWorkspace();
  }
}

export function saveWorkspace(workspace: WorkspaceData) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(workspace));
}

