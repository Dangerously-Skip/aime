/**
 * Pre-built standing order templates.
 * Users can activate these from the assistant surface sidebar.
 */

import type { StandingOrder } from '@/stores/assistant-store';

export interface StandingOrderTemplate {
  id: string;
  label: string;
  description: string;
  icon: string;
  category: 'productivity' | 'monitoring' | 'research' | 'learning';
  buildOrder: () => Omit<StandingOrder, 'id' | 'createdAt' | 'updatedAt' | 'runCount' | 'errorCount' | 'state' | 'status'>;
}

export const STANDING_ORDER_TEMPLATES: StandingOrderTemplate[] = [
  {
    id: 'morning-briefing',
    label: 'Morning Briefing',
    description: 'Daily summary at 9am — emails, calendar, tasks',
    icon: '☀️',
    category: 'productivity',
    buildOrder: () => ({
      instruction: 'Give me a morning briefing. Summarize what\'s on my calendar today, any important emails, open pull requests, and outstanding Jira tickets. Keep it concise — bullet points, not paragraphs.',
      trigger: { type: 'cron', expression: '0 9 * * 1-5' },
      notifyVia: 'assistant',
    }),
  },
  {
    id: 'evening-wrapup',
    label: 'Evening Wrap-up',
    description: 'End-of-day summary at 5:30pm',
    icon: '🌙',
    category: 'productivity',
    buildOrder: () => ({
      instruction: 'Give me an evening wrap-up. What did I accomplish today? What\'s still outstanding? Any PRs waiting for review? Keep it brief.',
      trigger: { type: 'cron', expression: '30 17 * * 1-5' },
      notifyVia: 'assistant',
    }),
  },
  {
    id: 'stretch-reminder',
    label: 'Stretch Reminder',
    description: 'Reminder every 2 hours to take a break',
    icon: '🧘',
    category: 'productivity',
    buildOrder: () => ({
      instruction: 'Remind me to stretch and take a short break. Give me a quick stretch suggestion.',
      trigger: { type: 'interval', expression: '2h' },
      notifyVia: 'toast',
    }),
  },
  {
    id: 'build-monitor',
    label: 'Build Monitor',
    description: 'Watch your latest build, alert on failure',
    icon: '🔨',
    category: 'monitoring',
    buildOrder: () => ({
      instruction: 'Check the status of my latest Buildkite build. If it failed, summarize the error and suggest a fix. If it passed, just confirm.',
      trigger: { type: 'interval', expression: '5m' },
      condition: 'Only report if the build status changed',
      completionCondition: 'Build completed successfully',
      notifyVia: 'assistant',
      maxExecutions: 60,
      expiresAt: Date.now() + 4 * 3600000, // 4 hours
    }),
  },
  {
    id: 'daily-lesson',
    label: 'Daily AI Lesson',
    description: 'Learn something new about AI every day',
    icon: '📚',
    category: 'learning',
    buildOrder: () => ({
      instruction: 'Teach me something new about AI, machine learning, or LLMs that I might not know. Keep it to 2-3 paragraphs. Track what topics you\'ve already covered so you don\'t repeat.',
      trigger: { type: 'cron', expression: '0 12 * * 1-5' },
      notifyVia: 'assistant',
    }),
  },
  {
    id: 'pr-watcher',
    label: 'PR Watcher',
    description: 'Monitor a PR for reviews and CI status',
    icon: '👀',
    category: 'monitoring',
    buildOrder: () => ({
      instruction: 'Check the status of my open pull requests. Report any new reviews, comments, or CI status changes.',
      trigger: { type: 'interval', expression: '10m' },
      condition: 'Only report if something changed',
      notifyVia: 'assistant',
      maxExecutions: 100,
      expiresAt: Date.now() + 24 * 3600000, // 24 hours
    }),
  },
];
