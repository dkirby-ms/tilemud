#!/bin/bash

# Wait for Redis
echo "Waiting for Redis..."
until nc -z localhost 6379; do
  echo "Redis not ready - waiting..."
  sleep 1
done
echo "Redis is ready!"

# Wait for PostgreSQL (dev)
echo "Waiting for PostgreSQL (dev)..."
until nc -z localhost 5432; do
  echo "PostgreSQL (dev) not ready - waiting..."
  sleep 1
done
echo "PostgreSQL (dev) is ready!"

# Wait for PostgreSQL (test)
echo "Waiting for PostgreSQL (test)..."
until nc -z localhost 5433; do
  echo "PostgreSQL (test) not ready - waiting..."
  sleep 1
done
echo "PostgreSQL (test) is ready!"

echo "All services are ready!"