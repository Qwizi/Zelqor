FROM rust:1.88-bookworm AS builder

WORKDIR /app

# Copy manifests first for dependency caching
COPY Cargo.toml Cargo.lock* ./
COPY crates/zelqor-gateway/Cargo.toml crates/zelqor-gateway/Cargo.toml
COPY crates/zelqor-engine/Cargo.toml crates/zelqor-engine/Cargo.toml
COPY crates/zelqor-state/Cargo.toml crates/zelqor-state/Cargo.toml
COPY crates/zelqor-matchmaking/Cargo.toml crates/zelqor-matchmaking/Cargo.toml
COPY crates/zelqor-django/Cargo.toml crates/zelqor-django/Cargo.toml
COPY crates/zelqor-ai/Cargo.toml crates/zelqor-ai/Cargo.toml
COPY crates/zelqor-anticheat/Cargo.toml crates/zelqor-anticheat/Cargo.toml

# Create dummy source files for dependency caching
RUN mkdir -p crates/zelqor-gateway/src && echo "fn main() {}" > crates/zelqor-gateway/src/main.rs && \
    mkdir -p crates/zelqor-engine/src && echo "" > crates/zelqor-engine/src/lib.rs && \
    mkdir -p crates/zelqor-state/src && echo "" > crates/zelqor-state/src/lib.rs && \
    mkdir -p crates/zelqor-matchmaking/src && echo "" > crates/zelqor-matchmaking/src/lib.rs && \
    mkdir -p crates/zelqor-django/src && echo "" > crates/zelqor-django/src/lib.rs && \
    mkdir -p crates/zelqor-ai/src && echo "" > crates/zelqor-ai/src/lib.rs && \
    mkdir -p crates/zelqor-anticheat/src && echo "" > crates/zelqor-anticheat/src/lib.rs

RUN cargo build --release || true

# Copy real source and build
COPY . .
RUN touch crates/*/src/*.rs && \
    cargo build --release --bin zelqor-gateway

# Runtime stage — minimal image
FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/target/release/zelqor-gateway /usr/local/bin/zelqor-gateway

RUN addgroup --system --gid 1001 gateway && \
    adduser --system --uid 1001 --ingroup gateway gateway
USER gateway

EXPOSE 8080
ENV GATEWAY_PORT=8080
CMD ["zelqor-gateway"]
