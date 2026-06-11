---
name: support-ticket-reply
description: Drafts paste-ready email replies to Open Collective support tickets by researching user-facing documentation and product behavior. Searches GitBook docs and the local documentation repo for relevant pages and includes links when helpful. Use when the user pastes a support ticket, asks to reply to a support email, draft a help desk response, or invokes /support-ticket-reply.
---

# Support ticket reply

Draft helpful, accurate replies to user support tickets. The user pastes ticket content; you research and return a reply they can send (after review).

Read this skill fully before starting.

## Goal

Answer the user's problem clearly, point them to self-service docs when useful, and flag anything that needs human follow-up. Prefer documentation links over long explanations when docs already cover the topic.

## When not to use this skill

- **Security reports** (vulnerabilities, data leaks, bounty questions) → use `security-investigate-report` instead.
- **Internal engineering handoffs** → use `security-investigate-issue` or normal triage workflows.
- **Documentation updates** → use `documentation-feature-pr` if the gap is missing or outdated public docs.

## Audience and vocabulary

Support tickets come from contributors, collective admins, organization admins, and fiscal host admins. Use user-facing terms from `AGENTS.md`:

- **Contribution** (not "Order") in user-facing copy
- **Account** / **Collective** (not internal API names)
- **Fiscal host** when relevant

Match the ticket language when the user wrote in a non-English locale, unless they clearly expect English.

## Workflow

Copy this checklist and track progress:

```
Task progress:
- [ ] 1. Parse the ticket
- [ ] 2. Search documentation
- [ ] 3. Verify behavior (if docs are unclear)
- [ ] 4. Draft the reply
- [ ] 5. Present reply and internal notes
```

### 1. Parse the ticket

Extract:

- **Who** is writing (role: contributor, collective admin, org admin, host admin, guest)
- **What** they are trying to do or what broke
- **Context** they provided (collective slug, expense ID, screenshots described, error messages, dates)
- **Tone** (frustrated, confused, routine how-to)
- **Urgency signals** (blocked payouts, payment failures, account access)

If the ticket is too vague to answer responsibly, draft a reply that asks **one or two** specific clarifying questions. Do not invent account details or promise actions you cannot verify.

### 2. Search documentation

**Primary:** GitBook MCP (read schemas in the MCP folder first, then call):

1. `searchDocumentation` with 2-4 queries using product terms from the ticket (feature names, settings paths, error text).
2. `getPage` on the best-matching URLs when you need full steps, prerequisites, or related links.

Published docs base URL: `https://documentation.opencollective.com`

**Secondary:** Local repo at `/workspace/opencollective-documentation`:

- Skim `SUMMARY.md` for section names that match the topic.
- Read relevant `.md` files when GitBook search misses or you need the latest unpublished `main` wording.

**Link rule:** Include doc links when they directly help the user solve the problem or understand a policy. Use the **published GitBook URL** from search results, not raw GitHub paths. Prefer 1-3 highly relevant links over a long list.

### 3. Verify behavior (when needed)

If documentation is silent, contradictory, or the ticket describes a possible bug:

- Search `opencollective-frontend` for the settings page, route, or user-visible copy involved.
- Check `opencollective-api` only when the answer depends on permissions, limits, or business rules not visible in the UI.

Do not expose internal implementation details in the reply. Translate findings into user steps, expectations, or "we need to look into this" language.

State clearly when you are **unsure** and recommend human review rather than guessing.

### 4. Draft the reply

Write a **paste-ready email** the support agent can send after light editing.

**Structure:**

1. **Greeting** - Use their name if provided; otherwise a neutral greeting.
2. **Acknowledgment** - Show you understood the issue in one sentence.
3. **Answer** - Steps, explanation, or what happens next. Use short paragraphs or numbered steps.
4. **Documentation** - Link to relevant docs with a brief note on what each page covers.
5. **Follow-up** - Clarifying questions, what to reply with, or what the team will do next.
6. **Sign-off** - Professional close (no signature block unless the user provides one).

**Tone:**

- Warm, direct, and respectful. No blame.
- Plain language; avoid jargon and internal codenames.
- No em dashes in new prose (use hyphens).
- Do not promise refunds, payouts, policy exceptions, or timelines unless the ticket or docs explicitly support it.
- Do not claim a bug is fixed or that engineering will act unless the user instructed you to say so.

**Escalation cues** (mention in internal notes, and soften in the reply):

- Payment processor failures, missing funds, charge disputes
- Account lockout, suspected fraud, GDPR deletion requests
- Host compliance, tax forms, Wise/PayPal/Stripe integration errors on live money
- Clear product bugs reproducible from the ticket

For escalations, draft a reply that sets expectations ("we're looking into this") and list what the team needs from the user.

### 5. Present output

Return two sections in chat:

#### Reply (paste-ready)

The email body only, ready to paste into the help desk.

#### Internal notes (for the agent)

Short bullets only:

- Ticket summary (1 line)
- Doc pages used (titles + URLs)
- Confidence: **high** / **medium** / **low**
- Escalate? **yes** / **no** and why
- Open questions for the user or the team
- Codepaths checked (if any), without dumping stack traces

If confidence is **low**, say so in internal notes and keep the reply conservative.

## Reply templates (adapt; stay accurate)

**How-to / docs answer**

```
Hi [Name],

Thanks for reaching out about [topic].

[Direct answer or numbered steps.]

You can find more detail in our documentation:
- [Page title](https://documentation.opencollective.com/...)

If anything still does not match what you see in your account, reply with [specific artifact] and we will take another look.

Best,
[Team]
```

**Needs more information**

```
Hi [Name],

Thanks for writing in about [topic]. To help you properly, could you share [1-2 specific items]?

In the meantime, this guide may help: [Page title](url).

Best,
[Team]
```

**Likely bug or escalation**

```
Hi [Name],

Thanks for reporting this. [Brief acknowledgment of impact.]

We are looking into [summary]. To speed things up, could you confirm [repro detail or ID]?

[Optional doc link if there is a related setting or workflow.]

We will follow up once we know more.

Best,
[Team]
```

## Guardrails

- Do not fabricate features, policies, or account-specific facts.
- Do not include secrets, API tokens, or internal-only URLs in the reply.
- Do not dismiss the user; even invalid requests deserve a clear, kind explanation.
- Prefer updating your answer with doc links over rewriting doc content in the email.
- If the ticket is really a documentation gap, note it in internal notes; only offer a docs PR if the user asks.

## Output

**Always:** paste-ready reply + internal notes.

**Optional:** If the user asks, save the draft to a file path they specify (e.g. under `priv/support-replies/`).
