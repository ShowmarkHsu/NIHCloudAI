#!/usr/bin/env bash

echo "release-stable.sh is disabled: NIHCloudAI releases are main-only and must not merge or push a legacy release branch." >&2
echo "Use 'npm run verify' and then the controlled 'npm run release:artifact -- <required options>' workflow from an approved main commit." >&2
exit 1
