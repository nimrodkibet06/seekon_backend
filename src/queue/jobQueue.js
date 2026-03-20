/**
 * In-Memory Job Queue
 * $0 solution - no external dependencies
 */

// In-memory storage for jobs
const jobs = new Map();

// Queue for pending job IDs
const pendingQueue = [];

// Currently processing job (single worker)
let currentJob = null;

let jobIdCounter = 1;

/**
 * Create a new background removal job
 * @param {Object} jobData - { cloudinaryUrl, originalPublicId, userId }
 * @returns {string} Job ID
 */
export const createJob = (jobData) => {
  const jobId = `job-${Date.now()}-${jobIdCounter++}`;
  
  const job = {
    id: jobId,
    status: 'pending',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    progress: 0,
    data: jobData,
    result: null,
    error: null
  };
  
  jobs.set(jobId, job);
  pendingQueue.push(jobId);
  
  console.log(`📝 Job created: ${jobId}`);
  
  return jobId;
};

/**
 * Get next pending job from queue
 * @returns {Object|null} Job or null if none pending
 */
export const getNextJob = () => {
  if (currentJob) {
    console.log(`⏳ Worker busy with job: ${currentJob.id}`);
    return null;
  }
  
  if (pendingQueue.length === 0) {
    return null;
  }
  
  const jobId = pendingQueue.shift();
  const job = jobs.get(jobId);
  
  if (job && job.status === 'pending') {
    currentJob = job;
    job.status = 'processing';
    job.updatedAt = new Date().toISOString();
    console.log(`🔄 Processing job: ${jobId}`);
    return job;
  }
  
  return getNextJob();
};

/**
 * Mark job as completed
 * @param {string} jobId 
 * @param {Object} result - { url, publicId }
 */
export const completeJob = (jobId, result) => {
  const job = jobs.get(jobId);
  if (job) {
    job.status = 'completed';
    job.result = result;
    job.progress = 100;
    job.updatedAt = new Date().toISOString();
    console.log(`✅ Job completed: ${jobId}`);
  }
  currentJob = null;
};

/**
 * Mark job as failed
 * @param {string} jobId 
 * @param {string} error 
 */
export const failJob = (jobId, error) => {
  const job = jobs.get(jobId);
  if (job) {
    job.status = 'failed';
    job.error = error;
    job.updatedAt = new Date().toISOString();
    console.error(`❌ Job failed: ${jobId} - ${error}`);
  }
  currentJob = null;
};

/**
 * Update job progress
 * @param {string} jobId 
 * @param {number} progress 
 * @param {string} status 
 */
export const updateJobProgress = (jobId, progress, status = 'processing') => {
  const job = jobs.get(jobId);
  if (job) {
    job.progress = progress;
    job.status = status;
    job.updatedAt = new Date().toISOString();
  }
};

/**
 * Get job status by ID
 * @param {string} jobId 
 * @returns {Object|null}
 */
export const getJobStatus = (jobId) => {
  const job = jobs.get(jobId);
  if (!job) return null;
  
  // Return only safe fields (not internal data)
  return {
    id: job.id,
    status: job.status,
    progress: job.progress,
    result: job.result,
    error: job.error,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt
  };
};

/**
 * Get all jobs (for debugging)
 */
export const getAllJobs = () => {
  return Array.from(jobs.values()).map(job => ({
    id: job.id,
    status: job.status,
    progress: job.progress,
    createdAt: job.createdAt
  }));
};

/**
 * Clean up old completed/failed jobs (call periodically)
 */
export const cleanupOldJobs = (maxAgeMs = 3600000) => {
  const now = Date.now();
  for (const [jobId, job] of jobs.entries()) {
    const age = now - new Date(job.updatedAt).getTime();
    if (age > maxAgeMs && ['completed', 'failed'].includes(job.status)) {
      jobs.delete(jobId);
      console.log(`🧹 Cleaned up old job: ${jobId}`);
    }
  }
};
