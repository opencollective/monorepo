#!/usr/bin/env python3
"""Offline regression tests: mocked gh, real temporary Git repos, no network."""
import copy
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

SCRIPTS = Path(__file__).resolve().parent


def run(args, **kwargs):
    return subprocess.run(args, text=True, capture_output=True, timeout=20, **kwargs)


def pr(conclusion='SUCCESS', **fields):
    result = dict(number=1, title='chore(deps): bump', state='OPEN', headRefOid='head-one',
                  headRefName='renovate/test', mergeable='MERGEABLE', mergeStateStatus='CLEAN',
                  isDraft=False, author={'login': 'app/renovate'}, reviewDecision='APPROVED',
                  statusCheckRollup=[dict(name='test', status='COMPLETED', conclusion=conclusion)],
                  commits=[{'authors': [{'login': 'renovate[bot]'}]}],
                  body='- [ ] <!-- rebase-check -->Rebase', labels=[], updatedAt='2026-09-28')
    result.update(fields)
    return result


class Helpers(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.bin = self.root / 'bin'
        self.bin.mkdir()
        self.fixture = self.root / 'fixture.json'
        self.log = self.root / 'calls.jsonl'
        self.env = dict(os.environ, PATH=str(self.bin) + ':' + os.environ['PATH'],
                        FIXTURE=str(self.fixture), CALLS=str(self.log),
                        COUNTERS=str(self.root / 'counters.json'), TIMEOUT_MIN='0', INTERVAL='0')
        gh = self.bin / 'gh'
        gh.write_text('''#!/usr/bin/env python3
import json, os, pathlib, subprocess, sys
args = sys.argv[1:]
with open(os.environ['CALLS'], 'a') as f: f.write(json.dumps(args) + '\\n')
f = json.load(open(os.environ['FIXTURE']))
if args[:2] == ['api', 'user']:
    print('reviewer'); sys.exit()
if args[:2] == ['pr', 'view']:
    key = args[2]
    counter = pathlib.Path(os.environ['COUNTERS'])
    counts = json.loads(counter.read_text()) if counter.exists() else {}
    index = counts.get(key, 0)
    values = f.get('prs', {}).get(key, [f.get('pr', {})])
    value = values[min(index, len(values)-1)]
    counts[key] = index + 1
    counter.write_text(json.dumps(counts))
elif args[:2] == ['api', 'graphql']: value = f['graphql']
elif args[:2] == ['pr', 'list']: value = [f['pr']]
elif args[:2] == ['run', 'list']: value = f.get('runs', [])
elif args[:2] == ['run', 'view'] and '--log' in args:
    print(f.get('log', ''), end=''); sys.exit()
elif args[:2] == ['run', 'view']: value = {'jobs': f.get('jobs', []), 'status': 'completed'}
elif args[:2] == ['pr', 'checks']: value = []
elif args[:2] == ['issue', 'edit']:
    pathlib.Path(os.environ['CALLS']).with_name('edited.md').write_text(sys.stdin.read()); sys.exit()
elif args[:2] == ['issue', 'list']:
    edited = pathlib.Path(os.environ['CALLS']).with_name('edited.md')
    issue = dict(f['issue'])
    if edited.exists() and not f.get('rewrite'): issue['body'] = edited.read_text()
    value = [issue]
elif args[0] == 'api' and '/compare/' in args[1]: value = {'behind_by': 2}
else: sys.exit(0)
query = args[args.index('--jq')+1] if '--jq' in args else '.'
r = subprocess.run(['jq', '-r', query], input=json.dumps(value), text=True)
sys.exit(r.returncode)
''')
        gh.chmod(0o755)

    def call(self, script, fixture, *args, env=None, cwd=None):
        self.fixture.write_text(json.dumps(fixture))
        return run(['bash', str(SCRIPTS / script), 'api', *args], env=env or self.env, cwd=cwd)

    def calls(self):
        return [json.loads(line) for line in self.log.read_text().splitlines()]

    def test_resolve_repo_accepts_every_service_and_rejects_others(self):
        lib = SCRIPTS / '_lib.sh'
        for short, slug in [('api', 'opencollective-api'), ('frontend', 'opencollective-frontend'),
                            ('rest', 'opencollective-rest'), ('images', 'opencollective-images'),
                            ('pdf', 'opencollective-pdf')]:
            for name in (short, slug, 'opencollective/' + slug):
                result = run(['bash', '-c', f'source "{lib}"; resolve_repo "{name}"; echo "$REPO $SHORT"'], env=self.env)
                self.assertEqual(result.stdout.strip(), f'opencollective/{slug} {short}', result.stderr)
        result = run(['bash', '-c', f'source "{lib}"; resolve_repo taxes'], env=self.env)
        self.assertEqual(result.returncode, 2)
        self.assertIn('<api|frontend|rest|images|pdf>', result.stderr)

    def test_shell_syntax(self):
        for file in SCRIPTS.glob('*.sh'):
            with self.subTest(file=file.name):
                result = run(['bash', '-n', str(file)])
                self.assertEqual(result.returncode, 0, result.stderr)

    def test_merge_rejects_non_green_checks(self):
        for conclusion in ['CANCELLED', 'FAILURE', 'TIMED_OUT', 'ACTION_REQUIRED', 'STALE', 'UNKNOWN']:
            with self.subTest(conclusion=conclusion):
                result = self.call('merge.sh', {'pr': pr(conclusion)}, '1')
                self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertFalse(any(c[:2] == ['pr', 'merge'] for c in self.calls()))

    def test_merge_rejects_missing_pending_and_unknown_mergeability(self):
        values = [pr(statusCheckRollup=[]), pr(mergeable='UNKNOWN'), pr(state='CLOSED'),
                  pr(statusCheckRollup=[dict(name='test', status='IN_PROGRESS', conclusion='')])]
        for value in values:
            result = self.call('merge.sh', {'pr': value}, '1')
            self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertFalse(any(c[:2] == ['pr', 'merge'] for c in self.calls()))

    def test_merge_pins_head(self):
        result = self.call('merge.sh', {'pr': pr()}, '1')
        self.assertEqual(result.returncode, 0, result.stderr)
        merge = next(c for c in self.calls() if c[:2] == ['pr', 'merge'])
        self.assertEqual(merge[merge.index('--match-head-commit') + 1], 'head-one')
        self.assertNotIn('--admin', merge)

    def test_review_requires_explicit_flag(self):
        result = self.call('merge.sh', {'pr': pr(reviewDecision='REVIEW_REQUIRED')}, '1')
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(any('APPROVE' in ' '.join(c) for c in self.calls()))
        result = self.call('merge.sh', {'pr': pr(reviewDecision='REVIEW_REQUIRED')}, '--approve', '1')
        self.assertEqual(result.returncode, 0, result.stderr)
        review = next(c for c in self.calls() if 'event=APPROVE' in c)
        self.assertIn('commit_id=head-one', review)

    def test_ai_review_matches_full_head(self):
        head = '0123456789abcdef0123456789abcdef01234567'
        value = {'headRefOid': head, 'reviewThreads': {'nodes': []},
                 'reviews': {'nodes': [
                     {'author': {'login': 'coderabbit'}, 'state': 'COMMENTED',
                      'commit': {'oid': head}, 'body': 'current finding'},
                     {'author': {'login': 'coderabbit'}, 'state': 'COMMENTED',
                      'commit': {'oid': 'old-head'}, 'body': 'obsolete finding'}]}}
        result = self.call('ai-review.sh', {'graphql': {'data': {'repository': {'pullRequest': value}}}}, '1')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('current finding', result.stdout)
        self.assertNotIn('obsolete finding', result.stdout)

    def test_own_pr_needing_review_does_not_bypass(self):
        result = self.call('merge.sh', {'pr': pr(author={'login': 'reviewer'},
                                               reviewDecision='REVIEW_REQUIRED')}, '--approve', '1')
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn('--admin', result.stdout)
        self.assertFalse(any(c[:2] == ['pr', 'merge'] for c in self.calls()))

    def test_own_pr_can_merge_after_another_review(self):
        result = self.call('merge.sh', {'pr': pr(author={'login': 'reviewer'})}, '1')
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_wait_cancelled_is_red(self):
        result = self.call('wait-checks.sh', {'pr': pr('CANCELLED')}, '1')
        self.assertEqual(result.returncode, 1, result.stderr)
        self.assertIn('RED', result.stdout)

    def test_wait_requires_rebased_head(self):
        heads = self.root / 'heads'
        heads.write_text('1 head-one\n')
        env = dict(self.env, EXPECT_HEAD_CHANGE='1', HEADS_FILE=str(heads))
        result = self.call('wait-checks.sh', {'pr': pr()}, '1', env=env)
        self.assertEqual(result.returncode, 2, result.stderr)
        self.assertNotIn('GREEN', result.stdout)

    def test_wait_rechecks_previously_finished_prs(self):
        pending = pr(statusCheckRollup=[dict(name='test', status='IN_PROGRESS', conclusion='')])
        fixture = {'prs': {'1': [pr(), pr('FAILURE', headRefOid='head-two')], '2': [pending, pr()]}}
        result = self.call('wait-checks.sh', fixture, '1', '2', env=dict(self.env, TIMEOUT_MIN='1'))
        self.assertEqual(result.returncode, 1, result.stderr)
        self.assertIn('#1: RED (head-two)', result.stdout)

    def test_rebase_rejects_foreign_coauthor(self):
        value = pr(commits=[{'authors': [{'login': 'renovate[bot]'}, {'login': 'human'}]}])
        result = self.call('rebase.sh', {'pr': value}, '1')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('foreign', result.stdout)
        self.assertFalse(any(c[:2] == ['pr', 'edit'] for c in self.calls()))

    def test_rebase_bot_branch_uses_body_stdin(self):
        result = self.call('rebase.sh', {'pr': pr()}, '1')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue(any('--body-file' in c for c in self.calls()))

    DASHBOARD = ('## PR Closed (Blocked)\n\n'
                 ' - [ ] <!-- recreate-branch=renovate/sinon-chai-4.x -->[chore(deps): update dependency sinon-chai to v4](../pull/10407)\n'
                 ' - [ ] <!-- recreate-branch=renovate/fake-tag-5.x -->[chore(deps): update dependency fake-tag to v5](../pull/9976)\n')

    def test_recreate_ticks_only_requested_entries(self):
        result = self.call('recreate.sh', {'issue': {'number': 6506, 'body': self.DASHBOARD}}, '10407')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('renovate/sinon-chai-4.x: recreate requested on #6506', result.stdout)
        edited = (self.root / 'edited.md').read_text()
        self.assertIn(' - [x] <!-- recreate-branch=renovate/sinon-chai-4.x -->', edited)
        self.assertIn(' - [ ] <!-- recreate-branch=renovate/fake-tag-5.x -->', edited)

    def test_recreate_accepts_branch_and_skips_unknown_without_editing(self):
        result = self.call('recreate.sh', {'issue': {'number': 6506, 'body': self.DASHBOARD}}, 'renovate/nope')
        self.assertIn('not in PR Closed (Blocked)', result.stdout)
        self.assertFalse(any(c[:2] == ['issue', 'edit'] for c in self.calls()))
        result = self.call('recreate.sh', {'issue': {'number': 6506, 'body': self.DASHBOARD}}, 'renovate/fake-tag-5.x')
        self.assertIn('renovate/fake-tag-5.x: recreate requested', result.stdout)

    def test_recreate_reports_tick_lost_to_renovate_rewrite(self):
        result = self.call('recreate.sh', {'issue': {'number': 6506, 'body': self.DASHBOARD}, 'rewrite': True}, '9976')
        self.assertEqual(result.returncode, 1)
        self.assertIn('tick not found after edit', result.stderr)

    def test_healthy_running_workflow_does_not_abort_rerun(self):
        fixture = {'pr': pr(), 'runs': [dict(databaseId=1, workflowName='CI', conclusion='', status='in_progress')]}
        result = self.call('rerun.sh', fixture, '1')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('nothing failed', result.stdout)
        self.assertFalse(any(c[:2] == ['run', 'rerun'] for c in self.calls()))

    def test_inventory_marks_cancelled_checks_failing(self):
        result = self.call('list-prs.sh', {'pr': pr('CANCELLED')}, '--json')
        self.assertEqual(result.returncode, 0, result.stderr)
        value = json.loads(result.stdout)[0]
        self.assertFalse(value['green'])
        self.assertEqual(value['failing'], ['test'])

    def test_inventory_incomplete_author_page_fetches_all_commit_authors(self):
        value = pr(commits=[{'authors': [{'login': 'human'}, {'login': 'renovate[bot]'}]}])
        graphql = {'data': {'repository': {'pullRequests': {'nodes': [{
            'number': 1, 'commits': {'pageInfo': {'hasPreviousPage': True}, 'nodes': [{
                'commit': {'authors': {'pageInfo': {'hasNextPage': False},
                                       'nodes': [{'user': {'login': 'renovate[bot]'}}]}}}]}}]}}}}
        result = self.call('list-prs.sh', {'pr': value, 'graphql': graphql}, '--json', '--fast')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout)[0]['foreign'], ['human'])
        self.assertTrue(any(c[:2] == ['pr', 'view'] for c in self.calls()))

    def test_ai_review_truncated_history_reports_incomplete(self):
        value = {'headRefOid': 'head-one',
                 'reviewThreads': {'pageInfo': {'hasNextPage': True}, 'nodes': []},
                 'reviews': {'pageInfo': {'hasPreviousPage': False}, 'nodes': []}}
        result = self.call('ai-review.sh', {'graphql': {'data': {'repository': {'pullRequest': value}}}}, '1')
        self.assertEqual(result.returncode, 2, result.stdout + result.stderr)
        self.assertIn('paginate', result.stderr)


    def checkout(self):
        scripts = self.root / '.agents/skills/package-updates/scripts'
        shutil.copytree(SCRIPTS, scripts)
        repo = self.root / 'opencollective-api'
        repo.mkdir()
        def git(*args):
            result = run(['git', '-c', 'core.hooksPath=/dev/null', *args], cwd=repo)
            self.assertEqual(result.returncode, 0, result.stderr)
            return result.stdout.strip()
        git('init', '-q', '-b', 'main')
        git('config', 'user.email', 'fixture@example.com')
        git('config', 'user.name', 'Fixture')
        def commit(pkg, lock):
            (repo / 'package.json').write_text(json.dumps(pkg))
            (repo / 'package-lock.json').write_text(json.dumps(lock))
            git('add', 'package.json', 'package-lock.json')
            git('commit', '-qm', 'fixture')
        commit({'dependencies': {'pkg': '1', 'other': '1'}}, {'stamp': 'base'})
        git('checkout', '-qb', 'renovate/test')
        commit({'dependencies': {'pkg': '2', 'other': '1'}}, {'stamp': 'pr'})
        git('checkout', 'main')
        commit({'dependencies': {'pkg': '1', 'other': '2'}}, {'stamp': 'main'})
        git('remote', 'add', 'origin', str(repo))
        self.fixture.write_text(json.dumps({'pr': pr()}))
        env = dict(self.env, SCRATCH=str(self.root / 'scratch'), HOME=str(self.root))
        wt = self.root / 'scratch/package-updates/wt-api-1'
        return scripts, repo, env, wt

    def test_local_rebase_preserves_existing_worktree(self):
        scripts, repo, env, wt = self.checkout()
        wt.mkdir(parents=True)
        marker = wt / 'uncommitted-fix'
        marker.write_text('keep me')
        result = run(['bash', str(scripts / 'local-rebase.sh'), 'api', '1'], env=env)
        self.assertEqual(result.returncode, 2, result.stderr)
        self.assertEqual(marker.read_text(), 'keep me')

    def test_local_rebase_preserves_clean_unpushed_rebase(self):
        scripts, repo, env, wt = self.checkout()
        npm = self.bin / 'npm'
        npm.write_text("""#!/usr/bin/env python3
import json, pathlib, sys
if sys.argv[1] == 'install':
    pathlib.Path('package-lock.json').write_text(json.dumps({'packages': {}}))
""")
        npm.chmod(0o755)
        first = run(['bash', str(scripts / 'local-rebase.sh'), 'api', '1'], env=env)
        self.assertEqual(first.returncode, 0, first.stdout + first.stderr)
        head = run(['git', 'rev-parse', 'HEAD'], cwd=wt).stdout.strip()
        second = run(['bash', str(scripts / 'local-rebase.sh'), 'api', '1'], env=env)
        self.assertEqual(second.returncode, 2, second.stdout + second.stderr)
        self.assertIn('unpushed work', second.stderr)
        self.assertEqual(run(['git', 'rev-parse', 'HEAD'], cwd=wt).stdout.strip(), head)
        # a dirty worktree is still preserved
        (wt / 'uncommitted-fix').write_text('keep me')
        third = run(['bash', str(scripts / 'local-rebase.sh'), 'api', '1'], env=env)
        self.assertEqual(third.returncode, 2, third.stdout + third.stderr)
        self.assertEqual((wt / 'uncommitted-fix').read_text(), 'keep me')

    def test_local_rebase_reuses_worktree_at_remote_head(self):
        scripts, repo, env, wt = self.checkout()
        wt.parent.mkdir(parents=True)
        result = run(['git', 'worktree', 'add', '--detach', str(wt), 'renovate/test'], cwd=repo)
        self.assertEqual(result.returncode, 0, result.stderr)
        npm = self.bin / 'npm'
        npm.write_text('#!/bin/sh\nexit 0\n')
        npm.chmod(0o755)
        result = run(['bash', str(scripts / 'local-rebase.sh'), 'api', '1'], env=env)
        self.assertIn('reusing clean worktree', result.stdout)

    def test_status_propagates_helper_failure(self):
        result = run(['bash', str(SCRIPTS / 'status.sh'), 'invalid'], env=self.env)
        self.assertEqual(result.returncode, 1, result.stderr)
        self.assertIn('Status unavailable', result.stdout)

    def test_approve_records_review_without_required_protection(self):
        result = self.call('merge.sh', {'pr': pr(reviewDecision='')}, '--approve', '1')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue(any('event=APPROVE' in c for c in self.calls()))

    def local_review(self, transcript, exit_code=0, model=None):
        repo = self.root / 'review-worktree'
        repo.mkdir()
        for args in [('init', '-q'), ('config', 'user.email', 'fixture@example.com'),
                     ('config', 'user.name', 'Fixture'), ('commit', '--allow-empty', '-qm', 'base'),
                     ('update-ref', 'refs/remotes/origin/main', 'HEAD')]:
            result = run(['git', *args], cwd=repo)
            self.assertEqual(result.returncode, 0, result.stderr)
        codex = self.bin / 'codex'
        codex.write_text('''#!/usr/bin/env python3
import json, os, sys
from pathlib import Path
Path(os.environ['CODEX_ARGS']).write_text(json.dumps(sys.argv[1:]))
print(os.environ['REVIEW_TRANSCRIPT'])
sys.exit(int(os.environ['REVIEW_EXIT']))
''')
        codex.chmod(0o755)
        env = dict(self.env, SCRATCH=str(self.root), REVIEW_TRANSCRIPT=transcript,
                   REVIEW_EXIT=str(exit_code), CODEX_ARGS=str(self.root / 'codex-args'))
        env.pop('CODEX_MODEL', None)
        if model: env['CODEX_MODEL'] = model
        return self.call('ai-review.sh', {}, '--worktree', str(repo), 'dependency update', env=env)

    def test_local_review_preserves_verdict_and_model_argument(self):
        result = self.local_review('tool output\ncodex\nNo findings.\nNo findings.', model='requested-model')
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn('Reviewed head=', result.stdout)
        self.assertEqual(result.stdout.count('No findings.'), 2)
        args = json.loads((self.root / 'codex-args').read_text())
        self.assertEqual(args[:2], ['-c', 'model="requested-model"'])

    def test_local_review_missing_verdict_is_incomplete(self):
        result = self.local_review('tool output only')
        self.assertEqual(result.returncode, 2, result.stdout + result.stderr)

    def test_local_review_cli_failure_keeps_transcript_path(self):
        result = self.local_review('unexpected CLI failure', exit_code=1)
        self.assertEqual(result.returncode, 2, result.stdout + result.stderr)
        self.assertIn('transcript:', result.stdout)

    def test_local_review_usage_limit_is_incomplete_even_with_zero_exit(self):
        result = self.local_review('codex\nYou have hit your usage limit.')
        self.assertEqual(result.returncode, 2, result.stdout + result.stderr)

    def test_relative_local_rebase_preserves_full_regenerated_lockfile(self):
        scripts, repo, env, wt = self.checkout()
        npm = self.bin / 'npm'
        npm.write_text('''#!/usr/bin/env python3
import json, pathlib, sys
if sys.argv[1] == 'install':
    pathlib.Path('package-lock.json').write_text(json.dumps({'packages': {'node_modules/new-transitive': {'version': '1.0.0'}}}))
''')
        npm.chmod(0o755)
        result = run(['bash', str((scripts / 'local-rebase.sh').relative_to(self.root)), 'api', '1', '--push'],
                     cwd=self.root, env=env)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn('not pushed', result.stdout)
        self.assertTrue(wt.exists())
        package = json.loads((wt / 'package.json').read_text())
        lock = json.loads((wt / 'package-lock.json').read_text())
        self.assertEqual(package['dependencies'], {'pkg': '2', 'other': '2'})
        self.assertIn('node_modules/new-transitive', lock['packages'])


    def failure_output(self, lines):
        fixture = {
            'pr': pr('FAILURE'),
            'runs': [dict(databaseId=10, workflowName='CI', conclusion='failure', status='completed')],
            'jobs': [dict(databaseId=20, name='test', conclusion='failure')],
            'log': ''.join('test\tRun tests\t2026-09-28T09:00:00Z ' + line + '\n' for line in lines),
        }
        result = self.call('failures.sh', fixture, '1')
        self.assertEqual(result.returncode, 0, result.stderr)
        return result.stdout

    def test_failure_summary_excludes_expected_errors_and_cleanup(self):
        output = self.failure_output([
            'SequelizeDatabaseError: deadlock detected',
            'Cannot query field "expected" on type "TestFixture"',
            '  1 failing',
            '  1) lib/two-factor-authentication',
            "     Error: Cannot get schema for 'ECDSASigValue' target",
            '       at AsnParser.parse (node_modules/asn1/parser.js:18:26)',
            '##[error]Process completed with exit code 1.',
            '  SequelizeDatabaseError: deadlock detected',
        ])
        self.assertIn('ECDSASigValue', output)
        self.assertIn('real: WebAuthn ASN.1 schema registry mismatch', output)
        self.assertNotIn('unit flake:', output)
        self.assertNotIn('schema mismatch:', output)

    def test_failure_summary_still_matches_actual_deadlock(self):
        output = self.failure_output([
            "Error: Cannot get schema for 'ECDSASigValue' target",
            'Cannot query field "expected" on type "TestFixture"',
            '  1 failing',
            '  1) resetTestDB',
            '     SequelizeDatabaseError: deadlock detected',
            '##[error]Process completed with exit code 1.',
        ])
        self.assertIn('unit flake: Postgres', output)
        self.assertNotIn('real: WebAuthn', output)
        self.assertNotIn('schema mismatch:', output)

    def test_caret_escaped_colours_do_not_hide_failure_summary(self):
        output = self.failure_output([
            'SequelizeDatabaseError: deadlock detected',
            '^[[31m  1 failing^[[0m',
            '  1) Expense flow',
            '     Timed out retrying after 30050ms',
            '     at Context.eval (27-expenses.test.ts:985:7)',
            '##[error]Process completed with exit code 1.',
        ])
        self.assertIn('failure-summary signatures', output)
        self.assertIn('e2e flake: 27-expenses', output)
        self.assertNotIn('unit flake: Postgres', output)
        self.assertNotIn('incidental whole-log hints', output)

    def test_unsupported_failure_format_only_provides_incidental_hints(self):
        output = self.failure_output(['Error: socket hang up'])
        self.assertIn('classification: unclassified', output)
        self.assertIn('incidental whole-log hints only; not a diagnosis or a reason to retry', output)
        self.assertNotIn('failure-summary signatures', output)

    def test_local_rebase_stops_on_lockfile_only_conflict_even_with_push(self):
        scripts, repo, env, wt = self.checkout()
        def git(*args, cwd=repo):
            result = run(['git', '-c', 'core.hooksPath=/dev/null', *args], cwd=cwd)
            self.assertEqual(result.returncode, 0, result.stderr)
            return result.stdout.strip()
        base = git('rev-list', '--max-parents=0', 'HEAD')
        git('checkout', 'renovate/test')
        git('checkout', base, '--', 'package.json')
        git('commit', '--amend', '-qm', 'Lockfile-only update')
        old = git('rev-parse', 'HEAD')
        git('checkout', 'main')
        marker = self.root / 'npm-was-called'
        npm = self.bin / 'npm'
        npm.write_text('#!/bin/sh\ntouch "$NPM_MARKER"\nexit 1\n')
        npm.chmod(0o755)
        env['NPM_MARKER'] = str(marker)
        result = run(['bash', str(scripts / 'local-rebase.sh'), 'api', '1', '--push'], env=env)
        self.assertEqual(result.returncode, 3, result.stdout + result.stderr)
        self.assertIn('lockfile-only conflict', result.stderr)
        self.assertIn('Renovate', result.stderr)
        self.assertFalse(marker.exists(), 'Must stop before regenerating the lockfile')
        self.assertTrue(wt.exists())
        self.assertEqual(git('rev-parse', 'renovate/test'), old)
        self.assertEqual(git('diff', '--name-only', '--diff-filter=U', cwd=wt), 'package-lock.json')
        self.assertEqual(json.loads(git('show', ':3:package-lock.json', cwd=wt)), {'stamp': 'pr'})


