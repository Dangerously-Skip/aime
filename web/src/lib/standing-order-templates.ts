/**
 * Pre-built standing order templates.
 * Users can activate these from the assistant surface sidebar.
 *
 * SCHEDULES ARE A `ScheduleSpec`, not template parameters. Each template used to
 * carry its own time and day pickers and assemble cron by hand — a second,
 * narrower schedule UI next to the order editor's, with its own idea of which
 * day sets exist ("mon-sat" here, nothing like it there). Now the dialog renders
 * the same `SchedulePicker` as everything else, seeded with the template's
 * default, and `buildOrder` receives the trigger it produced.
 */

import type { StandingOrder } from '@/stores/assistant-store';
import { specToTrigger, type ScheduleSpec, type Trigger } from '@/lib/schedule/schedule';

export interface TemplateParameter {
  key: string;
  label: string;
  type: 'text' | 'number' | 'select';
  defaultValue: string;
  options?: string[];
}

type NewOrder = Omit<StandingOrder, 'id' | 'createdAt' | 'updatedAt' | 'runCount' | 'errorCount' | 'state' | 'status'>;

export interface StandingOrderTemplate {
  id: string;
  label: string;
  description: string;
  icon: string; // lucide icon name
  category: 'productivity' | 'monitoring' | 'research' | 'learning';
  /** The schedule the dialog opens on; the user can change it. */
  defaultSchedule: ScheduleSpec;
  parameters?: TemplateParameter[];
  buildOrder: (params?: Record<string, string>, trigger?: Trigger) => NewOrder;
}

/** The trigger a template runs on: the user's pick, else its default. */
const scheduleOf = (tpl: { defaultSchedule: ScheduleSpec }, trigger?: Trigger) =>
  trigger ?? specToTrigger(tpl.defaultSchedule);

const NOTIFY_PARAM: TemplateParameter = {
  key: 'notify',
  label: 'When it runs',
  type: 'select',
  defaultValue: 'toast',
  options: ['toast', 'assistant'],
};

export const STANDING_ORDER_TEMPLATES: StandingOrderTemplate[] = [
  {
    id: 'morning-briefing',
    label: 'Morning Briefing',
    description: 'Daily summary — emails, calendar, tasks',
    icon: 'sun',
    category: 'productivity',
    defaultSchedule: { kind: 'weekdays', time: '09:00' },
    buildOrder(_params, trigger) {
      return {
        instruction: 'Give me a morning briefing. Summarize what\'s on my calendar today, any important emails, open pull requests, and outstanding Jira tickets. Keep it concise — bullet points, not paragraphs.',
        trigger: scheduleOf(this, trigger),
        notifyVia: 'assistant',
      };
    },
  },
  {
    id: 'evening-wrapup',
    label: 'Evening Wrap-up',
    description: 'End-of-day summary',
    icon: 'moon',
    category: 'productivity',
    defaultSchedule: { kind: 'weekdays', time: '17:30' },
    buildOrder(_params, trigger) {
      return {
        instruction: 'Give me an evening wrap-up. What did I accomplish today? What\'s still outstanding? Any PRs waiting for review? Keep it brief.',
        trigger: scheduleOf(this, trigger),
        notifyVia: 'assistant',
      };
    },
  },
  {
    id: 'stretch-reminder',
    label: 'Stretch Reminder',
    description: 'Reminder to take a break',
    icon: 'timer',
    category: 'productivity',
    defaultSchedule: { kind: 'every-hours', every: 2 },
    parameters: [NOTIFY_PARAM],
    buildOrder(params, trigger) {
      return {
        instruction: 'Remind me to stretch and take a short break. Give me a quick stretch suggestion.',
        trigger: scheduleOf(this, trigger),
        // A reminder that only lands in the feed is one you will not see.
        notifyVia: params?.notify || 'toast',
      };
    },
  },
  {
    id: 'build-monitor',
    label: 'Build Monitor',
    description: 'Watch your latest build, alert on failure',
    icon: 'hammer',
    category: 'monitoring',
    defaultSchedule: { kind: 'every-minutes', every: 5 },
    buildOrder(_params, trigger) {
      return {
        instruction: 'Check the status of my latest Buildkite build. If it failed, summarize the error and suggest a fix. If it passed, just confirm.',
        trigger: scheduleOf(this, trigger),
        condition: 'Only report if the build status changed',
        completionCondition: 'Build completed successfully',
        notifyVia: 'toast',
        maxExecutions: 60,
        expiresAt: Date.now() + 4 * 3600000, // 4 hours
      };
    },
  },
  {
    id: 'daily-lesson',
    label: 'Daily AI Lesson',
    description: 'Learn something new about AI every day',
    icon: 'book-open',
    category: 'learning',
    defaultSchedule: { kind: 'weekdays', time: '12:00' },
    buildOrder(_params, trigger) {
      return {
        instruction: 'Teach me something new about AI, machine learning, or LLMs that I might not know. Keep it to 2-3 paragraphs. Track what topics you\'ve already covered so you don\'t repeat.',
        trigger: scheduleOf(this, trigger),
        notifyVia: 'assistant',
      };
    },
  },
  {
    id: 'pr-watcher',
    label: 'PR Watcher',
    description: 'Monitor a PR for reviews and CI status',
    icon: 'git-pull-request',
    category: 'monitoring',
    defaultSchedule: { kind: 'every-minutes', every: 10 },
    buildOrder(_params, trigger) {
      return {
        instruction: 'Check the status of my open pull requests. Report any new reviews, comments, or CI status changes.',
        trigger: scheduleOf(this, trigger),
        condition: 'Only report if something changed',
        notifyVia: 'assistant',
        maxExecutions: 100,
        expiresAt: Date.now() + 24 * 3600000, // 24 hours
      };
    },
  },
];
