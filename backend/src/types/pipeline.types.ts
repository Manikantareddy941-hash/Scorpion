import { Models } from 'node-appwrite';

export type PipelineRunDocument = Models.Document & {
  repoId: string;
  repoName?: string;
  branch?: string;
  cloneUrl?: string;
  targetEnvironment?: string;
  currentStage?: string;
};

export type RepoDocument = Models.Document & {
  url: string;
  local_path?: string;
  name?: string;
};

export type EnvironmentDocument = Models.Document & {
  name: string;
  host: string;
  port: string | number;
  username: string;
  privateKey: string;
  deployPath: string;
};

/** Partial field updates written onto a pipeline_runs document per stage transition. */
export type StageUpdate = Record<string, unknown>;
