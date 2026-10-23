# syntax=docker/dockerfile:1
#
# RAGE:MP dedicated server — Debian based runtime image.
#
# The server binaries are fetched at build time from the official RAGE:MP CDN.
# They are NOT baked into the repository. The entrypoint copies them into the
# data directory (./server-data on the host) on first start, so the server files
# survive `docker compose down` and can be backed up together with scripts.

ARG DEBIAN_VERSION=12-slim

FROM debian:${DEBIAN_VERSION}

ARG RAGEMP_SERVER_URL="https://cdn.rage.mp/updater/prerelease/server-files/linux_x64.tar.gz"
ARG RAGEMP_ARCHIVE_SHA256=""

SHELL ["/bin/bash", "-o", "pipefail", "-c"]

ENV DEBIAN_FRONTEND=noninteractive \
    TZ=UTC \
    LANG=C.UTF-8 \
    RAGE_APP_DIR=/opt/ragemp \
    RAGE_DATA_DIR=/data

# Runtime libraries required by the Linux build of RAGE:MP plus the tooling the
# entrypoint uses (jq for conf generation, tini for signal handling, procps for
# the healthcheck).
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates \
        curl \
        jq \
        libatomic1 \
        libicu72 \
        libssl3 \
        libunwind8 \
        procps \
        tar \
        tini \
    && rm -rf /var/lib/apt/lists/*

# --- server files -------------------------------------------------------------
RUN set -eux; \
    mkdir -p /tmp/dl "${RAGE_APP_DIR}/server"; \
    curl -fsSL --retry 5 --retry-delay 3 --connect-timeout 20 \
        -o /tmp/dl/server.tar.gz "${RAGEMP_SERVER_URL}"; \
    if [ -n "${RAGEMP_ARCHIVE_SHA256}" ]; then \
        echo "${RAGEMP_ARCHIVE_SHA256}  /tmp/dl/server.tar.gz" | sha256sum -c -; \
    fi; \
    tar -xzf /tmp/dl/server.tar.gz -C /tmp/dl; \
    exe="$(find /tmp/dl -maxdepth 3 -type f -name ragemp-server | head -n1)"; \
    test -n "${exe}"; \
    src="$(dirname "${exe}")"; \
    cp -a "${src}/." "${RAGE_APP_DIR}/server/"; \
    chmod +x "${RAGE_APP_DIR}/server/ragemp-server"; \
    sha256sum /tmp/dl/server.tar.gz | awk '{print $1}' > "${RAGE_APP_DIR}/server/.server-version"; \
    rm -rf /tmp/dl

# --- application layer --------------------------------------------------------
COPY entrypoint.sh "${RAGE_APP_DIR}/entrypoint.sh"
COPY config/ "${RAGE_APP_DIR}/config/"
COPY scripts/gen-conf.sh "${RAGE_APP_DIR}/scripts/gen-conf.sh"

RUN chmod +x "${RAGE_APP_DIR}/entrypoint.sh" "${RAGE_APP_DIR}/scripts/gen-conf.sh" \
    && chmod -R a+rX "${RAGE_APP_DIR}" \
    && groupadd --gid 1000 ragemp \
    && useradd --uid 1000 --gid 1000 --home-dir "${RAGE_DATA_DIR}" \
        --shell /usr/sbin/nologin --no-create-home ragemp \
    && mkdir -p "${RAGE_DATA_DIR}" \
    && chown ragemp:ragemp "${RAGE_DATA_DIR}"

USER ragemp
WORKDIR /data

# 22005/udp + 22005/tcp — game protocol; 22006/tcp — HTTP for client packages.
EXPOSE 22005/udp 22005/tcp 22006/tcp

HEALTHCHECK --interval=30s --timeout=5s --start-period=90s --retries=3 \
    CMD pgrep -f ragemp-server >/dev/null || exit 1

ENTRYPOINT ["/usr/bin/tini", "--", "/opt/ragemp/entrypoint.sh"]
CMD []
