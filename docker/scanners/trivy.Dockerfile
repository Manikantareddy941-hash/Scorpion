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

# The database is staged here and is NOT the cache directory trivy is pointed
# at. Trivy opens its BoltDB read-write even with --skip-db-update, so a
# database sitting in an image layer can never be opened from a pod with a
# read-only root filesystem — it fails with `permission denied` no matter what
# the file mode says, because the mount itself is immutable.
#
# The scan therefore copies this into a writable volume first. Costs a local
# copy per scan; the alternative is giving the runner a writable rootfs, which
# is not a trade worth making.
ENV SCORPION_TRIVY_DB=/opt/trivy-db

# The java database is deliberately NOT baked. It is an order of magnitude
# larger and only applies to scanning jar archives, which source-tree scans
# rarely contain. Scans pass --skip-java-db-update so its absence degrades jar
# coverage instead of triggering a download that the NetworkPolicy would block.
RUN trivy image --download-db-only --cache-dir /opt/trivy-db \
 && chmod -R a+rX /opt/trivy-db

# Scan-time caching stays off disk. The root is read-only in the pod, and a
# cache write failure would surface as a scan error rather than a verdict.
ENV TRIVY_CACHE_BACKEND=memory

LABEL org.opencontainers.image.title="scorpion-trivy" \
      org.scorpion.tool="trivy"
