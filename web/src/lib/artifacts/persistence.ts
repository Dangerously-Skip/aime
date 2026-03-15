import type { ParsedArtifact } from './parser';

export type SaveStatus =
  | { state: 'idle' }
  | { state: 'saving' }
  | { state: 'saved'; path: string }
  | { state: 'error'; message: string };

const LANG_EXT_MAP: Record<string, string> = {
  javascript: 'js',
  typescript: 'ts',
  python: 'py',
  ruby: 'rb',
  rust: 'rs',
  golang: 'go',
  go: 'go',
  java: 'java',
  kotlin: 'kt',
  swift: 'swift',
  csharp: 'cs',
  cpp: 'cpp',
  c: 'c',
  html: 'html',
  css: 'css',
  scss: 'scss',
  json: 'json',
  yaml: 'yaml',
  yml: 'yml',
  xml: 'xml',
  sql: 'sql',
  shell: 'sh',
  bash: 'sh',
  zsh: 'sh',
  powershell: 'ps1',
  dockerfile: 'dockerfile',
  markdown: 'md',
  tsx: 'tsx',
  jsx: 'jsx',
  vue: 'vue',
  svelte: 'svelte',
  php: 'php',
  perl: 'pl',
  lua: 'lua',
  r: 'r',
  scala: 'scala',
  toml: 'toml',
  ini: 'ini',
  graphql: 'graphql',
};

const TYPE_EXT_MAP: Record<string, string> = {
  markdown: 'md',
  code: 'txt',
  html: 'html',
  text: 'txt',
};

export function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'untitled';
}

export function getArtifactExtension(artifact: ParsedArtifact): string {
  if (artifact.language) {
    const ext = LANG_EXT_MAP[artifact.language.toLowerCase()];
    if (ext) return ext;
    // Use language directly if it looks like an extension
    if (artifact.language.length <= 6 && /^[a-z]+$/.test(artifact.language)) {
      return artifact.language;
    }
  }
  return TYPE_EXT_MAP[artifact.type] || 'txt';
}

export function getArtifactFilename(artifact: ParsedArtifact): string {
  return `${slugify(artifact.title)}.${getArtifactExtension(artifact)}`;
}

export function getAutoSaveDir(projectFolder: string, conversationId: string): string {
  return `${projectFolder}/.tricoder/artifacts/${conversationId}`;
}

function getElectronAPI() {
  if (typeof window !== 'undefined' && window.electronAPI) {
    return window.electronAPI;
  }
  return null;
}

async function resolveAutoSavePath(
  dir: string,
  filename: string,
): Promise<string> {
  const api = getElectronAPI();
  if (!api) return `${dir}/${filename}`;

  const dotIdx = filename.lastIndexOf('.');
  const base = dotIdx > 0 ? filename.slice(0, dotIdx) : filename;
  const ext = dotIdx > 0 ? filename.slice(dotIdx) : '';

  let candidate = `${dir}/${filename}`;
  let counter = 1;

  while (await api.fileExists(candidate)) {
    counter++;
    candidate = `${dir}/${base}-${counter}${ext}`;
  }

  return candidate;
}

function getDialogFilters(artifact: ParsedArtifact): { name: string; extensions: string[] }[] {
  const ext = getArtifactExtension(artifact);
  return [
    { name: `${artifact.type} file`, extensions: [ext] },
    { name: 'All Files', extensions: ['*'] },
  ];
}

export async function saveArtifactAs(artifact: ParsedArtifact): Promise<string | null> {
  const api = getElectronAPI();
  const filename = getArtifactFilename(artifact);

  if (api) {
    const chosenPath = await api.saveFileDialog(filename, getDialogFilters(artifact));
    if (!chosenPath) return null;
    await api.writeFile(chosenPath, artifact.content);
    return chosenPath;
  }

  // Browser fallback: blob download
  const blob = new Blob([artifact.content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  return filename;
}

export async function autoSaveArtifact(
  artifact: ParsedArtifact,
  projectFolder: string,
  conversationId: string,
): Promise<string | null> {
  const api = getElectronAPI();
  if (!api) return null; // Auto-save only works in Electron

  const dir = getAutoSaveDir(projectFolder, conversationId);
  await api.ensureDir(dir);

  const filename = getArtifactFilename(artifact);
  const savePath = await resolveAutoSavePath(dir, filename);
  await api.writeFile(savePath, artifact.content);
  return savePath;
}
