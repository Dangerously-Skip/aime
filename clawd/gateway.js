import config from './config.js'
import WhatsAppAdapter from './adapters/whatsapp.js'
import iMessageAdapter from './adapters/imessage.js'
import TelegramAdapter from './adapters/telegram.js'
import SignalAdapter from './adapters/signal.js'
import SessionManager from './sessions/manager.js'
import AgentRunner from './agent/runner.js'
import CommandHandler from './commands/handler.js'
import { Composio } from '@composio/core'
import { BrowserServer, createBrowserMcpServer } from './browser/index.js'

/**
 * Clawd Gateway - Routes messages between messaging platforms and Claude agent
 */
class Gateway {
  constructor() {
    this.sessionManager = new SessionManager()
    this.agentRunner = new AgentRunner(this.sessionManager, {
      allowedTools: config.agent?.allowedTools || ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep'],
      maxTurns: config.agent?.maxTurns || 50
    })
    this.commandHandler = new CommandHandler(this)
    this.adapters = new Map()
    this.composio = new Composio()
    this.composioSession = null
    this.browserServer = null
    this.mcpServers = {}
    this.setupQueueMonitoring()
    this.setupAgentMonitoring()
    this.setupCronExecution()
  }

  async initMcpServers() {
    const userId = config.agentId || 'clawd-user'
    console.log('[Composio] Initializing session for:', userId)
    try {
      this.composioSession = await this.composio.create(userId)
      this.mcpServers.composio = {
        type: 'http',
        url: this.composioSession.mcp.url,
        headers: this.composioSession.mcp.headers
      }
      console.log('[Composio] Session ready')
    } catch (err) {
      console.error('[Composio] Failed to initialize:', err.message)
    }

    if (config.browser?.enabled) {
      console.log('[Browser] Initializing browser server...')
      console.log('[Browser] Mode:', config.browser.mode || 'clawd')

      try {
        this.browserServer = new BrowserServer(config.browser)
        await this.browserServer.start()

        // Create MCP server wrapper for the browser
        this.mcpServers.browser = createBrowserMcpServer(this.browserServer)
        console.log('[Browser] Server ready')
      } catch (err) {
        console.error('[Browser] Failed to initialize:', err.message)
        if (config.browser.mode === 'chrome') {
          console.error('[Browser] Make sure Chrome is running with --remote-debugging-port=' + (config.browser.chrome?.cdpPort || 9222))
        }
      }
    }
  }

  setupQueueMonitoring() {
    this.agentRunner.on('queued', ({ runId, sessionKey, position, queueLength }) => {
      if (position > 0) {
        console.log(`[Queue] 📥 Queued: position ${position + 1}, ${queueLength} pending`)
      }
    })

    this.agentRunner.on('processing', ({ runId, waitTimeMs, remainingInQueue }) => {
      if (waitTimeMs > 100) {
        console.log(`[Queue] ⚙️  Processing (waited ${Math.round(waitTimeMs)}ms, ${remainingInQueue} remaining)`)
      }
    })

    this.agentRunner.on('completed', ({ runId, processingTimeMs }) => {
      console.log(`[Queue] ✓ Completed in ${Math.round(processingTimeMs)}ms`)
    })

    this.agentRunner.on('failed', ({ runId, error }) => {
      console.log(`[Queue] ✗ Failed: ${error}`)
    })
  }

  setupAgentMonitoring() {
    this.agentRunner.on('agent:tool', ({ sessionKey, name }) => {
      console.log(`[Agent] 🔧 Using tool: ${name}`)
    })
  }

  setupCronExecution() {
    // Handle cron job execution - send scheduled messages
    this.agentRunner.agent.cronScheduler.on('execute', async ({ jobId, platform, chatId, message }) => {
      console.log(`[Cron] ⏰ Executing job ${jobId}`)

      const adapter = this.adapters.get(platform)
      if (!adapter) {
        console.error(`[Cron] No adapter for platform: ${platform}`)
        return
      }

      try {
        await adapter.sendMessage(chatId, message)
        console.log(`[Cron] Message sent for job ${jobId}`)
      } catch (err) {
        console.error(`[Cron] Failed to send message:`, err.message)
      }
    })
  }

