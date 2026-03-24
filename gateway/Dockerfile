FROM rust:1.88-bookworm AS builder

WORKDIR /app

# Copy manifests first for dependency caching
COPY Cargo.toml Cargo.lock* ./
COPY crates/maplord-gateway/Cargo.toml crates/maplord-gateway/Cargo.toml
COPY crates/maplord-engine/Cargo.toml crates/maplord-engine/Cargo.toml
COPY crates/maplord-state/Cargo.toml crates/maplord-state/Cargo.toml
COPY crates/maplord-matchmaking/Cargo.toml crates/maplord-matchmaking/Cargo.toml
COPY crates/maplord-django/Cargo.toml crates/maplord-django/Cargo.toml
COPY crates/maplord-ai/Cargo.toml crates/maplord-ai/Cargo.toml
COPY crates/maplord-anticheat/Cargo.toml crates/maplord-anticheat/Cargo.toml

# Create dummy source files for dependency caching
RUN mkdir -p crates/maplord-gateway/src && echo "fn main() {}" > crates/maplord-gateway/src/main.rs && \
    mkdir -p crates/maplord-engine/src && echo "" > crates/maplord-engine/src/lib.rs && \
    mkdir -p crates/maplord-state/src && echo "" > crates/maplord-state/src/lib.rs && \
    mkdir -p crates/maplord-matchmaking/src && echo "" > crates/maplord-matchmaking/src/lib.rs && \
    mkdir -p crates/maplord-django/src && echo "" > crates/maplord-django/src/lib.rs && \
    mkdir -p crates/maplord-ai/src && echo "" > crates/maplord-ai/src/lib.rs && \
    mkdir -p crates/maplord-anticheat/src && echo "" > crates/maplord-anticheat/src/lib.rs

RUN cargo build --release || true

# Copy real source and build
COPY . .
RUN touch crates/*/src/*.rs && \
    cargo build --release --bin maplord-gateway

# Runtime stage — minimal image
FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/target/release/maplord-gateway /usr/local/bin/maplord-gateway

RUN addgroup --system --gid 1001 gateway && \
    adduser --system --uid 1001 --ingroup gateway gateway
USER gateway

EXPOSE 8080
ENV GATEWAY_PORT=8080
CMD ["maplord-gateway"]
