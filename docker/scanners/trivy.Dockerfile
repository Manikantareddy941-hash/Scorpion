# Trivy with its vulnerability database baked in.
#
# The runner namespace has a default-deny egress NetworkPolicy, so a scanner
# that downloads its signatures at scan time cannot work there at all. This
# moves the download to build time, where egress exists and is audited.
#
# The database is fetched ONCE here and never refreshed at runtime, which is why
# the freshness of this image is a security property rather than a detail: a
# stale database reports "no vulnerabilities" for CVEs it has simply never heard
# of. The build stamps org.scorpion.db.built-at and the backend refuses an image
# whose stamp is too old or unreadable.
ARG TRIVY_VERSION=0.58.1
FROM aquasec/trivy:${TRIVY_VERSION}

# Not /root/.cache: the runner pod executes as uid 10001 with a read-only root
# filesystem, so the database has to live somewhere world-readable and be
# addressed explicitly with --cache-dir.
ENV TRIVY_CACHE_DIR=/db

# The java database is deliberately NOT baked. It is an order of magnitude
# larger and only applies to scanning jar archives, which source-tree scans
# rarely contain. Scans pass --skip-java-db-update so its absence degrades jar
# coverage instead of triggering a download that the NetworkPolicy would block.
RUN trivy image --download-db-only --cache-dir /db \
 && chmod -R a+rX /db

# Scan-time caching must not touch the filesystem — the root is read-only in the
# pod, and a cache write failure would surface as a scan error rather than a
# verdict.
ENV TRIVY_CACHE_BACKEND=memory

LABEL org.opencontainers.image.title="scorpion-trivy" \
      org.scorpion.tool="trivy"
