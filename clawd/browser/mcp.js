import BrowserServer from './server.js'

/**
 * Create an MCP server that wraps BrowserServer
 * Returns an object compatible with claude-agent-sdk's mcpServers format
 */
export function createBrowserMcpServer(browserServer) {
  return {
    listTools: async () => {
      return {
        tools: [
          {
            name: 'browser_status',
            description: 'Get the current browser status (running, mode, current URL, tab count)',
            inputSchema: {
              type: 'object',
              properties: {},
              required: []
            }
          },
          {
            name: 'browser_navigate',
            description: 'Navigate to a URL in the browser',
            inputSchema: {
              type: 'object',
              properties: {
                url: {
                  type: 'string',
                  description: 'The URL to navigate to'
                }
              },
              required: ['url']
            }
          },
          {
            name: 'browser_snapshot',
            description: 'Get an accessibility tree snapshot of the current page. Returns elements with [ref=eN] identifiers that can be used with click/type actions.',
            inputSchema: {
              type: 'object',
              properties: {
                format: {
                  type: 'string',
                  enum: ['tree', 'text'],
                  description: 'Output format: "tree" for structured JSON, "text" for compact text representation'
                }
              },
              required: []
            }
          },
          {
            name: 'browser_screenshot',
            description: 'Take a screenshot of the current page',
            inputSchema: {
              type: 'object',
              properties: {
                fullPage: {
                  type: 'boolean',
                  description: 'Whether to capture the full scrollable page'
                }
              },
              required: []
            }
          },
          {
            name: 'browser_click',
            description: 'Click an element on the page. Use element ref (e.g., "e5") from snapshot, or descriptive text (e.g., "Submit button")',
            inputSchema: {
              type: 'object',
              properties: {
                target: {
                  type: 'string',
                  description: 'Element ref (e.g., "e5") or descriptive text to click'
                }
              },
              required: ['target']
            }
          },
          {
            name: 'browser_type',
            description: 'Type text into an input field. Use element ref or field name/placeholder.',
            inputSchema: {
              type: 'object',
              properties: {
                target: {
                  type: 'string',
                  description: 'Element ref (e.g., "e5") or input field identifier'
                },
                text: {
                  type: 'string',
                  description: 'Text to type'
                },
                clear: {
                  type: 'boolean',
                  description: 'Whether to clear the field first (default: false)'
                }
              },
              required: ['target', 'text']
            }
          },
          {
            name: 'browser_press',
            description: 'Press a keyboard key (e.g., "Enter", "Tab", "Escape", "ArrowDown")',
            inputSchema: {
              type: 'object',
              properties: {
                key: {
                  type: 'string',
                  description: 'Key to press'
                }
              },
              required: ['key']
            }
          },
          {
            name: 'browser_select',
            description: 'Select an option from a dropdown/select element',
            inputSchema: {
              type: 'object',
              properties: {
                target: {
                  type: 'string',
                  description: 'Element ref or dropdown identifier'
                },
                value: {
                  type: 'string',
                  description: 'Option value or text to select'
                }
              },
              required: ['target', 'value']
            }
          },
          {
            name: 'browser_wait',
            description: 'Wait for an element or text to appear on the page',
            inputSchema: {
              type: 'object',
              properties: {
                target: {
                  type: 'string',
                  description: 'Element selector or text to wait for'
                },
                type: {
                  type: 'string',
                  enum: ['selector', 'text'],
                  description: 'Wait type: "selector" for CSS selector, "text" for visible text'
                },
                timeout: {
                  type: 'number',
                  description: 'Maximum wait time in milliseconds (default: 10000)'
                }
              },
              required: ['target']
            }
          },
          {
            name: 'browser_tabs',
            description: 'List all open browser tabs',
            inputSchema: {
              type: 'object',
              properties: {},
              required: []
            }
          },
          {
            name: 'browser_switch_tab',
            description: 'Switch to a different browser tab by index',
            inputSchema: {
              type: 'object',
              properties: {
                index: {
                  type: 'number',
                  description: 'Tab index (0-based)'
                }
              },
              required: ['index']
            }
          },
          {
            name: 'browser_new_tab',
            description: 'Open a new browser tab, optionally navigating to a URL',
            inputSchema: {
              type: 'object',
              properties: {
                url: {
                  type: 'string',
                  description: 'Optional URL to open in the new tab'
                }
              },
              required: []
            }
          },
          {
            name: 'browser_close_tab',
            description: 'Close the current browser tab',
            inputSchema: {
              type: 'object',
              properties: {},
              required: []
            }
          },
          {
            name: 'browser_back',
            description: 'Go back in browser history',
            inputSchema: {
              type: 'object',
              properties: {},
              required: []
            }
          },
          {
            name: 'browser_forward',
            description: 'Go forward in browser history',
            inputSchema: {
              type: 'object',
              properties: {},
              required: []
            }
          },
          {
            name: 'browser_reload',
            description: 'Reload the current page',
            inputSchema: {
              type: 'object',
              properties: {},
              required: []
            }
          }
        ]
      }
    },

    callTool: async (name, args) => {
      try {
        // Check if browser is started
        if (!browserServer.context && name !== 'browser_status') {
          return {
            content: [{ type: 'text', text: 'Browser not started. The browser will be started automatically when the gateway starts.' }],
            isError: true
          }
        }

        let result

        switch (name) {
          case 'browser_status':
            result = browserServer.getStatus()
            break

          case 'browser_navigate':
            result = await browserServer.navigate(args.url)
            break

          case 'browser_snapshot':
            if (args.format === 'text') {
              result = await browserServer.textSnapshot()
            } else {
              result = await browserServer.snapshot()
            }
            break

          case 'browser_screenshot':
            const screenshot = await browserServer.screenshot({ fullPage: args.fullPage })
            return {
              content: [{
                type: 'image',
                data: screenshot.data,
                mimeType: screenshot.mimeType
              }]
            }

          case 'browser_click':
            result = await browserServer.click(args.target)
            break

          case 'browser_type':
            result = await browserServer.type(args.target, args.text, { clear: args.clear })
            break

          case 'browser_press':
            result = await browserServer.press(args.key)
            break

          case 'browser_select':
            result = await browserServer.select(args.target, args.value)
            break

          case 'browser_wait':
            result = await browserServer.waitFor(args.target, {
              type: args.type,
              timeout: args.timeout
            })
            break

          case 'browser_tabs':
            result = await browserServer.getTabs()
            break

          case 'browser_switch_tab':
            result = await browserServer.switchTab(args.index)
            break

          case 'browser_new_tab':
            result = await browserServer.newTab(args.url)
            break

          case 'browser_close_tab':
            result = await browserServer.closeTab()
            break

          case 'browser_back':
            result = await browserServer.goBack()
            break

          case 'browser_forward':
            result = await browserServer.goForward()
            break

          case 'browser_reload':
            result = await browserServer.reload()
            break

          default:
            return {
              content: [{ type: 'text', text: `Unknown tool: ${name}` }],
              isError: true
            }
        }

        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
        }

      } catch (error) {
        return {
          content: [{ type: 'text', text: `Error: ${error.message}` }],
          isError: true
        }
      }
    }
  }
}

export default createBrowserMcpServer
