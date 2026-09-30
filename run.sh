#!/usr/bin/env bash
# Runs one replica of the Java service. PM2 starts this script; the JVM flags are explained in the README
# (ZGC for short pauses, a small fixed heap so two replicas plus Cassandra fit on one box).
set -euo pipefail
cd "$(dirname "$0")"
set -a; . ./.env; set +a
JAVA="${JAVA_HOME:-$HOME/.local/jdk/jdk-21.0.12.1+1}/bin/java"
JAR="$(ls build/libs/beacon-*.jar | head -1)"
exec "$JAVA" -Xms256m -Xmx512m -XX:+UseZGC -jar "$JAR"
