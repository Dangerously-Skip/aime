'use client';

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { getGatedStorage } from '@/lib/gated-storage';
import type { A2UIDocument } from '@/lib/a2ui/types';

export interface KnowledgeFile {
  id: string;
  name: string;
  content: string;
  type: string;
  size: number;
  addedAt: number;
}

export interface PinnedCanvas {
  id: string;
  name: string;
  doc: A2UIDocument;
  pinnedAt: number;
  /** Source surface ('chat' | 'cowork' | etc.) — for context. */
  surface?: string;
  /** Source conversation, so we can offer "regenerate from chat". */
  conversationId?: string;
}

export interface ProjectArtifact {
  id: string;
  name: string;
  path: string;
  type: 'file' | 'document' | 'url' | 'note' | 'summary';
  mimeType?: string;
  surface: string;
  conversationId: string;
  description?: string;
  createdAt: number;
  updatedAt: number;
}

export interface ProjectTimeline {
  id: string;
  surface: string;
  conversationId: string;
  action: string;
  artifactIds?: string[];
  timestamp: number;
}

export interface Project {
  id: string;
  name: string;
  description: string;
  customInstructions: string;
  knowledgeFiles: KnowledgeFile[];
  surfaces: string[];
  color: string;
  icon: string;
  starred: boolean;
  createdAt: number;
  updatedAt: number;
  // Cross-surface fields
  artifacts: ProjectArtifact[];
  timeline: ProjectTimeline[];
  pinnedCanvases?: PinnedCanvas[];
  folder?: string;
  urls?: string[];
  conversationIds: Record<string, string[]>;  // surface → conversationIds
}

export const PROJECT_ICONS = [
  "folder", "rocket", "lightbulb", "target", "pen-line", "flask-conical", "palette", "bar-chart-3",
  "wrench", "globe", "smartphone", "bot", "test-tubes", "book-open", "laptop", "music",
  "building-2", "zap", "lock", "leaf", "gamepad-2", "camera", "pencil", "brain",
];

export function getRandomIcon(): string {
  return PROJECT_ICONS[Math.floor(Math.random() * PROJECT_ICONS.length)];
}

const PROJECT_KNOWLEDGE_LIMIT = 2 * 1024 * 1024; // 2MB per project
const GLOBAL_KNOWLEDGE_LIMIT = 8 * 1024 * 1024;  // 8MB global

/**
 * Migrate old projects that don't have the new cross-surface fields.
 */
function migrateProject(p: Partial<Project> & { id: string }): Project {
  return {
    ...p,
    artifacts: p.artifacts ?? [],
    timeline: p.timeline ?? [],
    pinnedCanvases: p.pinnedCanvases ?? [],
    conversationIds: p.conversationIds ?? {},
    folder: p.folder ?? undefined,
    urls: p.urls ?? undefined,
    // Ensure all other fields have defaults
    name: p.name ?? '',
    description: p.description ?? '',
    customInstructions: p.customInstructions ?? '',
    knowledgeFiles: p.knowledgeFiles ?? [],
    surfaces: p.surfaces ?? [],
    color: p.color ?? '',
    icon: p.icon ?? 'folder',
    starred: p.starred ?? false,
    createdAt: p.createdAt ?? Date.now(),
    updatedAt: p.updatedAt ?? Date.now(),
  } as Project;
}

interface ProjectState {
  projects: Project[];
  activeProjectId: string | null;
}

