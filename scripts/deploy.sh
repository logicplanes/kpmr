#!/usr/bin/env bash
set -Eeuo pipefail

host=${1:?usage: scripts/deploy.sh <ssh host>}
commit=$(git rev-parse HEAD)
git diff --quiet HEAD || { echo "commit your changes first" >&2; exit 1; }
remote=/tmp/kpmr-${commit:0:12}.tar
git archive --format=tar HEAD | ssh "$host" "cat > $remote"
ssh "$host" "install -d /opt/logicplanes/kpmr/bin && tar -xOf $remote deploy/soap/kpmr-deploy > /opt/logicplanes/kpmr/bin/kpmr-deploy && chmod 755 /opt/logicplanes/kpmr/bin/kpmr-deploy && KPMR_ARCHIVE=$remote FORCE=${FORCE:-0} /opt/logicplanes/kpmr/bin/kpmr-deploy $commit; status=\$?; rm -f $remote; exit \$status"
