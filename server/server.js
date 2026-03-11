import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import dotenv from 'dotenv';
import { Composio } from '@composio/core';
import { getProvider, getAvailableProviders, initializeProviders } from './providers/index.js';
import { getAvailableSurfaces, getSurfaceConfig } from './surfaces/index.js';
import { isBedrockConfigured } from './bedrock-env.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '..', '.env') });

const app = express();
const PORT = process.env.PORT || 3001;

// Initialize Composio
const composio = new Composio();

const composioSessions = new Map();
let defaultComposioSession = null;

// Pre-initialize Composio session on startup
async function initializeComposioSession() {
  const defaultUserId = 'default-user';
  console.log('[COMPOSIO] Pre-initializing session for:', defaultUserId);
  try {
    defaultComposioSession = await composio.create(defaultUserId);
    composioSessions.set(defaultUserId, defaultComposioSession);
    console.log('[COMPOSIO] Session ready with MCP URL:', defaultComposioSession.mcp.url);

    // Update opencode.json with the MCP config
    updateOpencodeConfig(defaultComposioSession.mcp.url, defaultComposioSession.mcp.headers);
    console.log('[OPENCODE] Updated opencode.json with MCP config');
  } catch (error) {
    console.error('[COMPOSIO] Failed to pre-initialize session:', error.message);
  }
}

// Write MCP config to opencode.json
function updateOpencodeConfig(mcpUrl, mcpHeaders) {
  const opencodeConfigPath = path.join(__dirname, 'opencode.json');
  const config = {
    mcp: {
      composio: {
        type: 'remote',
        url: mcpUrl,
        headers: mcpHeaders
      }
    }
  };
  fs.writeFileSync(opencodeConfigPath, JSON.stringify(config, null, 2));
}

// Middleware
app.use(cors());
app.use(express.json());

