// A caller has to tell 404 ("no such file") from 403/429/5xx ("could not
// read"), so the status travels as a field and not only in the message. The
// `response.headers` shape is octokit's, which is what consumers already probe
// for `retry-after` and `x-ratelimit-remaining`.

export interface GithubApiError extends Error {
  readonly status: number;
  readonly response: { readonly headers: Record<string, string> };
}

export function githubApiError(
  status: number,
  target: string,
  headers: Record<string, string> = {},
): GithubApiError {
  return Object.assign(new Error(`GitHub API ${status} for ${target}`), {
    status,
    response: { headers },
  });
}
