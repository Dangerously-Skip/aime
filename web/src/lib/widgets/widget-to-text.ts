import type { WidgetNode } from './catalog';

/**
 * A rendered widget, as text a model and a person can both read.
 *
 * WHY THIS EXISTS. A widget is glanceable and mute: you can see that three
 * cameras are underpriced and you cannot ask which one to bid on. That is the
 * one thing a heartbeat could do that a scheduled widget cannot — start a
 * conversation — and "continue in chat" is how the widget model gets it back
 * without a second proactive mechanism competing with the first.
 *
 * For that, the card's contents have to cross into a chat. Handing over the raw
 * node JSON would technically work and reads terribly for the user, who sees the
 * seeded turn; handing over nothing means the agent answers about a card it
 * cannot see. Markdown is the format both ends already understand.
 *
 * DELIBERATELY LOSSY. Charts become a summary line rather than their points, and
 * images become their alt text. The purpose is a conversation opener, not
 * round-tripping — the widget itself remains the source of truth, and the recipe
 * that produced it travels alongside so the agent can re-derive anything it
 * needs.
 */
export function widgetNodeToText(node: WidgetNode | null, depth = 0): string {
  if (!node) return '';
  const pad = '  '.repeat(depth);

  switch (node.type) {
    case 'text': {
      if (node.variant === 'heading') return `${pad}## ${node.text}`;
      if (node.variant === 'subheading') return `${pad}### ${node.text}`;
      return `${pad}${node.text}`;
    }
    case 'metric':
      return `${pad}**${node.label}:** ${node.value}${node.delta ? ` (${node.delta})` : ''}`;
    case 'statGrid':
      return node.items.map((i) => `${pad}**${i.label}:** ${i.value}`).join('\n');
    case 'list':
      return node.items
        .map((i, n) => `${pad}${node.ordered ? `${n + 1}.` : '-'} ${i.text}${i.sub ? ` — ${i.sub}` : ''}${i.badge ? ` [${i.badge}]` : ''}`)
        .join('\n');
    case 'table': {
      // A real markdown table: the agent reads these far better than prose, and
      // a comparison grid is the commonest briefing shape.
      const head = `${pad}| ${node.columns.join(' | ')} |`;
      const rule = `${pad}| ${node.columns.map(() => '---').join(' | ')} |`;
      const body = node.rows.map((r) => `${pad}| ${r.join(' | ')} |`).join('\n');
      return [head, rule, body].filter(Boolean).join('\n');
    }
    case 'keyValue':
      return node.rows.map((r) => `${pad}**${r.key}:** ${r.value}`).join('\n');
    case 'badge':
      return `${pad}[${node.text}]`;
    case 'timeline':
      return node.items
        .map((i) => `${pad}- ${i.time ? `${i.time} — ` : ''}${i.title}${i.sub ? ` (${i.sub})` : ''}`)
        .join('\n');
    case 'progress':
      return `${pad}${node.label ? `${node.label}: ` : ''}${Math.round(node.value * 100)}%`;
    case 'chart':
      // Lossy on purpose — the shape and size, not the series.
      return `${pad}[${node.chart} chart${node.title ? `: ${node.title}` : ''} — ${node.points.length} points]`;
    case 'divider':
      return `${pad}---`;
    case 'image':
      return `${pad}[image${node.alt ? `: ${node.alt}` : ''}]`;
    case 'actionButton':
      return `${pad}[button: ${node.label}]`;
    case 'section':
    case 'card': {
      const title = node.title ? `${pad}## ${node.title}` : '';
      const subtitle = 'subtitle' in node && node.subtitle ? `${pad}${node.subtitle}` : '';
      const children = node.children.map((c) => widgetNodeToText(c, depth)).filter(Boolean);
      return [title, subtitle, ...children].filter(Boolean).join('\n');
    }
    default:
      return '';
  }
}

/**
 * The opening turn of a conversation about a widget.
 *
 * The RECIPE travels with the content, because the agent's likeliest next job is
 * re-deriving or extending it — "why is that one cheap?", "add the shipping
 * cost" — and without the recipe it would be guessing at where the numbers came
 * from. That is the same failure as an uncited price, one layer up.
 */
export function widgetConversationSeed(
  widget: { title: string; recipe: string; refreshedAt?: number },
  node: WidgetNode | null,
  nowMs: number,
): string {
  const body = widgetNodeToText(node).trim();
  const age = widget.refreshedAt
    ? `Last refreshed ${Math.max(0, Math.round((nowMs - widget.refreshedAt) / 60_000))} minutes ago.`
    : 'It has not run yet.';

  return [
    `Here is my **${widget.title}** widget.`,
    '',
    body || '_It has not rendered anything yet._',
    '',
    `<widget-context>`,
    `The recipe that produces this tile: ${widget.recipe}`,
    age,
    `The tile above is what it currently shows. If I ask you to change what it tracks, say so —`,
    `editing the widget is a separate action and this conversation does not do it.`,
    `</widget-context>`,
  ].join('\n');
}