interface ProjectActions {
  addProject: (project: Project) => void;
  updateProject: (id: string, updates: Partial<Omit<Project, 'id'>>) => void;
  removeProject: (id: string) => void;
  setActiveProject: (id: string | null) => void;
  addKnowledgeFile: (projectId: string, file: KnowledgeFile) => string | null;
  removeKnowledgeFile: (projectId: string, fileId: string) => void;
  getProject: (id: string) => Project | undefined;
  // Cross-surface actions
  addArtifact: (projectId: string, artifact: ProjectArtifact) => void;
  removeArtifact: (projectId: string, artifactId: string) => void;
  updateArtifact: (projectId: string, artifactId: string, updates: Partial<ProjectArtifact>) => void;
  addTimelineEntry: (projectId: string, entry: ProjectTimeline) => void;
  addConversationToProject: (projectId: string, surface: string, conversationId: string) => void;
  getConversationsForSurface: (projectId: string, surface: string) => string[];
  setProjectFolder: (projectId: string, folder: string) => void;
  addProjectUrl: (projectId: string, url: string) => void;
  // Canvas pinning
  pinCanvas: (projectId: string, canvas: PinnedCanvas) => void;
  unpinCanvas: (projectId: string, canvasId: string) => void;
  renamePinnedCanvas: (projectId: string, canvasId: string, name: string) => void;
}

export type ProjectStore = ProjectState & ProjectActions;

function getProjectKnowledgeSize(project: Project): number {
  return project.knowledgeFiles.reduce((sum, f) => sum + f.size, 0);
}

function getGlobalKnowledgeSize(projects: Project[]): number {
  return projects.reduce((sum, p) => sum + getProjectKnowledgeSize(p), 0);
}

