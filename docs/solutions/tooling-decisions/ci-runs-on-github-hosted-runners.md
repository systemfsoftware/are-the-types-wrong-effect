---
problem_type: tooling_decision
---

# CI Runs on GitHub-Hosted Runners

`ci.yml` named `blacksmith-8vcpu-ubuntu-2404` (check) and `blacksmith-4vcpu-ubuntu-2404` (e2e), added in
f95a34b2e (#45). No runner serves those labels for this organization: run 43365717817 left both jobs queued, and 12
runs were queued behind it, so no pull request could pass CI. Both jobs run on `ubuntu-latest`, which is free for a
public repository and serves every other repository in the organization. A paid fast runner does not address the cost
that dominates a job here, which is cold Nix provisioning.
