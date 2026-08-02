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
# Everything that is not a rule file is deleted, for two independent reasons.
#
# The upstream repository ships each rule beside its test fixtures, which are
# deliberately vulnerable sample files. Left in place, semgrep would scan them
# as if they were the user's code and report findings against every repository.
#
# It also ships YAML that is not a rule at all — CI workflows, pre-commit
# config, templates. Semgrep treats ONE unparseable file as a fatal
# InvalidRuleSchemaError and abandons the entire config, scanning zero files
# while exiting in a way that looks like a clean result.
#
# So the filter is on content, not filename: a semgrep rule file has a top-level
# `rules:` key. That holds whatever else upstream decides to ship.
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
 && rm -rf /rules/.git /rules/.github \
 && find /rules -type f ! -name '*.yaml' ! -name '*.yml' -delete \
 && find /rules -type f \( -name '*.yaml' -o -name '*.yml' \) \
      -exec sh -c 'grep -qE "^rules:" "$1" || rm -f "$1"' _ {} \; \
 && find /rules -type d -empty -delete \
 && count=$(find /rules -type f | wc -l) \
 && echo "kept ${count} rule files" \
 && [ "${count}" -gt 100 ]

FROM semgrep/semgrep:${SEMGREP_VERSION}

COPY --from=rules /rules /rules

# Semgrep writes both a settings file and a log directory on startup. The
# settings path is configurable; the log directory is not — it is derived from
# $HOME, which is `/` for a uid with no passwd entry, and creating `/.semgrep`
# on a read-only root filesystem aborts the process before any scanning starts.
#
# Pointing HOME at /tmp, the pod's one writable mount, is what makes the image
# runnable as uid 10001 at all.
ENV HOME=/tmp \
    SEMGREP_SETTINGS_FILE=/tmp/semgrep-settings.yml \
    SEMGREP_SEND_METRICS=off

LABEL org.opencontainers.image.title="scorpion-semgrep" \
      org.scorpion.tool="semgrep"

# checkov:skip=CKV_DOCKER_2:A scan Job runs once and exits. There is no
# long-lived process for a HEALTHCHECK to report on, and Kubernetes judges a
# Job by its exit code rather than by container health.

# Matches the runner pod's runAsUser. Declared here as well so the image is
# non-root even if something runs it outside that securityContext; HOME already
# points at /tmp, which is the only path semgrep needs to write.
USER 10001
