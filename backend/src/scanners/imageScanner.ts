import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export interface ImageScanResult {
  vulnerabilities: any[];
  raw?: any;
}

export async function scanImage(image: string): Promise<ImageScanResult> {
  console.log(`[Image Scanner] Scanning image: ${image}`);
  try {
    const { stdout } = await execAsync(
      `trivy image --format json --quiet ${image}`
    );
    
    const result = JSON.parse(stdout);
    
    // Trivy image output structure: { Results: [ { Vulnerabilities: [...] } ] }
    const vulnerabilities = result.Results?.flatMap((r: any) => 
      r.Vulnerabilities ?? []
    ) ?? [];

    return { vulnerabilities, raw: result };
  } catch (error: any) {
    console.error(`[Image Scanner] Failed to scan image ${image}:`, error);
    throw error;
  }
}
