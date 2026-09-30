#!/usr/bin/env bash
# Runs one replica of the Java service: ./run.sh A or ./run.sh B. PM2 starts one process per replica.
# JVM flags: ZGC keeps pauses short so a stop-the-world never outlives the ZooKeeper session; a small fixed
# heap so two replicas plus Cassandra fit on one box. Both are explained in the README.
set -euo pipefail
cd "$(dirname "$0")"
set -a; . ./.env; set +a
REPLICA="${1:-A}"
PORT_VAR="REPLICA_${REPLICA}_PORT"
export REPLICA_ID="$REPLICA"
export PORT="${!PORT_VAR:-$PORT}"
JAVA="${JAVA_HOME:-$HOME/.local/jdk/jdk-21.0.12.1+1}/bin/java"
# Run a private copy of the jar. A JVM loads classes lazily from the open jar file, so a rebuild that
# overwrites build/libs/*.jar under a running replica makes its next class load fail (NoClassDefFoundError
# in the shutdown hook was how this surfaced). The copy makes rebuilds safe while replicas run.
JAR="$(ls build/libs/beacon-*.jar | head -1)"
mkdir -p build/run
cp "$JAR" "build/run/beacon-${REPLICA}.jar"
exec "$JAVA" -Xms256m -Xmx512m -XX:+UseZGC -jar "build/run/beacon-${REPLICA}.jar"