// Surface-routed chat endpoint (must be registered BEFORE /api/chat)
app.post('/api/chat/:surfaceId', async (req, res) => {
  const { surfaceId } = req.params;
  const {
    message,
    chatId,
    userId = 'default-user',
    provider: providerName = 'claude',
    model = null
  } = req.body;

  console.log('[CHAT] Surface request received:', surfaceId);
  console.log('[CHAT] Message:', message);
  console.log('[CHAT] Chat ID:', chatId);
  console.log('[CHAT] Provider:', providerName);
  console.log('[CHAT] Model:', model || '(default)');

  // Validate surfaceId
  const availableSurfaces = getAvailableSurfaces();
  if (!availableSurfaces.includes(surfaceId.toLowerCase())) {
    return res.status(400).json({
      error: `Invalid surface: ${surfaceId}. Available: ${availableSurfaces.join(', ')}`
    });
  }

  if (!message) {
    return res.status(400).json({ error: 'Message is required' });
  }

  // Validate provider
  const availableProviders = getAvailableProviders();
  if (!availableProviders.includes(providerName.toLowerCase())) {
    return res.status(400).json({
      error: `Invalid provider: ${providerName}. Available: ${availableProviders.join(', ')}`
    });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  res.write(`data: ${JSON.stringify({ type: 'connected', message: 'Processing request...' })}\n\n`);

  const heartbeatInterval = setInterval(() => {
    if (!res.writableEnded) {
      res.write(': heartbeat\n\n');
    }
  }, 15000);

  res.on('close', () => {
    clearInterval(heartbeatInterval);
  });

  try {
    // Get or create Composio session for this user
    let composioSession = composioSessions.get(userId);
    if (!composioSession) {
      console.log('[COMPOSIO] Creating new session for user:', userId);
      res.write(`data: ${JSON.stringify({ type: 'status', message: 'Initializing session...' })}\n\n`);
      composioSession = await composio.create(userId);
      composioSessions.set(userId, composioSession);
      console.log('[COMPOSIO] Session created with MCP URL:', composioSession.mcp.url);

      // Update opencode.json with the MCP config
      updateOpencodeConfig(composioSession.mcp.url, composioSession.mcp.headers);
      console.log('[OPENCODE] Updated opencode.json with MCP config');
    }

    // Get the provider instance
    const provider = getProvider(providerName);

    // Build MCP servers config - passed to provider
    const mcpServers = {
      composio: {
        type: 'http',
        url: composioSession.mcp.url,
        headers: composioSession.mcp.headers
      }
    };

    // Get surface-specific config
    const surfaceConfig = getSurfaceConfig(surfaceId);

    console.log('[CHAT] Using provider:', provider.name, '| Surface:', surfaceId);
    console.log('[CHAT] Surface tools:', surfaceConfig.allowedTools?.join(', '));

    // Stream responses from the provider
    try {
      for await (const chunk of provider.query({
        prompt: message,
        chatId,
        userId,
        mcpServers,
        model: model || surfaceConfig.model,
        surfaceId,
        allowedTools: surfaceConfig.allowedTools,
        maxTurns: surfaceConfig.maxTurns
      })) {
        if (chunk.type === 'tool_use') {
          console.log('[SSE] Sending tool_use:', chunk.name);
        }
        if (chunk.type === 'text') {
          console.log('[SSE] Sending text chunk, length:', chunk.content?.length || 0);
        }
        // Send chunk as SSE
        const data = `data: ${JSON.stringify(chunk)}\n\n`;
        res.write(data);
      }
    } catch (streamError) {
      console.error('[CHAT] Stream error during iteration:', streamError);
      if (!res.writableEnded) {
        res.write(`data: ${JSON.stringify({ type: 'error', message: streamError.message })}\n\n`);
      }
    }

    clearInterval(heartbeatInterval);
    if (!res.writableEnded) {
      res.end();
    }
    console.log('[CHAT] Stream completed for surface:', surfaceId);
  } catch (error) {
    clearInterval(heartbeatInterval);
    console.error('[CHAT] Error:', error);
    res.write(`data: ${JSON.stringify({ type: 'error', message: error.message })}\n\n`);
    res.end();
  }
});

// Chat endpoint using provider abstraction (legacy, no surface routing)
app.post('/api/chat', async (req, res) => {
  const {
    message,
    chatId,
    userId = 'default-user',
    provider: providerName = 'claude',  // Per-request provider selection
    model = null  // Per-request model selection
  } = req.body;

  console.log('[CHAT] Request received:', message);
  console.log('[CHAT] Chat ID:', chatId);
  console.log('[CHAT] Provider:', providerName);
  console.log('[CHAT] Model:', model || '(default)');

  if (!message) {
    return res.status(400).json({ error: 'Message is required' });
  }

  // Validate provider
  const availableProviders = getAvailableProviders();
  if (!availableProviders.includes(providerName.toLowerCase())) {
    return res.status(400).json({
      error: `Invalid provider: ${providerName}. Available: ${availableProviders.join(', ')}`
    });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  res.write(`data: ${JSON.stringify({ type: 'connected', message: 'Processing request...' })}\n\n`);

  const heartbeatInterval = setInterval(() => {
    if (!res.writableEnded) {
      res.write(': heartbeat\n\n');
    }
  }, 15000);

  res.on('close', () => {
    clearInterval(heartbeatInterval);
  });

  try {
    // Get or create Composio session for this user
    let composioSession = composioSessions.get(userId);
    if (!composioSession) {
      console.log('[COMPOSIO] Creating new session for user:', userId);
      res.write(`data: ${JSON.stringify({ type: 'status', message: 'Initializing session...' })}\n\n`);
      composioSession = await composio.create(userId);
      composioSessions.set(userId, composioSession);
      console.log('[COMPOSIO] Session created with MCP URL:', composioSession.mcp.url);

      // Update opencode.json with the MCP config
      updateOpencodeConfig(composioSession.mcp.url, composioSession.mcp.headers);
      console.log('[OPENCODE] Updated opencode.json with MCP config');
    }

    // Get the provider instance
    const provider = getProvider(providerName);

    // Build MCP servers config - passed to provider
    const mcpServers = {
      composio: {
        type: 'http',
        url: composioSession.mcp.url,
        headers: composioSession.mcp.headers
      }
    };

    console.log('[CHAT] Using provider:', provider.name);
    console.log('[CHAT] All stored sessions:', Array.from(provider.sessions.entries()));

    // Stream responses from the provider
    try {
      for await (const chunk of provider.query({
        prompt: message,
        chatId,
        userId,
        mcpServers,
        model,
        allowedTools: ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep', 'WebSearch', 'WebFetch', 'TodoWrite', 'Skill'],
        maxTurns: 100
      })) {
        if (chunk.type === 'tool_use') {
          console.log('[SSE] Sending tool_use:', chunk.name);
        }
        if (chunk.type === 'text') {
          console.log('[SSE] Sending text chunk, length:', chunk.content?.length || 0);
        }
        // Send chunk as SSE
        const data = `data: ${JSON.stringify(chunk)}\n\n`;
        res.write(data);
      }
    } catch (streamError) {
      console.error('[CHAT] Stream error during iteration:', streamError);
      if (!res.writableEnded) {
        res.write(`data: ${JSON.stringify({ type: 'error', message: streamError.message })}\n\n`);
      }
    }

    clearInterval(heartbeatInterval);
    if (!res.writableEnded) {
      res.end();
    }
    console.log('[CHAT] Stream completed');
  } catch (error) {
    clearInterval(heartbeatInterval);
    console.error('[CHAT] Error:', error);
    res.write(`data: ${JSON.stringify({ type: 'error', message: error.message })}\n\n`);
    res.end();
  }
});

// Abort endpoint to stop active queries
app.post('/api/abort', (req, res) => {
  const { chatId, surfaceId, provider: providerName = 'claude' } = req.body;

  if (!chatId) {
    return res.status(400).json({ error: 'chatId is required' });
  }

  console.log('[ABORT] Request to abort chatId:', chatId, 'provider:', providerName, 'surface:', surfaceId || '(none)');

  try {
    const provider = getProvider(providerName);
    // Pass surfaceId if the provider supports it
    const aborted = surfaceId ? provider.abort(chatId, surfaceId) : provider.abort(chatId);

    if (aborted) {
      console.log('[ABORT] Successfully aborted chatId:', chatId);
      res.json({ success: true, message: 'Query aborted' });
    } else {
      console.log('[ABORT] No active query found for chatId:', chatId);
      res.json({ success: false, message: 'No active query to abort' });
    }
  } catch (error) {
    console.error('[ABORT] Error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get available providers endpoint
app.get('/api/providers', (_req, res) => {
  res.json({
    providers: getAvailableProviders(),
    default: 'claude'
  });
});

// Get available surfaces and their configs (system prompts stripped for security)
app.get('/api/surfaces', (_req, res) => {
  const surfaces = getAvailableSurfaces();
  const configs = {};
  for (const surface of surfaces) {
    const config = getSurfaceConfig(surface);
    // Strip systemPrompt from config for security — don't expose to client
    const { systemPrompt, ...safeConfig } = config;
    configs[surface] = safeConfig;
  }
  res.json({ surfaces, configs });
});

// Get available models
app.get('/api/models', (_req, res) => {
  res.json({
    models: [
      { id: 'opus', label: 'Opus 4.6' },
      { id: 'sonnet', label: 'Sonnet 4.6' },
      { id: 'haiku', label: 'Haiku 4.5' },
    ],
    default: 'sonnet',
    bedrock: isBedrockConfigured(),
  });
});

// Health check endpoint
app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    providers: getAvailableProviders()
  });
});

await initializeProviders();
await initializeComposioSession();

// Start server and keep reference to prevent garbage collection
const server = app.listen(PORT, () => {
  console.log(`\n✓ Backend server running on http://localhost:${PORT}`);
  console.log(`✓ Chat endpoint: POST http://localhost:${PORT}/api/chat`);
  console.log(`✓ Surface chat endpoint: POST http://localhost:${PORT}/api/chat/:surfaceId`);
  console.log(`✓ Surfaces endpoint: GET http://localhost:${PORT}/api/surfaces`);
  console.log(`✓ Models endpoint: GET http://localhost:${PORT}/api/models`);
  console.log(`✓ Providers endpoint: GET http://localhost:${PORT}/api/providers`);
  console.log(`✓ Health check: GET http://localhost:${PORT}/api/health`);
  console.log(`✓ Available providers: ${getAvailableProviders().join(', ')}`);
  console.log(`✓ Available surfaces: ${getAvailableSurfaces().join(', ')}`);
  console.log(`✓ Bedrock: ${isBedrockConfigured() ? 'configured' : 'not configured'}\n`);
});

// Keep the process alive
server.on('error', (err) => {
  console.error('Server error:', err);
});

// Prevent the process from exiting
process.on('SIGINT', () => {
  console.log('\nShutting down server...');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});
