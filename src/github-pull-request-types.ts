/**
 * What Forge reads from GitHub about one pull request. These are observations
 * of a mutable service: parsing establishes their shape, not who produced them
 * or that they still hold.
 */
export interface GitHubActor {
  id: number;
  login: string;
  /** GitHub's own account kind, such as `User` or `Bot`. */
  type: string;
}

export interface GitHubTeam {
  id: number;
  slug: string;
}

export interface GitHubPullRequest {
  number: number;
  state: "open" | "closed";
  draft: boolean;
  merged: boolean;
  /** `null` while GitHub has not computed it. Unknown, never mergeable. */
  mergeable: boolean | null;
  author: GitHubActor;
  /** A head whose fork was deleted has no repository. */
  head: { sha: string; ref: string; repositoryId: number | null };
  base: { sha: string; ref: string; repositoryId: number };
  labels: { id: number; name: string }[];
  requestedReviewers: GitHubActor[];
  requestedTeams: GitHubTeam[];
}

/** One `review_requested` timeline event. Later removal does not erase it. */
export type GitHubReviewRequest =
  | { kind: "user"; reviewer: GitHubActor }
  | { kind: "team"; team: GitHubTeam };

export const GITHUB_REVIEW_STATES = [
  "APPROVED",
  "CHANGES_REQUESTED",
  "DISMISSED",
  "COMMENTED",
  "PENDING",
] as const;

export type GitHubReviewState = (typeof GITHUB_REVIEW_STATES)[number];

export interface GitHubReview {
  id: number;
  author: GitHubActor;
  state: GitHubReviewState;
  /** The commit reviewed. GitHub records no base for a review. */
  commitId: string | null;
  /** As GitHub sent it; a pending review has none. Not yet checked as a time. */
  submittedAt: string | null;
}

export interface GitHubReviewThreadPage {
  /** Threads on this page not explicitly resolved. */
  unresolved: number;
  nextCursor: string | null;
}
