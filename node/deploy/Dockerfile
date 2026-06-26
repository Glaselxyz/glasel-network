# GlaselOS node daemon — multi-stage build.
# Build context is the repo root: `docker build -f node/deploy/Dockerfile .`
FROM rust:1-bookworm AS build
WORKDIR /src
COPY node /src/node
WORKDIR /src/node
RUN cargo build --release -p glaseld

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY --from=build /src/node/target/release/glaseld /usr/local/bin/glaseld
# Config + secrets are mounted at runtime; never bake secrets into the image.
ENV GLASELD_CONFIG=/etc/glaseld/glaseld.toml
EXPOSE 9090
ENTRYPOINT ["glaseld"]