  async start() {
    console.log('='.repeat(50))
    console.log('Clawd Gateway Starting')
    console.log('='.repeat(50))
    console.log(`Agent ID: ${config.agentId}`)
    console.log(`Workspace: ~/clawd/`)
    console.log('')

    await this.initMcpServers()
    this.agentRunner.setMcpServers(this.mcpServers)

    // Initialize WhatsApp adapter
    if (config.whatsapp.enabled) {
      console.log('[Gateway] Initializing WhatsApp adapter...')
      const whatsapp = new WhatsAppAdapter(config.whatsapp)
      this.setupAdapter(whatsapp, 'whatsapp', config.whatsapp)
      this.adapters.set('whatsapp', whatsapp)

      try {
        await whatsapp.start()
      } catch (err) {
        console.error('[Gateway] WhatsApp adapter failed to start:', err.message)
      }
    }

    // Initialize iMessage adapter
    if (config.imessage.enabled) {
      console.log('[Gateway] Initializing iMessage adapter...')
      const imessage = new iMessageAdapter(config.imessage)
      this.setupAdapter(imessage, 'imessage', config.imessage)
      this.adapters.set('imessage', imessage)

      try {
        await imessage.start()
      } catch (err) {
        console.error('[Gateway] iMessage adapter failed to start:', err.message)
      }
    }


    if (config.telegram?.enabled) {
      console.log('[Gateway] Initializing Telegram adapter...')
      const telegram = new TelegramAdapter(config.telegram)
      this.setupAdapter(telegram, 'telegram', config.telegram)
      this.adapters.set('telegram', telegram)

      try {
        await telegram.start()
      } catch (err) {
        console.error('[Gateway] Telegram adapter failed to start:', err.message)
      }
    }

    // Initialize Signal adapter
    if (config.signal?.enabled) {
      console.log('[Gateway] Initializing Signal adapter...')
      const signal = new SignalAdapter(config.signal)
      this.setupAdapter(signal, 'signal', config.signal)
      this.adapters.set('signal', signal)

      try {
        await signal.start()
      } catch (err) {
        console.error('[Gateway] Signal adapter failed to start:', err.message)
      }
    }

    // Handle shutdown
    process.on('SIGINT', () => this.stop())
    process.on('SIGTERM', () => this.stop())

    console.log('')
    console.log('[Gateway] Ready and listening for messages')
    console.log('[Gateway] Using Claude Agent SDK with memory + cron + Composio + Browser')
    console.log('[Gateway] Commands: /help, /new, /status, /memory, /stop')
  }

  setupAdapter(adapter, platform, platformConfig) {
    adapter.onMessage(async (message) => {
      const sessionKey = adapter.generateSessionKey(config.agentId, platform, message)

      console.log('')
      console.log(`[${platform.toUpperCase()}] Incoming message:`)
      console.log(`  Session: ${sessionKey}`)
      console.log(`  From: ${message.sender}`)
      console.log(`  Group: ${message.isGroup}`)
      console.log(`  Text: ${message.text.substring(0, 100)}${message.text.length > 100 ? '...' : ''}`)
      if (message.image) {
        console.log(`  Image: ${Math.round(message.image.data.length / 1024)}KB`)
      }

      try {
        // Check for slash commands first
        const commandResult = await this.commandHandler.execute(
          message.text,
          sessionKey,
          adapter,
          message.chatId
        )

        if (commandResult.handled) {
          console.log(`[${platform.toUpperCase()}] Command handled: ${message.text.split(' ')[0]}`)
          await adapter.sendMessage(message.chatId, commandResult.response)
          return
        }

        // Check queue status and show typing indicator
        const queueStatus = this.agentRunner.getQueueStatus(sessionKey)

        if (adapter.sendTyping) {
          await adapter.sendTyping(message.chatId)
        }

        if (queueStatus.pending > 0 && adapter.react && message.raw?.key?.id) {
          await adapter.react(message.chatId, message.raw.key.id, '⏳')
        }

        // Enqueue agent run with optional image
        console.log(`[${platform.toUpperCase()}] Processing...`)
        const response = await this.agentRunner.enqueueRun(
          sessionKey,
          message.text,
          adapter,
          message.chatId,
          message.image  // Pass image if present
        )

        if (adapter.stopTyping) {
          await adapter.stopTyping(message.chatId)
        }

        console.log(`[${platform.toUpperCase()}] Sending response:`)
        console.log(`  Text: ${response.substring(0, 100)}${response.length > 100 ? '...' : ''}`)

        await adapter.sendMessage(message.chatId, response)
        console.log(`[${platform.toUpperCase()}] Response sent`)
      } catch (error) {
        console.error(`[${platform.toUpperCase()}] Error:`, error.message)

        if (adapter.stopTyping) {
          await adapter.stopTyping(message.chatId)
        }

        try {
          await adapter.sendMessage(
            message.chatId,
            "Sorry, I encountered an error. Please try again."
          )
        } catch (sendErr) {
          console.error(`[${platform.toUpperCase()}] Failed to send error message:`, sendErr.message)
        }
      }
    })
  }

  async stop() {
    console.log('\n[Gateway] Shutting down...')

    // Stop cron scheduler
    this.agentRunner.agent.stopCron()

    // Stop browser server
    if (this.browserServer) {
      try {
        await this.browserServer.stop()
        console.log('[Gateway] Browser server stopped')
      } catch (err) {
        console.error('[Gateway] Error stopping browser:', err.message)
      }
    }

    for (const adapter of this.adapters.values()) {
      try {
        await adapter.stop()
      } catch (err) {
        console.error('[Gateway] Error stopping adapter:', err.message)
      }
    }

    console.log('[Gateway] Goodbye!')
    process.exit(0)
  }
}

// Start the gateway
const gateway = new Gateway()
gateway.start().catch((err) => {
  console.error('[Gateway] Fatal error:', err)
  process.exit(1)
})
