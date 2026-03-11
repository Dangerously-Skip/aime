#!/bin/bash
# Start development environment
# Runs Express server and Electron app concurrently

echo "Starting nib Cowork development environment..."

# Start the Express backend server
cd server && npm start &
SERVER_PID=$!

# Wait for server to be ready
sleep 2

# Start Electron in development mode
cd .. && NODE_ENV=development npx electron .
EXIT_CODE=$?

# Cleanup
kill $SERVER_PID 2>/dev/null
exit $EXIT_CODE
