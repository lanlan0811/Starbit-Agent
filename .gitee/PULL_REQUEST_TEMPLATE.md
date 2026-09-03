<!--
  Thanks for contributing to Starbit (衔星 | Harness-Agent)!

  Please complete every applicable section and remove the HTML comments.
  Keep the change focused: one logical change per pull request.
-->

# Pull Request

## Title convention

Use a Conventional-Commits style prefix so the change can be classified and released:

`feat:` `fix:` `refactor:` `perf:` `docs:` `test:` `chore:` `build:` `ci:` `prompt:`

Example: `fix: resolve config reload loop when watching prompts directory`

## 1. Summary

<!-- What does this PR do, in a few sentences? Include the user-visible outcome. -->

## 2. Related issue

<!-- Link the issues this PR closes or relates to, e.g. "Closes #12". -->

- Closes #

## 3. Motivation and context

<!-- Why is this change needed? What problem does it solve? What design decisions were made? -->

## 4. Type of change

Check all that apply:

- [ ] New feature (non-breaking addition of functionality)
- [ ] Bug fix (non-breaking correction of existing behavior)
- [ ] Behavior change for the agent or its built-in prompts
- [ ] Refactor / internal cleanup (no behavior change)
- [ ] Performance or stability improvement
- [ ] Documentation update (docs, comments, or `.en` translations)
- [ ] Build / packaging / CI change
- [ ] Breaking change (existing workflows require migration; explain in section 9)

## 5. Changes made

<!-- Summarize the touched areas so reviewers can navigate the diff. -->

- 
- 
- 

## 6. How to test

### Automated checks

- [ ] Lint and formatting checks pass
- [ ] Type checking passes (if the project runs one)
- [ ] Unit / integration tests pass and new behavior is covered by tests

### Manual verification

<!-- List the concrete scenarios you exercised and their expected results. -->

1. 
2. 
3. 

## 7. Screenshots / recordings

<!-- Required for UI or rendering changes. SVG assets preferred; no emoji used as icons. -->

## 8. Documentation impact

- [ ] Built-in prompt behavior changed: `docs/prompts` updated accordingly
- [ ] User-facing docs / error messages updated (including the `.en` English version)
- [ ] `CHANGELOG` entry added (both the Chinese and the `.en` version, if applicable)
- [ ] No documentation impact

## 9. Compatibility notes

<!-- Migration steps, config changes, environment requirements, or anything a
     downstream consumer must know before upgrading. -->

## 10. Contributor checklist

Before requesting review, confirm:

- [ ] I read `CONTRIBUTING.md` and agree to the `CODE_OF_CONDUCT.md`.
- [ ] My change is scoped to this PR; no unrelated edits or formatting noise.
- [ ] No hardcoded environment-specific paths, keys, or credentials were introduced.
- [ ] New assets are SVG; I did not use emoji as icons.
- [ ] I self-reviewed the diff and removed debugging leftovers (logs, `TODO`s, dead code).
- [ ] Commit messages follow the Conventional Commits format referenced in section "Title convention".
- [ ] I verified the change on the supported platform(s); Windows is the primary development platform.

---

_By opening this pull request you confirm that your contribution is made under the
project's license (see `LICENSE`) and that you are entitled to submit it._