export const useProjectStore = create<ProjectStore>()(
  persist(
    (set, get) => ({
      projects: [],
      activeProjectId: null,

      addProject: (project) =>
        set((state) => ({
          projects: [migrateProject(project), ...state.projects],
        })),

      updateProject: (id, updates) =>
        set((state) => ({
          projects: state.projects.map((p) =>
            p.id === id ? { ...p, ...updates, updatedAt: Date.now() } : p
          ),
        })),

      removeProject: (id) =>
        set((state) => ({
          projects: state.projects.filter((p) => p.id !== id),
          activeProjectId: state.activeProjectId === id ? null : state.activeProjectId,
        })),

      setActiveProject: (id) => set({ activeProjectId: id }),

      addKnowledgeFile: (projectId, file) => {
        const state = get();
        const project = state.projects.find((p) => p.id === projectId);
        if (!project) return 'Project not found';

        const projectSize = getProjectKnowledgeSize(project);
        if (projectSize + file.size > PROJECT_KNOWLEDGE_LIMIT) {
          return `Project knowledge limit exceeded (max ${Math.round(PROJECT_KNOWLEDGE_LIMIT / (1024 * 1024))}MB per project)`;
        }

        const globalSize = getGlobalKnowledgeSize(state.projects);
        if (globalSize + file.size > GLOBAL_KNOWLEDGE_LIMIT) {
          return `Global knowledge limit exceeded (max ${Math.round(GLOBAL_KNOWLEDGE_LIMIT / (1024 * 1024))}MB total)`;
        }

        set((state) => ({
          projects: state.projects.map((p) =>
            p.id === projectId
              ? {
                  ...p,
                  knowledgeFiles: [...p.knowledgeFiles, file],
                  updatedAt: Date.now(),
                }
              : p
          ),
        }));
        return null;
      },

      removeKnowledgeFile: (projectId, fileId) =>
        set((state) => ({
          projects: state.projects.map((p) =>
            p.id === projectId
              ? {
                  ...p,
                  knowledgeFiles: p.knowledgeFiles.filter((f) => f.id !== fileId),
                  updatedAt: Date.now(),
                }
              : p
          ),
        })),

      getProject: (id) => {
        return get().projects.find((p) => p.id === id);
      },

      // ── Cross-surface actions ──────────────────────────────────────────

      addArtifact: (projectId, artifact) =>
        set((state) => ({
          projects: state.projects.map((p) => {
            if (p.id !== projectId) return p;
            const migrated = migrateProject(p);
            // Deduplicate by path — only when path is a non-empty string
            const existing = artifact.path
              ? migrated.artifacts.find((a) => a.path && a.path === artifact.path)
              : null;
            if (existing) {
              return {
                ...migrated,
                artifacts: migrated.artifacts.map((a) =>
                  a.path && a.path === artifact.path ? { ...a, ...artifact, updatedAt: Date.now() } : a
                ),
                updatedAt: Date.now(),
              };
            }
            return {
              ...migrated,
              artifacts: [...migrated.artifacts, artifact],
              updatedAt: Date.now(),
            };
          }),
        })),

      removeArtifact: (projectId, artifactId) =>
        set((state) => ({
          projects: state.projects.map((p) =>
            p.id === projectId
              ? {
                  ...migrateProject(p),
                  artifacts: (p.artifacts ?? []).filter((a) => a.id !== artifactId),
                  updatedAt: Date.now(),
                }
              : p
          ),
        })),

      updateArtifact: (projectId, artifactId, updates) =>
        set((state) => ({
          projects: state.projects.map((p) =>
            p.id === projectId
              ? {
                  ...migrateProject(p),
                  artifacts: (p.artifacts ?? []).map((a) =>
                    a.id === artifactId ? { ...a, ...updates, updatedAt: Date.now() } : a
                  ),
                  updatedAt: Date.now(),
                }
              : p
          ),
        })),

      addTimelineEntry: (projectId, entry) =>
        set((state) => ({
          projects: state.projects.map((p) =>
            p.id === projectId
              ? {
                  ...migrateProject(p),
                  timeline: [...(p.timeline ?? []), entry],
                  updatedAt: Date.now(),
                }
              : p
          ),
        })),

      addConversationToProject: (projectId, surface, conversationId) =>
        set((state) => ({
          projects: state.projects.map((p) => {
            if (p.id !== projectId) return p;
            const migrated = migrateProject(p);
            const surfaceConvs = migrated.conversationIds[surface] ?? [];
            if (surfaceConvs.includes(conversationId)) return p;
            return {
              ...migrated,
              conversationIds: {
                ...migrated.conversationIds,
                [surface]: [...surfaceConvs, conversationId],
              },
              updatedAt: Date.now(),
            };
          }),
        })),

      getConversationsForSurface: (projectId, surface) => {
        const project = get().projects.find((p) => p.id === projectId);
        if (!project) return [];
        return (project.conversationIds ?? {})[surface] ?? [];
      },

      setProjectFolder: (projectId, folder) =>
        set((state) => ({
          projects: state.projects.map((p) =>
            p.id === projectId
              ? { ...migrateProject(p), folder, updatedAt: Date.now() }
              : p
          ),
        })),

      addProjectUrl: (projectId, url) =>
        set((state) => ({
          projects: state.projects.map((p) => {
            if (p.id !== projectId) return p;
            const migrated = migrateProject(p);
            const urls = migrated.urls ?? [];
            if (urls.includes(url)) return p;
            return {
              ...migrated,
              urls: [...urls, url],
              updatedAt: Date.now(),
            };
          }),
        })),

      pinCanvas: (projectId, canvas) =>
        set((state) => ({
          projects: state.projects.map((p) =>
            p.id === projectId
              ? {
                  ...migrateProject(p),
                  pinnedCanvases: [...(p.pinnedCanvases ?? []), canvas],
                  updatedAt: Date.now(),
                }
              : p
          ),
        })),

      unpinCanvas: (projectId, canvasId) =>
        set((state) => ({
          projects: state.projects.map((p) =>
            p.id === projectId
              ? {
                  ...migrateProject(p),
                  pinnedCanvases: (p.pinnedCanvases ?? []).filter((c) => c.id !== canvasId),
                  updatedAt: Date.now(),
                }
              : p
          ),
        })),

      renamePinnedCanvas: (projectId, canvasId, name) =>
        set((state) => ({
          projects: state.projects.map((p) =>
            p.id === projectId
              ? {
                  ...migrateProject(p),
                  pinnedCanvases: (p.pinnedCanvases ?? []).map((c) =>
                    c.id === canvasId ? { ...c, name } : c
                  ),
                  updatedAt: Date.now(),
                }
              : p
          ),
        })),
    }),
    {
      name: 'nibcowork:projects',
      storage: createJSONStorage(() => getGatedStorage()),
      skipHydration: true,
      // Migrate on rehydration
      onRehydrateStorage: () => (state) => {
        if (state) {
          state.projects = state.projects.map(migrateProject);
        }
      },
    }
  )
);
