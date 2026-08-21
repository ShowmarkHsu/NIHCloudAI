# Upstream synchronization policy

## Repository roles

The intended repository topology is fixed:

| Remote | Role | Repository |
| --- | --- | --- |
| `origin` | NIHCloudAI product fork | `ShowmarkHsu/NHITW_cloud_analyzer_react_MUI` |
| `upstream` | NHITW Cloud Analyzer source | `leescot/NHITW_cloud_analyzer_react_MUI` |
| `nicloudai` | NIHCloudAI AI/security source | `ShowmarkHsu/NIHCloudAI` |

On 2026-08-14 the final fork was verified through the GitHub API as a fork of
the configured upstream, and the authenticated maintainer had push permission.
The independent integration worktree now uses the three remote roles above.
The exact result is recorded in [`baseline.json`](baseline.json); this topology
verification did not push, create a branch on GitHub, or modify `main`.

The only long-lived branch is `main`. Feature, fix, and synchronization work
uses short-lived `codex/*` branches. Formal history must not be rebased or
force-pushed.

## Fixed baseline and provenance

- The integration baseline is upstream commit
  `cad76e59c60eafc2947939fc44d7683ba9f7ab9d`, product version `26.0702.1`.
- Reused NIHCloudAI concepts or code must cite source commit
  `bab69c741e1f6a5b2da65276ce8fe955973e05ca` in the implementing commit or PR.
- The upstream Apache-2.0 [`LICENSE`](../../LICENSE) is retained unchanged.
  [`NOTICE`](../../NOTICE) records upstream and NIHCloudAI attribution.
- 此分支尚未有 NIHCloudAI release identity、獨立 Semantic Version 或 annotated
  tag。現有 Chrome extension version `26.0702.1` 是 upstream fork 相容版本，
  不得在文件、artifact 或 UI 中誤稱為 NIHCloudAI release。未來 release owner
  僅能在完成治理與臨床 gate 後指派獨立 SemVer；upstream version 同時仍須保留
  為 provenance。

## Synchronization triggers

The accountable maintainer checks upstream:

1. monthly;
2. before every controlled-pilot release; and
3. immediately for a security fix, NHI page compatibility fix, or material
   source-data-format change.

## Synchronization procedure

1. Start a short-lived sync branch from the latest `main`.
2. Record the pre-sync upstream commit, target upstream commit, changed paths,
   and baseline hashes.
3. Merge upstream with an explicit merge commit. Do not rebase formal history.
4. Run the non-AI characterization suite, clinical seam safety suite, and the
   applicable clinical evidence gates.
5. Have the accountable maintainer review and merge the PR into `main`.

Selective transplantation is allowed only when a stopped full sync contains an
independently reviewable fix. Its commit and changed paths must retain explicit
upstream provenance.

## Stop conditions and rollback

Stop the sync if any of the following is true:

- the final fork or required source commit is unavailable;
- non-AI observable behavior changes without reviewed product intent;
- the AI safety seam, patient/revision isolation, or projection compatibility
  gate fails; or
- required clinical evidence is missing, expired, or invalidated.

Do not work around a stop by force-pushing, rebasing formal history, weakening a
test, or silently broadening model input. A merged upstream sync is rolled back
with a revert of its merge commit. An unmerged batch is rolled back by removing
only its isolated worktree/short-lived branch; the original dirty worktree is
never reset or cleaned.
