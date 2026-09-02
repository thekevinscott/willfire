import type { JobSite } from "../types.js";

/**
 * The name a callback map answers a job under: repo-qualified so a resolver
 * emits the same map wherever its workflow is reached from, and ref/sha-free
 * so a moving tag never invalidates one. Constructed only — the job id sits
 * after the last colon precisely because nothing ever parses a key back apart.
 */
export const jobKey = (site: JobSite, jobId: string): string =>
  `${site.source.owner}/${site.source.repo}/${site.path}:${jobId}`;