class Manifest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.repo = Path(self.tmp.name)
        self.git('init', '-q')
        self.git('config', 'user.email', 'fixture@example.com')
        self.git('config', 'user.name', 'Fixture')
        self.original = {'dependencies': {'pkg': '1', 'other': '1'}, 'scripts': {'test': 'old'},
                         'overrides': {'nested': {'first': '1', 'second': '1'}}}
        self.base = self.commit(self.original)

    def git(self, *args):
        result = run(['git', '-c', 'core.hooksPath=/dev/null', *args], cwd=self.repo)
        if result.returncode: raise AssertionError(result.stderr)
        return result.stdout.strip()

    def commit(self, package):
        (self.repo / 'package.json').write_text(json.dumps(package))
        self.git('add', 'package.json')
        self.git('commit', '-qm', 'fixture')
        return self.git('rev-parse', 'HEAD')

    def replay(self, change, current):
        commit = self.commit(change)
        onto = self.commit(current)
        result = run(['node', str(SCRIPTS / 'reapply-bump.js'), self.base, commit, onto], cwd=self.repo)
        return result, json.loads((self.repo / 'package.json').read_text())

    def test_preserves_main_and_replays_scripts_and_nested_changes(self):
        change = copy.deepcopy(self.original)
        change['dependencies']['pkg'] = '2'
        change['scripts']['test'] = 'new'
        change['overrides']['nested']['first'] = '2'
        current = copy.deepcopy(self.original)
        current['dependencies']['other'] = '2'
        current['overrides']['nested']['second'] = '2'
        result, merged = self.replay(change, current)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(merged['dependencies'], {'pkg': '2', 'other': '2'})
        self.assertEqual(merged['scripts']['test'], 'new')
        self.assertEqual(merged['overrides']['nested'], {'first': '2', 'second': '2'})

    def test_overlapping_changes_fail_without_writing(self):
        change = copy.deepcopy(self.original)
        change['dependencies']['pkg'] = '2'
        current = copy.deepcopy(self.original)
        current['dependencies']['pkg'] = '3'
        result, merged = self.replay(change, current)
        self.assertEqual(result.returncode, 3, result.stderr)
        self.assertEqual(merged, current)


if __name__ == '__main__':
    unittest.main(verbosity=2)
