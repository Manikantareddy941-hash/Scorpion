# Semgrep with its rules vendored in.
#
# `--config auto` is a network call by definition: it resolves the ruleset from
# semgrep.dev on every run, and also reports metrics there. Under the runner's
# default-deny egress NetworkPolicy it cannot work, and scans invoked that way
# fail rather than degrade.
#
# Vendoring the open-source ruleset makes the analysis reproducible as a side
# effect — the same commit scanned twice yields the same findings, which a
# remotely-resolved ruleset cannot promise.
ARG SEMGREP_VERSION=1.97.0

# Cloned in a separate stage so git never ships in the scanning image.
#
# Everything that is not a rule file is deleted: the upstream repository ships
# each rule beside its test fixtures, which are deliberately vulnerable sample
# files. Left in place, semgrep would scan them as if they were the user's code
# and report findings against every repository we look at.
#
# Version-pinning git would tie the build to an Alpine package revision that
# eventually leaves the mirrors, breaking it for no security gain — the base tag
# is pinned and nothing from this stage ships.
FROM alpine:3.20 AS rules
ARG SEMGREP_RULES_REF=develop
# hadolint ignore=DL3018
RUN apk add --no-cache git \
 && git clone --depth 1 --branch "${SEMGREP_RULES_REF}" \
      https://github.com/semgrep/semgrep-rules.git /rules \
 && rm -rf /rules/.git \
 && find /rules -type f ! -name '*.yaml' ! -name '*.yml' -delete \
 && find /rules -type d -empty -delete

FROM semgrep/semgrep:${SEMGREP_VERSION}

COPY --from=rules /rules /rules

# Semgrep writes settings on first run. The pod's root filesystem is read-only
# and /tmp is the one writable mount, so this is pointed there rather than at
# the home directory it would otherwise pick.
ENV SEMGREP_SETTINGS_FILE=/tmp/semgrep-settings.yml \
    SEMGREP_SEND_METRICS=off

LABEL org.opencontainers.image.title="scorpion-semgrep" \
      org.scorpion.tool="semgrep"
