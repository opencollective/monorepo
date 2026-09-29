import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const WEEK = 7 * 24 * 60 * 60 * 1000;

export function githubApi(endpoint, paginate = false) {
  const args = ['api', endpoint];
  // Emit one JSON value per page, including with older gh versions without --slurp.
  if (paginate) args.push('--paginate', '--jq', 'tojson');
  const output = execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return paginate
    ? output
        .trim()
        .split('\n')
        .map((page) => JSON.parse(page))
    : JSON.parse(output);
}

export function buildContext({ repository, runId, api = githubApi }) {
  if (!repository || !runId) throw new Error('GITHUB_REPOSITORY and GITHUB_RUN_ID are required');
  const base = `repos/${repository}`;
  const current = api(`${base}/actions/runs/${runId}`);
  const { default_branch: branch } = api(base);
  const until = current.created_at;
  const cutoff = Date.parse(until);
  if (!Number.isFinite(cutoff) || !current.workflow_id || !branch) {
    throw new Error('Missing workflow, branch, or run timestamp');
  }

  // Read all pages and filter locally: filtered run searches have a 1,000-result cap.
  const runs = api(`${base}/actions/workflows/${current.workflow_id}/runs?per_page=100`, true)
    .flatMap((page) => page.workflow_runs)
    .filter(
      (run) =>
        String(run.id) !== String(runId) &&
        run.head_branch === branch &&
        run.status === 'completed' &&
        run.conclusion === 'success' &&
        Date.parse(run.created_at) < cutoff,
    )
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));

  let previous;
  for (const run of runs) {
    // A successful activation-only run (the old skip gate) reviewed no changes.
    const jobs = api(`${base}/actions/runs/${run.id}/jobs?filter=latest&per_page=100`, true).flatMap(
      (page) => page.jobs,
    );
    if (jobs.some((job) => job.name === 'agent' && job.conclusion === 'success')) {
      previous = run;
      break;
    }
  }

  const since = new Date(Math.min(cutoff - WEEK, previous ? Date.parse(previous.created_at) : cutoff)).toISOString();
  const commits = (repo) =>
    api(
      `repos/opencollective/${repo}/commits?sha=main&since=${encodeURIComponent(since)}&until=${encodeURIComponent(until)}&per_page=100`,
      true,
    )
      .flat()
      .map(({ sha, html_url, author, commit }) => ({
        sha,
        url: html_url,
        date: commit.committer.date,
        author: author?.login ?? commit.author?.name ?? 'unknown',
        subject: commit.message.split('\n')[0],
        body: commit.message.split('\n').slice(2).join('\n'),
      }));

  return {
    since,
    until,
    previousSuccessfulRunUrl: previous?.html_url ?? null,
    frontendCommits: commits('opencollective-frontend'),
    apiCommits: commits('opencollective-api'),
    openDocsPrs: api('repos/opencollective/documentation/pulls?state=open&per_page=100', true)
      .flat()
      .map((pr) => ({ number: pr.number, title: pr.title, url: pr.html_url, body: pr.body, updatedAt: pr.updated_at })),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const context = buildContext({ repository: process.env.GITHUB_REPOSITORY, runId: process.env.GITHUB_RUN_ID });
  const output = '/tmp/gh-aw/data/context.json';
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, `${JSON.stringify(context, null, 2)}\n`);
  console.log(`Coverage: ${context.since} to ${context.until}`);
  console.log(
    context.previousSuccessfulRunUrl
      ? `Previous successful review: ${context.previousSuccessfulRunUrl}`
      : 'No eligible previous run; using the seven-day initial window.',
  );
  console.log(
    `Frontend commits: ${context.frontendCommits.length}; API commits: ${context.apiCommits.length}; open docs PRs: ${context.openDocsPrs.length}`,
  );
}
