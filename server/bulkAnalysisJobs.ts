import { v4 as uuidv4 } from "uuid";

export type BulkJobType = "creator" | "brand";
export type BulkJobStatus = "pending" | "processing" | "completed" | "failed";

export interface BulkJobProgress {
  total: number;
  completed: number;
  failed: number;
  status: BulkJobStatus;
  startedAt: number;
  completedAt?: number;
  errors: Array<{ index: number; handle: string; error: string }>;
}

export interface BulkCreatorJob {
  jobId: string;
  type: "creator";
  handles: string[];
  platform: "TikTok" | "YouTube" | "Multi";
  progress: BulkJobProgress;
  results: Array<{ handle: string; creatorId?: string; error?: string }>;
}

export interface BulkBrandJob {
  jobId: string;
  type: "brand";
  brands: Array<{ name: string; url?: string; tiktokHandle?: string }>;
  progress: BulkJobProgress;
  results: Array<{ name: string; brandId?: string; error?: string }>;
}

export type BulkJob = BulkCreatorJob | BulkBrandJob;

// In-memory job storage (in production, use database)
const jobs = new Map<string, BulkJob>();

export function createBulkCreatorJob(
  handles: string[],
  platform: "TikTok" | "YouTube" | "Multi"
): BulkCreatorJob {
  const jobId = uuidv4();
  const job: BulkCreatorJob = {
    jobId,
    type: "creator",
    handles,
    platform,
    progress: {
      total: handles.length,
      completed: 0,
      failed: 0,
      status: "pending",
      startedAt: Date.now(),
      errors: [],
    },
    results: handles.map((handle) => ({ handle })),
  };

  jobs.set(jobId, job);
  return job;
}

export function createBulkBrandJob(
  brands: Array<{ name: string; url?: string; tiktokHandle?: string }>
): BulkBrandJob {
  const jobId = uuidv4();
  const job: BulkBrandJob = {
    jobId,
    type: "brand",
    brands,
    progress: {
      total: brands.length,
      completed: 0,
      failed: 0,
      status: "pending",
      startedAt: Date.now(),
      errors: [],
    },
    results: brands.map((brand) => ({ name: brand.name })),
  };

  jobs.set(jobId, job);
  return job;
}

export function getJob(jobId: string): BulkJob | undefined {
  return jobs.get(jobId);
}

export function updateJobProgress(
  jobId: string,
  updates: Partial<BulkJobProgress>
): void {
  const job = jobs.get(jobId);
  if (job) {
    job.progress = { ...job.progress, ...updates };
  }
}

export function updateJobResult(
  jobId: string,
  index: number,
  result: { creatorId?: string; brandId?: string; error?: string }
): void {
  const job = jobs.get(jobId);
  if (job && job.results[index]) {
    job.results[index] = { ...job.results[index], ...result };
  }
}

export function markJobProcessing(jobId: string): void {
  const job = jobs.get(jobId);
  if (job) {
    job.progress.status = "processing";
    job.progress.startedAt = Date.now();
  }
}

export function markJobCompleted(jobId: string): void {
  const job = jobs.get(jobId);
  if (job) {
    job.progress.status = "completed";
    job.progress.completedAt = Date.now();
  }
}

export function markJobFailed(jobId: string, error: string): void {
  const job = jobs.get(jobId);
  if (job) {
    job.progress.status = "failed";
    job.progress.completedAt = Date.now();
  }
}

export function recordJobError(
  jobId: string,
  index: number,
  handle: string,
  error: string
): void {
  const job = jobs.get(jobId);
  if (job) {
    job.progress.failed++;
    job.progress.errors.push({ index, handle, error });
  }
}
