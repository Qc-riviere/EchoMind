# Build stage
FROM rust:1.85-slim-bookworm AS builder

RUN apt-get update && apt-get install -y --no-install-recommends \
      pkg-config build-essential \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /build

# Copy workspace manifest + all member crates needed for the bridge server build.
COPY Cargo.toml Cargo.lock ./
COPY echomind-core ./echomind-core
COPY echomind-server ./echomind-server
COPY echomind-bridge-server ./echomind-bridge-server
COPY sqlite-vec ./sqlite-vec
# The top-level (`.`) workspace member is the Tauri app; provide a stub so
# cargo can resolve the workspace without pulling tauri deps into the image.
COPY build.rs ./build.rs
COPY src ./src

RUN cargo build --release -p echomind-bridge-server

# Runtime stage
FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=builder /build/target/release/echomind-bridge-server /usr/local/bin/echomind-bridge-server

ENV BRIDGE_BIND=0.0.0.0:8443
ENV BRIDGE_DATA_DIR=/data
VOLUME ["/data"]
EXPOSE 8443

CMD ["echomind-bridge-server"]
