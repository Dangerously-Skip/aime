export interface TeamConfig {
  id: string;
  name: string;
  key: string;
}

// Import both files. teams.json always exists in the working tree (created from
// teams.example.json) but is gitignored so real keys aren't committed.
// The example file is committed and serves as a structural reference.
import teams from './teams.json';

const teamList: TeamConfig[] = Array.isArray(teams) ? teams : [];

export function getTeams(): TeamConfig[] {
  return teamList;
}

export function getTeamById(id: string): TeamConfig | undefined {
  return teamList.find((t) => t.id === id);
}
