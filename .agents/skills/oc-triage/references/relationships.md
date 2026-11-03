# Native issue relationships

Use issue metadata to record substantive relationships found during triage:

- **Related:** overlapping scope, a relevant alternative, or implementation context; it implies no dependency.
- **Blocked by:** this issue cannot proceed until the target prerequisite is resolved. **Blocks** is the inverse direction. Validate the actual dependency and target's current state; a closed, delivered prerequisite normally belongs in related context, not an active blocker.
- Preserve parent/sub-issue structure. Use containment only when established by the issue/project scope, not as a synonym for blocking. Keep duplicate disposition separate from general related links.

Choose connections supported by the investigation, rather than linking every issue mentioned in a thread or sharing a topic. Existing body/comment cross-references do not create native relationship metadata. Deduplicate symmetric related edges and inverse dependency edges when several issues in a batch propose the same link. One endpoint's approved mutation can affect both issues.

## Read and verify capability

Inspect installed `gh issue edit --help` and the live GraphQL schema if support is uncertain. `gh issue edit` supports `--add-blocked-by`, `--add-blocking`, their removal counterparts, parent and sub-issues. The tested CLI (2.102.0) lacks a relates-to flag; `gh api graphql` exposes `addRelatesTo` and `removeRelatesTo`. Live schema introspection and `viewerCanUpdateMetadata` establish capability without an unapproved test write.

Read `relatesTo`, `blockedBy`, `blocking`, `parent`, and `subIssues` with GraphQL. Each connection needs `nodes { id url number title state }` and `pageInfo { hasNextPage endCursor }`; paginate until complete. Preserve canonical issue URLs in snapshots and proposals, using node IDs at mutation time. For cross-repository targets, resolve the actual issue and verify repository, number, state, and scope; PR IDs are not valid issue targets. Relationship mutations need metadata permission on the target too: linking to an issue outside the organization, such as an upstream library bug, fails with a permission error. Check `viewerCanUpdateMetadata` on cross-repository targets before proposing a native link; cite inaccessible upstream issues as evidence or in a comment instead.

```graphql
query {
  repository(owner: "opencollective", name: "opencollective") {
    issue(number: 123) {
      id
      viewerCanUpdateMetadata
      relatesTo(first: 100) {
        nodes {
          id
          url
          number
          title
          state
        }
        pageInfo {
          hasNextPage
          endCursor
        }
      }
      blockedBy(first: 100) {
        nodes {
          id
          url
          number
          title
          state
        }
        pageInfo {
          hasNextPage
          endCursor
        }
      }
      blocking(first: 100) {
        nodes {
          id
          url
          number
          title
          state
        }
        pageInfo {
          hasNextPage
          endCursor
        }
      }
      parent {
        id
        url
        number
        title
        state
      }
      subIssues(first: 100) {
        nodes {
          id
          url
          number
          title
          state
        }
        pageInfo {
          hasNextPage
          endCursor
        }
      }
    }
  }
}
```

## Apply approved changes

Relationship-only changes follow the same per-issue preview, saved approval, and remote-state check as other triage writes. A clear relationship needs no comment announcing the link. Preserve unrelated edges and make only the approved additions/removals.

```bash
gh issue edit 123 --repo opencollective/opencollective --add-blocked-by https://github.com/opencollective/opencollective/issues/456
gh issue edit 123 --repo opencollective/opencollective --add-blocking https://github.com/opencollective/opencollective/issues/789
gh api graphql \
  -f query='mutation($issue:ID!,$related:ID!){addRelatesTo(input:{issueId:$issue,relatedIssueId:$related}){issue{id}relatedIssue{id}}}' \
  -f issue=SOURCE_NODE_ID -f related=TARGET_NODE_ID
```

`removeRelatesTo` uses the same `issueId` and `relatedIssueId` inputs. Dependency mutations use `addBlockedBy`/`removeBlockedBy` with `issueId` (the blocked issue) and `blockingIssueId` (the prerequisite), or use the CLI removal flags. Re-read the affected endpoint metadata after each approved relationship operation. Account for relationships already created through another approved issue in the batch; never blindly repeat writes. If those reciprocal effects are the only intervening change, record their provenance from the earlier approval and verify that the pending operation is already satisfied; any additional material change still requires a refreshed proposal.

API reference: [GitHub Issues GraphQL](https://docs.github.com/en/graphql/reference/issues); CLI reference: [gh issue edit](https://cli.github.com/manual/gh_issue_edit).
