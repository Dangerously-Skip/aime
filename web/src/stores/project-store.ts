'use client';

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

export interface KnowledgeFile {
  id: string;
  name: string;
  content: string;
  type: string;
  size: number;
  addedAt: number;
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
          projects: [project, ...state.projects],
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
    }),
    {
      name: 'nibcowork:projects',
      storage: createJSONStorage(() => localStorage),
      skipHydration: true,
    }
  )
);
