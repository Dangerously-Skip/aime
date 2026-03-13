"use client";

import {
  Folder,
  Rocket,
  Lightbulb,
  Target,
  PenLine,
  FlaskConical,
  Palette,
  BarChart3,
  Wrench,
  Globe,
  Smartphone,
  Bot,
  TestTubes,
  BookOpen,
  Laptop,
  Music,
  Building2,
  Zap,
  Lock,
  Leaf,
  Gamepad2,
  Camera,
  Pencil,
  Brain,
} from "lucide-react";
import type { LucideProps } from "lucide-react";

const ICON_MAP: Record<string, React.FC<LucideProps>> = {
  folder: Folder,
  rocket: Rocket,
  lightbulb: Lightbulb,
  target: Target,
  "pen-line": PenLine,
  "flask-conical": FlaskConical,
  palette: Palette,
  "bar-chart-3": BarChart3,
  wrench: Wrench,
  globe: Globe,
  smartphone: Smartphone,
  bot: Bot,
  "test-tubes": TestTubes,
  "book-open": BookOpen,
  laptop: Laptop,
  music: Music,
  "building-2": Building2,
  zap: Zap,
  lock: Lock,
  leaf: Leaf,
  "gamepad-2": Gamepad2,
  camera: Camera,
  pencil: Pencil,
  brain: Brain,
};

interface ProjectIconProps {
  icon: string | undefined | null;
  className?: string;
}

export function ProjectIcon({ icon, className = "h-4 w-4" }: ProjectIconProps) {
  const IconComponent = ICON_MAP[icon || "folder"] || Folder;
  return <IconComponent className={className} />;
}
