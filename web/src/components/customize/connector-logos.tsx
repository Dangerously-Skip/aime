/**
 * Brand logos for OAuth connector catalog.
 * Each is a simple inline SVG at the recognizable brand color.
 */

interface LogoProps {
  className?: string;
}

export function JiraLogo({ className }: LogoProps) {
  return (
    <svg className={className} viewBox="0 0 32 32" fill="none">
      <rect width="32" height="32" rx="7" fill="#2684FF" />
      <path d="M21.7 10H15.9c0 2.8 2.3 5 5.1 5h.7v.7c0 2.8 2.3 5 5.1 5V10.7c0-.4-.3-.7-.7-.7h-.4z" fill="#fff" opacity=".6" />
      <path d="M18.6 13.1h-5.8c0 2.8 2.3 5 5.1 5h.7v.7c0 2.8 2.3 5 5.1 5V13.8c0-.4-.3-.7-.7-.7h-.4z" fill="#fff" opacity=".8" />
      <path d="M15.5 16.2H9.7c0 2.8 2.3 5 5.1 5h.7v.7c0 2.8 2.3 5 5.1 5V16.9c0-.4-.3-.7-.7-.7h-.4z" fill="#fff" />
    </svg>
  );
}

export function ConfluenceLogo({ className }: LogoProps) {
  return (
    <svg className={className} viewBox="0 0 32 32" fill="none">
      <rect width="32" height="32" rx="7" fill="#1868DB" />
      <path d="M9 20.5s-.6 1-.3 1.5l2.6 4.2c.2.4.8.5 1.2.3.1-.1 5.1-2.9 10-2.9.4 0 .7-.3.6-.7l-1-5.3c-.1-.4-.4-.6-.8-.5-4.3.8-8.6 2-12.3 3.4z" fill="#fff" opacity=".7" />
      <path d="M23 11.5s.6-1 .3-1.5L20.7 5.8c-.2-.4-.8-.5-1.2-.3-.1.1-5.1 2.9-10 2.9-.4 0-.7.3-.6.7l1 5.3c.1.4.4.6.8.5 4.3-.8 8.6-2 12.3-3.4z" fill="#fff" />
    </svg>
  );
}

export function OutlookLogo({ className }: LogoProps) {
  return (
    <svg className={className} viewBox="0 0 32 32" fill="none">
      <rect width="32" height="32" rx="7" fill="#0078D4" />
      <path d="M22 10h-5v12h5c1.1 0 2-.9 2-2V12c0-1.1-.9-2-2-2z" fill="#fff" opacity=".6" />
      <rect x="8" y="8" width="11" height="16" rx="1.5" fill="#fff" />
      <ellipse cx="13.5" cy="16" rx="3" ry="3.5" fill="#0078D4" />
    </svg>
  );
}

export function SharePointLogo({ className }: LogoProps) {
  return (
    <svg className={className} viewBox="0 0 32 32" fill="none">
      <rect width="32" height="32" rx="7" fill="#038387" />
      <circle cx="16" cy="13" r="5" fill="#fff" opacity=".9" />
      <circle cx="20" cy="17" r="4" fill="#fff" opacity=".6" />
      <circle cx="15" cy="20" r="3.5" fill="#fff" opacity=".4" />
    </svg>
  );
}

export function SlackLogo({ className }: LogoProps) {
  return (
    <svg className={className} viewBox="0 0 32 32" fill="none">
      <rect width="32" height="32" rx="7" fill="#4A154B" />
      <g>
        <rect x="7" y="13" width="5" height="2.5" rx="1.25" fill="#E01E5A" />
        <rect x="10" y="10" width="2.5" height="5" rx="1.25" fill="#E01E5A" />
        <rect x="13" y="7" width="2.5" height="5" rx="1.25" fill="#36C5F0" />
        <rect x="13" y="10" width="5" height="2.5" rx="1.25" fill="#36C5F0" />
        <rect x="20" y="13" width="5" height="2.5" rx="1.25" fill="#2EB67D" />
        <rect x="20" y="13" width="2.5" height="5" rx="1.25" fill="#2EB67D" />
        <rect x="17" y="20" width="2.5" height="5" rx="1.25" fill="#ECB22E" />
        <rect x="14.5" y="20" width="5" height="2.5" rx="1.25" fill="#ECB22E" />
      </g>
    </svg>
  );
}

