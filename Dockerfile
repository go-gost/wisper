# ---- Stage 1: Web UI ------------------------------------------------
FROM --platform=$BUILDPLATFORM node:22-alpine AS web-builder

WORKDIR /src/web-src
COPY web-src/package.json web-src/package-lock.json ./
RUN npm ci
COPY web-src/ ./
RUN npx vite build --outDir ../web

# ---- Stage 2: Go binary ---------------------------------------------
FROM --platform=$BUILDPLATFORM tonistiigi/xx:1.6.1 AS xx
FROM --platform=$BUILDPLATFORM golang:1.26-alpine3.23 AS go-builder

COPY --from=xx / /

ARG TARGETPLATFORM

RUN xx-info env

ENV CGO_ENABLED=0

ENV XX_VERIFY_STATIC=1

WORKDIR /src

COPY . .

# Inject pre-built web assets
COPY --from=web-builder /src/web/ web/

ARG VERSION=0.0.0-dev

RUN xx-go build -ldflags "-s -w -X github.com/go-gost/wisper/version.Version=${VERSION}" && \
    xx-verify wisper

# ---- Stage 3: Runtime -----------------------------------------------
FROM alpine:3.23

# iptables is how a tun hub shares its LAN: probeShareKernel shells out to
# the iptables CLI to install the MASQUERADE rules, and without it the hub
# visibly downgrades to userspace TCP/UDP (no ping). Alpine's package is
# nft-backed, so this one install covers both backends.
RUN apk add --no-cache iptables

COPY --from=go-builder /src/wisper /usr/local/bin/wisper

EXPOSE 8900

VOLUME ["/root/.config/wisper"]

# Log to stderr so `docker logs` works out of the box. It is an env default, not
# an entrypoint arg, so `-e WISPER_LOG_OUTPUT=...` and `-log.output` both win.
ENV WISPER_LOG_OUTPUT=stderr

ENTRYPOINT ["wisper"]
