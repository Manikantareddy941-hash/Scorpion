// Docker runtime image mapping configuration
export const RUNTIME_IMAGES = {
  NODE: 'node:24-alpine',
  GRADLE: 'gradle:8-jdk17',
  PYTHON: 'python:3.13-alpine',
  FALLBACK: 'alpine:latest'
};

/**
 * Dynamically resolves the correct sandboxed runtime image based on the detected build tool.
 */
export function getRuntimeImage(tool: string): string {
  const normalized = tool.toLowerCase();
  if (normalized.includes('node') || normalized.includes('npm') || normalized.includes('vite')) {
    return RUNTIME_IMAGES.NODE;
  }
  if (normalized.includes('gradle')) {
    return RUNTIME_IMAGES.GRADLE;
  }
  if (normalized.includes('python') || normalized.includes('pip')) {
    return RUNTIME_IMAGES.PYTHON;
  }
  return RUNTIME_IMAGES.FALLBACK;
}