export function GitHubLogo({ className }: LogoProps) {
  return (
    <svg className={className} viewBox="0 0 32 32" fill="none">
      <rect width="32" height="32" rx="7" fill="#24292F" />
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M16 7C11 7 7 11 7 16c0 4 2.6 7.4 6.1 8.5.5.1.6-.2.6-.4v-1.5c-2.5.5-3-1.2-3-1.2-.4-1-1-1.3-1-1.3-.8-.6.1-.5.1-.5.9.1 1.4.9 1.4.9.8 1.4 2.1 1 2.6.8.1-.6.3-1 .6-1.2-2-.2-4.1-1-4.1-4.5 0-1 .4-1.8.9-2.4-.1-.2-.4-1.1.1-2.4 0 0 .7-.2 2.4.9.7-.2 1.4-.3 2.2-.3.8 0 1.5.1 2.2.3 1.7-1.1 2.4-.9 2.4-.9.5 1.3.2 2.2.1 2.4.6.6.9 1.4.9 2.4 0 3.5-2.1 4.3-4.2 4.5.3.3.6.8.6 1.7v2.5c0 .2.2.5.7.4C22.4 23.4 25 20 25 16c0-5-4-9-9-9z"
        fill="#fff"
      />
    </svg>
  );
}

export function BuildkiteLogo({ className }: LogoProps) {
  return (
    <svg className={className} viewBox="0 0 32 32" fill="none">
      <rect width="32" height="32" rx="7" fill="#30F13B" />
      <path d="M10 10h4v4h-4zm0 5h4v4h-4zm0 5h4v4h-4zm5-10h4v4h-4zm0 5h4v4h-4zm5-5h4v4h-4z" fill="#1D1D1B" />
    </svg>
  );
}

export function SumoLogicLogo({ className }: LogoProps) {
  return (
    <svg className={className} viewBox="0 0 32 32" fill="none">
      <rect width="32" height="32" rx="7" fill="#000B3C" />
      <path d="M8 16c0-4.4 3.6-8 8-8s8 3.6 8 8" stroke="#0096FF" strokeWidth="2.5" fill="none" strokeLinecap="round" />
      <path d="M12 16c0-2.2 1.8-4 4-4s4 1.8 4 4" stroke="#0096FF" strokeWidth="2" fill="none" strokeLinecap="round" />
      <circle cx="16" cy="16" r="1.5" fill="#0096FF" />
      <path d="M8 20l4-4 4 4 4-4 4 4" stroke="#47E5BC" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function AWSLogo({ className }: LogoProps) {
  return (
    <svg className={className} viewBox="0 0 32 32" fill="none">
      <rect width="32" height="32" rx="7" fill="#232F3E" />
      <path d="M11 18.5L14.5 11h1l3.5 7.5h-1.2l-.8-1.8h-3.9l-.8 1.8H11zm2.3-3h2.5l-1.3-2.9-1.2 2.9z" fill="#FF9900" />
      <path d="M9 20.5c2.5 1.5 5 2 7.5 1.5S21 20 22 19" stroke="#FF9900" strokeWidth="1.5" fill="none" strokeLinecap="round" />
      <path d="M21 18l1.5 1.2L21 20.5" stroke="#FF9900" strokeWidth="1.2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function GoogleDriveLogo({ className }: LogoProps) {
  return (
    <svg className={className} viewBox="0 0 32 32" fill="none">
      <rect width="32" height="32" rx="7" fill="#fff" />
      <path d="M12.4 7h7.2L26 19h-7.2L12.4 7z" fill="#FBBC04" />
      <path d="M6 19l3.6 6h13.2L19.2 19H6z" fill="#34A853" />
      <path d="M9.6 25L16 13.5 12.4 7 6 19l3.6 6z" fill="#4285F4" />
    </svg>
  );
}

export function MiroLogo({ className }: LogoProps) {
  return (
    <svg className={className} viewBox="0 0 32 32" fill="none">
      <rect width="32" height="32" rx="7" fill="#FFD02F" />
      <path d="M12 7h2.5l3 7.5L21 7h2.5v18H21l-3-7.5-3.5 7.5H12V7z" fill="#050038" />
      <path d="M8 7h2.5v18H8V7z" fill="#050038" />
    </svg>
  );
}

export function FigmaLogo({ className }: LogoProps) {
  return (
    <svg className={className} viewBox="0 0 32 32" fill="none">
      <rect width="32" height="32" rx="7" fill="#1E1E1E" />
      <circle cx="18" cy="16" r="3" fill="#1ABCFE" />
      <path d="M12 25c1.7 0 3-1.3 3-3v-3h-3c-1.7 0-3 1.3-3 3s1.3 3 3 3z" fill="#0ACF83" />
      <path d="M12 19h3v-6h-3c-1.7 0-3 1.3-3 3s1.3 3 3 3z" fill="#A259FF" />
      <path d="M12 13h3V7h-3c-1.7 0-3 1.3-3 3s1.3 3 3 3z" fill="#F24E1E" />
      <path d="M15 7h3c1.7 0 3 1.3 3 3s-1.3 3-3 3h-3V7z" fill="#FF7262" />
    </svg>
  );
}

export function ZoomLogo({ className }: LogoProps) {
  return (
    <svg className={className} viewBox="0 0 32 32" fill="none">
      <rect width="32" height="32" rx="7" fill="#2D8CFF" />
      <path d="M8 12.5C8 11.1 9.1 10 10.5 10h8c1.4 0 2.5 1.1 2.5 2.5v7c0 1.4-1.1 2.5-2.5 2.5h-8C9.1 22 8 20.9 8 19.5v-7z" fill="#fff" />
      <path d="M21 13.5l3.5-2.5v10l-3.5-2.5v-5z" fill="#fff" />
    </svg>
  );
}

export function AtlassianLogo({ className }: LogoProps) {
  return (
    <svg className={className} viewBox="0 0 32 32" fill="none">
      <rect width="32" height="32" rx="7" fill="#0052CC" />
      <path d="M10.5 15.5c-.3-.3-.8-.3-1 .1L5.7 22c-.2.4 0 .9.5.9h5.2c.2 0 .3-.1.4-.3 1-2.1.3-5.2-1.3-7.1z" fill="#fff" />
      <path d="M15.6 8.3c-1.7 2.7-1.6 6.3.4 8.9l2.6 3.4c.2.2.5.3.7.1.2-.1.3-.4.2-.7l-3.1-10.9c-.1-.4-.6-.5-.8-.2V8.3z" fill="#fff" opacity=".8" />
      <path d="M18 14l3.5 7.5c.1.2.3.4.5.4h4c.5 0 .7-.5.5-.9L19.3 8.6c-.2-.4-.8-.4-1-.1L18 14z" fill="#fff" />
    </svg>
  );
}

export function CalendarLogo({ className }: LogoProps) {
  return (
    <svg className={className} viewBox="0 0 32 32" fill="none">
      <rect width="32" height="32" rx="7" fill="#0078D4" />
      <rect x="7" y="9" width="18" height="16" rx="2" fill="#fff" />
      <rect x="7" y="9" width="18" height="4" rx="2" fill="#106EBE" />
      <rect x="10" y="6" width="2" height="5" rx="1" fill="#106EBE" />
      <rect x="20" y="6" width="2" height="5" rx="1" fill="#106EBE" />
      <rect x="10" y="16" width="3" height="3" rx=".5" fill="#0078D4" />
      <rect x="14.5" y="16" width="3" height="3" rx=".5" fill="#0078D4" opacity=".5" />
      <rect x="19" y="16" width="3" height="3" rx=".5" fill="#0078D4" opacity=".5" />
    </svg>
  );
}

export function OneDriveLogo({ className }: LogoProps) {
  return (
    <svg className={className} viewBox="0 0 32 32" fill="none">
      <rect width="32" height="32" rx="7" fill="#0364B8" />
      <path d="M9 20a4 4 0 013.3-3.9 5 5 0 019.6-1.6 3.5 3.5 0 013 3.5c0 1.9-1.5 3.5-3.4 3.5H10.8A2 2 0 019 20z" fill="#fff" />
      <path d="M12.3 16.1c.3-2.4 2.4-4.3 4.9-4.3 1.9 0 3.6 1.1 4.4 2.7A3.5 3.5 0 0124 18H12c0-.6.1-1.3.3-1.9z" fill="#28A8EA" opacity=".3" />
    </svg>
  );
}

export function CopilotLogo({ className }: LogoProps) {
  return (
    <svg className={className} viewBox="0 0 32 32" fill="none">
      <defs>
        <linearGradient id="copilot-gradient" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#40E0D0" />
          <stop offset=".5" stopColor="#7B68EE" />
          <stop offset="1" stopColor="#FF4081" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="7" fill="url(#copilot-gradient)" />
      <path d="M16 9l1.8 4 4.2 1.2-3.1 2.9.8 4.2-3.7-2-3.7 2 .8-4.2L10 14.2 14.2 13 16 9z" fill="#fff" />
    </svg>
  );
}

export function SnowflakeLogo({ className }: LogoProps) {
  return (
    <svg className={className} viewBox="0 0 32 32" fill="none">
      <rect width="32" height="32" rx="7" fill="#29B5E8" />
      <g stroke="#fff" strokeWidth="1.8" strokeLinecap="round">
        <line x1="16" y1="6" x2="16" y2="26" />
        <line x1="7.5" y1="11" x2="24.5" y2="21" />
        <line x1="24.5" y1="11" x2="7.5" y2="21" />
      </g>
      <g fill="#fff">
        <circle cx="16" cy="6" r="1.3" />
        <circle cx="16" cy="26" r="1.3" />
        <circle cx="7.5" cy="11" r="1.3" />
        <circle cx="24.5" cy="11" r="1.3" />
        <circle cx="7.5" cy="21" r="1.3" />
        <circle cx="24.5" cy="21" r="1.3" />
      </g>
    </svg>
  );
}

export function M365GraphLogo({ className }: LogoProps) {
  return (
    <svg className={className} viewBox="0 0 32 32" fill="none">
      <rect width="32" height="32" rx="7" fill="#0078D4" />
      <rect x="6" y="10" width="12" height="12" rx="1.5" fill="#fff" />
      <path d="M6 12l6 5 6-5" stroke="#0078D4" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <rect x="15" y="14" width="11" height="10" rx="1.5" fill="#fff" />
      <rect x="15" y="14" width="11" height="3" rx="1.5" fill="#106EBE" />
      <rect x="17" y="12" width="1.5" height="4" rx=".5" fill="#106EBE" />
      <rect x="22.5" y="12" width="1.5" height="4" rx=".5" fill="#106EBE" />
    </svg>
  );
}

export function GoogleWorkspaceLogo({ className }: LogoProps) {
  return (
    <svg className={className} viewBox="0 0 32 32" fill="none">
      <rect width="32" height="32" rx="7" fill="#fff" />
      <path d="M23 14.8c0-.6-.1-1.2-.2-1.8H16v3.4h3.9c-.2.9-.7 1.7-1.5 2.2v1.8h2.4c1.4-1.3 2.2-3.2 2.2-5.6z" fill="#4285F4" />
      <path d="M16 22c2 0 3.7-.7 4.9-1.8l-2.4-1.8c-.7.5-1.5.7-2.5.7-1.9 0-3.5-1.3-4.1-3H9.4v1.9C10.6 20.4 13.1 22 16 22z" fill="#34A853" />
      <path d="M11.9 16.1c-.1-.3-.2-.7-.2-1.1s.1-.8.2-1.1v-1.9H9.4C9 13.1 8.7 14 8.7 15s.3 1.9.7 2.8l2.5-1.7z" fill="#FBBC04" />
      <path d="M16 10.8c1.1 0 2 .4 2.8 1.1l2.1-2.1C19.7 8.6 18 8 16 8c-2.9 0-5.4 1.6-6.6 4l2.5 1.9c.6-1.8 2.2-3.1 4.1-3.1z" fill="#EA4335" />
    </svg>
  );
}

export function GooglePersonalLogo({ className }: LogoProps) {
  return (
    <svg className={className} viewBox="0 0 32 32" fill="none">
      <rect width="32" height="32" rx="7" fill="#EA4335" />
      <rect x="6" y="10" width="20" height="13" rx="1.5" fill="#fff" />
      <path d="M6 11l10 7 10-7" stroke="#EA4335" strokeWidth="1.5" fill="none" strokeLinejoin="round" />
      <circle cx="24" cy="9" r="4" fill="#4285F4" stroke="#fff" strokeWidth="1.2" />
      <circle cx="24" cy="7.5" r="1.2" fill="#fff" />
      <path d="M21.5 11c0-1.2 1.1-2 2.5-2s2.5.8 2.5 2" stroke="#fff" strokeWidth="1.2" fill="none" />
    </svg>
  );
}

export const CONNECTOR_LOGOS: Record<string, React.ComponentType<LogoProps>> = {
  jira: JiraLogo,
  confluence: ConfluenceLogo,
  atlassian: AtlassianLogo,
  outlook: OutlookLogo,
  'outlook-mail': OutlookLogo,
  'outlook-calendar': CalendarLogo,
  sharepoint: SharePointLogo,
  'onedrive-sharepoint': OneDriveLogo,
  'm365-copilot': CopilotLogo,
  'm365-graph': M365GraphLogo,
  slack: SlackLogo,
  github: GitHubLogo,
  buildkite: BuildkiteLogo,
  sumologic: SumoLogicLogo,
  aws: AWSLogo,
  snowflake: SnowflakeLogo,
  'google-drive': GoogleDriveLogo,
  'google-workspace': GoogleWorkspaceLogo,
  'google-personal': GooglePersonalLogo,
  miro: MiroLogo,
  figma: FigmaLogo,
  zoom: ZoomLogo,
};
